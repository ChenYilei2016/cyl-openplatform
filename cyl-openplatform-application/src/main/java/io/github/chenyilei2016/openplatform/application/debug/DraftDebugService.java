package io.github.chenyilei2016.openplatform.application.debug;

import io.github.chenyilei2016.openplatform.application.catalog.ApiCatalogService;
import io.github.chenyilei2016.openplatform.application.runtime.ApiInvocationExecutor;
import io.github.chenyilei2016.openplatform.application.runtime.InvocationFailure;
import io.github.chenyilei2016.openplatform.application.runtime.RequestPreparation;
import io.github.chenyilei2016.openplatform.application.token.TokenVerifier;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiDefinition;
import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.github.chenyilei2016.openplatform.domain.observability.CallRecord;
import io.github.chenyilei2016.openplatform.domain.observability.CallMode;
import io.github.chenyilei2016.openplatform.domain.runtime.InvocationDiagnostics;
import io.github.chenyilei2016.openplatform.domain.token.TokenContext;
import java.util.Map;
import java.util.List;
import java.util.concurrent.TimeUnit;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import static io.github.chenyilei2016.openplatform.domain.runtime.InvocationDiagnostics.Stage.*;
import static io.github.chenyilei2016.openplatform.domain.runtime.InvocationDiagnostics.Status.*;

/**
 * 预检和执行都重新核验调用身份/固定修订；预检结果不是后续执行的授权凭据。
 * 调用身份来自业务 Token，或后台所选凭据的当前授权（112，服务端代换，执行时写管理审计）。
 */
@Service
@RequiredArgsConstructor
public class DraftDebugService {
    private final ApiCatalogService catalog;
    private final TokenVerifier tokens;
    private final ApiInvocationExecutor executor;
    private final DebugTargetInspector targets;
    private final DebugIdentityService identities;
    public record DebugResult(String requestId, long draftRevision, long durationMillis, TokenContext identity, InvocationDiagnostics diagnostics) {}
    private record Authorized(ApiDefinition definition, TokenContext token) {}

    /** Token 先于修订核验（保持原有 401 优先）；凭据代换在修订一致后才解析，避免为过期修订写审计。 */
    private Authorized authorize(String apiId, long revision, DebugCaller caller, String requestId, boolean execute) {
        TokenContext token = caller instanceof DebugCaller.Bearer bearer ? tokens.verify(bearer.token()) : null;
        ApiDefinition definition = catalog.find(apiId);
        if (definition.draftRevision() != revision) throw new PlatformException(ErrorCode.CONFLICT, "草稿已被修改，请重新加载后调试；当前参数保留");
        if (caller instanceof DebugCaller.Credential credential) token = identities.resolve(credential, requestId, execute);
        return new Authorized(definition, token);
    }

    public DebugResult preflight(String apiId, long revision, DebugCaller caller, Map<String, Object> input, String requestId) {
        long started = System.nanoTime();
        Authorized authorized = authorize(apiId, revision, caller, requestId, false);
        executor.authorize(authorized.definition(), authorized.token().invocationContext());
        InvocationDiagnostics trace = new InvocationDiagnostics();
        trace.passed(AUTHORIZATION, "当前调用身份和API权限有效；执行时仍会重新校验");
        try {
            trace.mapped(RequestPreparation.prepare(authorized.definition(), authorized.token().invocationContext(), input).diagnosticValue());
            trace.passed(REQUEST, "请求结构、默认值及实际提供方参数检查通过");
        } catch (PlatformException failure) {
            trace.check(REQUEST, FAILED, failure.getErrorCode().name(), failure.getMessage(),
                    failure instanceof RequestPreparation.InvalidInput invalid ? invalid.issues() : List.of());
        }
        targets.inspect(authorized.definition(), trace);
        if (trace.checks().stream().noneMatch(check -> check.status() == FAILED)) trace.succeeded(null);
        return result(requestId, authorized, started, trace);
    }

    public DebugResult invoke(String apiId, long revision, DebugCaller caller, Map<String, Object> input,
                              String requestId, String clientIp, CallRecord.CallRecordBuilder observation) {
        long started = System.nanoTime();
        Authorized authorized = authorize(apiId, revision, caller, requestId, true);
        InvocationDiagnostics trace;
        try {
            trace = executor.execute(authorized.definition(), authorized.token().invocationContext(), input, requestId, clientIp,
                    CallMode.DRAFT_DEBUG, observation).diagnostics();
        } catch (InvocationFailure failure) { trace = failure.diagnostics(); }
        return result(requestId, authorized, started, trace);
    }

    private DebugResult result(String requestId, Authorized authorized, long started, InvocationDiagnostics trace) {
        return new DebugResult(requestId, authorized.definition().draftRevision(), TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - started), authorized.token(), trace);
    }
}
