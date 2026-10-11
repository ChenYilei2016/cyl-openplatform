package io.github.chenyilei2016.openplatform.application.mcp;

import io.github.chenyilei2016.openplatform.application.access.TenantScopeAccessService;
import io.github.chenyilei2016.openplatform.application.mcp.McpSignatureVerifier.VerifiedGateway;
import io.github.chenyilei2016.openplatform.application.runtime.ApiInvocationExecutor;
import io.github.chenyilei2016.openplatform.domain.access.ClientApplication;
import io.github.chenyilei2016.openplatform.domain.access.EmployeeDirectory;
import io.github.chenyilei2016.openplatform.domain.access.EmployeeIdentity;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiDefinition;
import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.github.chenyilei2016.openplatform.domain.mcp.McpToolRepository;
import io.github.chenyilei2016.openplatform.domain.observability.CallMode;
import io.github.chenyilei2016.openplatform.domain.observability.CallRecord;
import io.github.chenyilei2016.openplatform.domain.publication.EffectiveRelease;
import io.github.chenyilei2016.openplatform.domain.runtime.InvocationContext;
import io.github.chenyilei2016.openplatform.domain.signature.SignedRequest;
import java.util.List;
import java.util.Map;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

/** 网关认证后的MCP业务授权；不创建Token或虚构人员委托，生效快照只读一次并贯穿正式执行链。 */
@Service
@RequiredArgsConstructor
public class McpInvocationService {
    private final McpSignatureVerifier signatures;
    private final McpTenantActivationService activations;
    private final TenantScopeAccessService scopes;
    private final McpToolRepository tools;
    private final EmployeeDirectory employees;
    private final ApiInvocationExecutor executor;

    public ApiInvocationExecutor.ExecutionResult call(VerifiedGateway gateway, SignedRequest signed, String toolName,
            String toolSetId, Map<String, Object> input, String requestId, String clientIp, CallRecord.CallRecordBuilder observation) {
        AuthorizedCall authorized;
        try {
            authorized = authorize(gateway, signed, toolName, toolSetId, observation);
        } catch (PlatformException failure) {
            throw failure;
        } catch (RuntimeException failure) {
            throw new PlatformException(ErrorCode.DEPENDENCY_UNAVAILABLE, "MCP授权依赖暂不可用", failure);
        }
        return executor.execute(authorized.api(), authorized.context(), input, requestId, clientIp, CallMode.PRODUCTION, observation);
    }

    private record AuthorizedCall(ApiDefinition api, InvocationContext context) {}

    private AuthorizedCall authorize(VerifiedGateway gateway, SignedRequest signed, String toolName,
                                    String toolSetId, CallRecord.CallRecordBuilder observation) {
        if (signed.tenantId().isBlank()) throw new PlatformException(ErrorCode.INVALID_REQUEST, "调用工具必须提供签名覆盖的租户身份");
        observation.applicationId(gateway.application().id()).tenantId(signed.tenantId()).employeeNo(signed.employeeNo());
        requireActivation(signed.tenantId());
        EffectiveRelease release = tools.find(toolName, toolSetId)
                .orElseThrow(() -> new PlatformException(ErrorCode.NOT_FOUND, "工具未发布、已停用或不属于当前工具集"));
        ApiDefinition api = release.snapshot();
        observation.apiId(api.id()).service(api.service()).version(api.version()).method(api.method())
                .releaseId(release.releaseId()).draftRevision(api.draftRevision()).protocol(api.protocol());
        Set<String> available = requireScopes(signed.tenantId(), api);
        EmployeeIdentity employee = null;
        if (signed.employeeNo() != null) {
            employee = employees.find(signed.tenantId(), signed.employeeNo());
            if (employee == null) throw new PlatformException(ErrorCode.FORBIDDEN, "人员不存在或当前身份无效");
            employee.requireGrantable(signed.tenantId(), signed.employeeNo());
            // 远程调用不持有写锁；返回后按当前开通、权限与密钥状态重新准入。
            requireActivation(signed.tenantId());
            available = requireScopes(signed.tenantId(), api);
        }
        ClientApplication app = signatures.current(gateway);
        InvocationContext context = new InvocationContext(app.id(), app.appKey(), signed.tenantId(),
                employee == null ? null : employee.userId(), employee == null ? null : employee.employeeId(),
                employee == null ? null : employee.employeeNo(), List.copyOf(available));
        return new AuthorizedCall(api, context);
    }

    private void requireActivation(String tenantId) {
        if (activations.activeTenantActivation(tenantId).isEmpty())
            throw new PlatformException(ErrorCode.FORBIDDEN, "租户尚未开通MCP或已停用");
    }
    private Set<String> requireScopes(String tenantId, ApiDefinition api) {
        Set<String> available = scopes.availableScopeCodes(tenantId, api.scopeCodes());
        if (available.isEmpty()) throw new PlatformException(ErrorCode.FORBIDDEN, "本租户未开通该工具所需权限组");
        return available;
    }
}
