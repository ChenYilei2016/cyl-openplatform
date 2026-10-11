package io.github.chenyilei2016.openplatform.application.runtime;

import io.github.chenyilei2016.openplatform.domain.access.ScopeRepository;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiDefinition;
import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.github.chenyilei2016.openplatform.domain.governance.GovernanceGuard;
import io.github.chenyilei2016.openplatform.domain.governance.GovernanceRequest;
import io.github.chenyilei2016.openplatform.domain.governance.GovernanceDecision;
import io.github.chenyilei2016.openplatform.domain.governance.GovernanceRejected;
import io.github.chenyilei2016.openplatform.domain.observability.CallMode;
import io.github.chenyilei2016.openplatform.domain.observability.CallRecord;
import io.github.chenyilei2016.openplatform.domain.runtime.*;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import static io.github.chenyilei2016.openplatform.domain.runtime.InvocationDiagnostics.Stage.*;
import static io.github.chenyilei2016.openplatform.domain.runtime.InvocationDiagnostics.Status.*;

/** 正式快照和管理草稿共用授权、治理、参数映射及返回链；诊断不改变执行语义。 */
@Service
@RequiredArgsConstructor
public class ApiInvocationExecutor {
    private final ScopeRepository scopes;
    private final GovernanceGuard governance;
    private final HttpApiInvoker httpInvoker;
    private final DubboApiInvoker dubboInvoker;
    private final ProviderResponseService responses;
    private final InvocationIdempotency idempotency;

    public record ExecutionResult(Object data, List<ResponseAdaptation.Issue> warnings, InvocationDiagnostics diagnostics) {}

    public void authorize(ApiDefinition definition, InvocationContext context) {
        if (scopes.enabledCodes(definition.scopeCodes()).stream().noneMatch(context.scopeCodes()::contains))
            throw new PlatformException(ErrorCode.FORBIDDEN, "当前调用身份没有此API的权限组");
        if (definition.employeeRequired()) context.requireEmployee();
        definition.lifecycle().requireCallable();
        definition.mappings().stream().filter(mapping -> mapping.source() == io.github.chenyilei2016.openplatform.domain.catalog.ParameterMapping.Source.CONTEXT)
                .forEach(mapping -> context.requireValue(mapping.path()));
    }

    public ExecutionResult execute(ApiDefinition definition, InvocationContext context, Map<String, Object> input,
                          String requestId, String clientIp, CallMode mode, CallRecord.CallRecordBuilder observation) {
        observation.apiId(definition.id()).service(definition.service()).version(definition.version())
                .method(definition.method()).protocol(definition.protocol()).draftRevision(definition.draftRevision())
                .applicationId(context.applicationId()).tenantId(context.tenantId()).userId(context.userId())
                .employeeId(context.employeeId()).employeeNo(context.employeeNo());
        try {
            GovernanceDecision decision = authorizeAndEvaluateGovernance(definition, context, clientIp, mode);
            observation.governance(decision);
            if (!decision.allowed()) throw new GovernanceRejected(decision.denialReason(), decision.retryAfterSeconds());
            return invokeProvider(definition, context, input, requestId, mode);
        } catch (PlatformException failure) {
            observation.errorCode(failure.getErrorCode().getCode());
            throw failure;
        }
    }

    private GovernanceDecision authorizeAndEvaluateGovernance(ApiDefinition definition, InvocationContext context,
                                                               String clientIp, CallMode mode) {
        try {
            authorize(definition, context);
            return governance.evaluate(new GovernanceRequest(context.applicationId(), context.tenantId(), definition.id(), clientIp, mode));
        } catch (PlatformException failure) {
            throw failure;
        } catch (RuntimeException failure) {
            // 此阶段尚未进入提供方链；不可把依赖故障描述为执行结果未知。
            throw new PlatformException(ErrorCode.DEPENDENCY_UNAVAILABLE, "授权或治理依赖暂不可用", failure);
        }
    }

    private ExecutionResult invokeProvider(ApiDefinition definition, InvocationContext context, Map<String, Object> input, String requestId, CallMode mode) {
        InvocationDiagnostics trace = new InvocationDiagnostics();
        trace.passed(AUTHORIZATION, "本次身份、权限和治理检查通过");
        InvocationDiagnostics.Stage stage = REQUEST;
        IdempotencyGuard.Reservation reservation = null;
        try {
            IdempotencyGuard.Reservation planned = mode == CallMode.PRODUCTION ? idempotency.prepare(definition, context, input, requestId) : null;
            RequestPreparation.Prepared parameters = RequestPreparation.prepare(definition, context, input);
            trace.mapped(parameters.diagnosticValue());
            trace.passed(REQUEST, "请求结构、默认值和可信身份映射通过");
            stage = TARGET;
            definition.binding().validate();
            trace.passed(TARGET, "使用当前固定草稿中的目标与连接修订");
            // 普通Token、签名和MCP共用正式链；草稿调试不占用正式业务幂等号。
            if (planned != null) { idempotency.reserve(planned); reservation = planned; }
            stage = PROVIDER_CALL;
            trace.dispatch(InvocationDiagnostics.Dispatch.UNKNOWN);
            Object raw = switch (definition.protocol()) {
                case HTTP -> httpInvoker.invoke(definition.binding(), parameters.httpParameters(), context, requestId);
                case DUBBO -> dubboInvoker.invoke(definition.binding(), parameters.dubboArguments(), context, requestId);
            };
            trace.received(raw);
            trace.passed(PROVIDER_AUTH, "提供方未返回接入验证拒绝");
            trace.passed(PROVIDER_CALL, "已收到提供方JSON返回");
            ResponseAdaptation.Result adapted = responses.adapt(definition.responseAdapter(), definition.responseSchema(), raw);
            trace.adapted(adapted);
            describeAdaptation(trace, adapted, definition);
            if (!adapted.succeeded()) {
                PlatformException failure = new ResponseAdaptation.Failure(adapted.issue(), adapted.warnings(), adapted.providerMessage());
                trace.failed(failure);
                throw new InvocationFailure(failure, trace);
            }
            trace.succeeded(adapted.publicData());
            return new ExecutionResult(adapted.publicData(), adapted.warnings(), trace);
        } catch (InvocationFailure failure) {
            throw failure;
        } catch (PlatformException failure) {
            List<ResponseAdaptation.Issue> issues = failure instanceof RequestPreparation.InvalidInput invalid ? invalid.issues() : List.of();
            String reason = failure.getErrorCode().name();
            String summary = failure.getMessage();
            if (failure instanceof ProviderCallFailure provider) {
                trace.dispatch(provider.dispatch());
                if (provider.rejection() != null) { stage = PROVIDER_AUTH; reason = provider.rejection().name(); summary = provider.rejection().summary(); }
            } else if (failure instanceof ResponseAdaptation.Failure response) {
                issues = List.of(response.issue());
                reason = response.issue().reason().name();
                trace.dispatch(InvocationDiagnostics.Dispatch.SENT);
            }
            trace.check(stage, FAILED, reason, summary, issues);
            trace.failed(failure);
            throw new InvocationFailure(failure, trace);
        } finally {
            if (reservation != null && trace.providerDispatch() == InvocationDiagnostics.Dispatch.NOT_SENT)
                idempotency.release(reservation);
        }
    }

    private void describeAdaptation(InvocationDiagnostics trace, ResponseAdaptation.Result result, ApiDefinition definition) {
        if (result.succeeded()) {
            trace.passed(BUSINESS, definition.responseAdapter().mode() == io.github.chenyilei2016.openplatform.domain.catalog.ResponseAdapter.Mode.DIRECT
                    ? "直接业务对象，不解析提供方成功码" : "符合配置的业务成功值");
            trace.passed(ADAPT, "业务数据提取完成");
            trace.check(SCHEMA, PASSED, null, "公开字段投影及结构校验通过", result.warnings());
            return;
        }
        if (result.businessAccepted()) trace.passed(BUSINESS, "业务判定通过");
        ResponseAdaptation.Issue issue = result.issue();
        InvocationDiagnostics.Stage failed = InvocationDiagnostics.Stage.valueOf(issue.stage().name());
        if (failed == SCHEMA) { trace.passed(BUSINESS, "业务判定通过"); trace.passed(ADAPT, "已提取业务数据"); }
        trace.check(failed, FAILED, issue.reason().name(), issue.reason().publicMessage(),
                java.util.stream.Stream.concat(java.util.stream.Stream.of(issue), result.warnings().stream()).toList());
    }
}
