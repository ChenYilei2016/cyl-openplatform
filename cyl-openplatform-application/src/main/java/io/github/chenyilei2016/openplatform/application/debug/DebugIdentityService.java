package io.github.chenyilei2016.openplatform.application.debug;

import io.github.chenyilei2016.openplatform.application.access.ApplicationAuthorizationService;
import io.github.chenyilei2016.openplatform.application.catalog.ApiCatalogService;
import io.github.chenyilei2016.openplatform.application.token.TokenAuditService;
import io.github.chenyilei2016.openplatform.domain.access.AccessPageQuery;
import io.github.chenyilei2016.openplatform.domain.access.ApplicationRepository;
import io.github.chenyilei2016.openplatform.domain.access.ApplicationAuthorization;
import io.github.chenyilei2016.openplatform.domain.access.AuthorizationSubject;
import io.github.chenyilei2016.openplatform.domain.access.CallableGrant;
import io.github.chenyilei2016.openplatform.domain.access.ClientApplication;
import io.github.chenyilei2016.openplatform.domain.access.DebugIdentityRepository;
import io.github.chenyilei2016.openplatform.domain.access.EmployeeProfileRepository;
import io.github.chenyilei2016.openplatform.domain.access.GrantStatus;
import io.github.chenyilei2016.openplatform.domain.access.ScopeRepository;
import io.github.chenyilei2016.openplatform.domain.access.TenantGrant;
import io.github.chenyilei2016.openplatform.domain.access.TenantGrantRepository;
import io.github.chenyilei2016.openplatform.domain.access.UserGrant;
import io.github.chenyilei2016.openplatform.domain.access.UserGrantRepository;
import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PageResult;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.github.chenyilei2016.openplatform.domain.token.TokenAction;
import io.github.chenyilei2016.openplatform.domain.token.TokenAuditActor;
import io.github.chenyilei2016.openplatform.domain.token.TokenAuditTarget;
import io.github.chenyilei2016.openplatform.domain.token.TokenContext;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

/**
 * 112：草稿调试“选凭据代换身份”。可选项只列启用凭据在有效租户下、且拥有该 API 任一已启用权限组的授权；
 * 执行时按与业务 Token 相同的事实重新构造身份（凭据、租户、人员授权及平台人员核验），不签发、不返回 Token。
 */
@Service
@RequiredArgsConstructor
public class DebugIdentityService {
    private final ApiCatalogService catalog;
    private final ScopeRepository scopes;
    private final DebugIdentityRepository identities;
    private final EmployeeProfileRepository profiles;
    private final ApplicationRepository applications;
    private final TenantGrantRepository tenants;
    private final UserGrantRepository users;
    private final ApplicationAuthorizationService authorizations;
    private final TokenAuditService audit;

    /** AK 只返回末 4 位，后台调试者不一定有凭据管理权限。 */
    public record Candidate(String tenantGrantId, String applicationId, String applicationName, String appKeyTail,
                            String tenantId, String tenantName, String note) {}
    public record Employee(String userGrantId, String employeeNo, String displayName) {}

    public PageResult<Candidate> candidates(String apiId, AccessPageQuery query) {
        List<String> codes = scopes.enabledCodes(catalog.find(apiId).scopeCodes());
        PageResult<CallableGrant> page = identities.callableGrants(codes, query);
        Map<String, String> names = page.items().isEmpty() ? Map.of()
                : profiles.tenantNames(page.items().stream().map(item -> item.tenantId()).distinct().toList());
        return new PageResult<>(page.items().stream().map(item -> new Candidate(item.tenantGrantId(), item.applicationId(),
                item.applicationName(), tail(item.appKey()), item.tenantId(), names.get(item.tenantId()), item.note())).toList(),
                page.total(), page.page(), page.pageSize());
    }

    public PageResult<Employee> employees(String apiId, String tenantGrantId, AccessPageQuery query) {
        catalog.find(apiId);
        TenantGrant tenant = tenants.find(tenantGrantId).filter(grant -> grant.status() == GrantStatus.ACTIVE)
                .orElseThrow(() -> new PlatformException(ErrorCode.NOT_FOUND, "所选凭据授权不存在或已撤销"));
        PageResult<UserGrant> page = identities.activeUsers(tenant.id(), query);
        return new PageResult<>(page.items().stream().map(user -> new Employee(user.id(), user.employeeNo(), user.displayName())).toList(),
                page.total(), page.page(), page.pageSize());
    }

    /**
     * 按当前事实解析调用身份；execute 为 true 时写入管理审计（Token 审计来源，动作 DEBUG_AS_APP）。
     * 权限组与“必须指定员工”仍由执行器按与正式调用相同的规则判断。
     */
    public TokenContext resolve(DebugCaller.Credential caller, String requestId, boolean execute) {
        TokenAuditActor actor = new TokenAuditActor(TokenAuditActor.Kind.ADMIN, caller.operatorTenantId(), caller.operatorEmployeeNo());
        TokenAuditTarget target = new TokenAuditTarget(null, null, null, null, null);
        try {
            TenantGrant tenant = tenants.find(caller.tenantGrantId())
                    .orElseThrow(() -> new PlatformException(ErrorCode.FORBIDDEN, "所选凭据授权不存在或已撤销"));
            ClientApplication app = applications.find(tenant.applicationId())
                    .orElseThrow(() -> new PlatformException(ErrorCode.FORBIDDEN, "所选凭据不存在"));
            target = new TokenAuditTarget(null, app.id(), app.appKey(), tenant.tenantId(), null);
            String employeeNo = null;
            if (caller.userGrantId() != null) {
                UserGrant user = users.find(caller.userGrantId()).filter(grant -> grant.tenantGrantId().equals(tenant.id()))
                        .orElseThrow(() -> new PlatformException(ErrorCode.FORBIDDEN, "所选人员未获此凭据在该租户下的授权"));
                employeeNo = user.employeeNo();
            }
            ApplicationAuthorization authorization = authorizations.forTarget(app, tenant.tenantId(), employeeNo);
            authorizations.verifyEmployee(authorization);
            // 与人员 Token 相同，在远程核验后复核撤销、状态、版本及权限组。
            if (authorization.user() != null && !authorizations.current(authorization.subject())
                    .matches(authorization.subject(), authorization.versions(), authorization.scopeCodes())) {
                throw new PlatformException(ErrorCode.FORBIDDEN, "调用授权在人员核验期间发生变化，请重新选择调用身份");
            }
            AuthorizationSubject subject = authorization.subject();
            target = new TokenAuditTarget(null, subject.applicationId(), subject.appKey(), subject.tenantId(), subject.userId());
            if (execute) audit.success(TokenAction.DEBUG_AS_APP, actor, target, requestId);
            return new TokenContext(null, subject.applicationId(), subject.appKey(), subject.tenantId(), subject.userId(),
                    subject.employeeId(), subject.employeeNo(), authorization.scopeCodes(), null);
        } catch (RuntimeException failure) {
            if (!execute) throw failure;
            PlatformException recorded = audit.failure(TokenAction.DEBUG_AS_APP, actor, target, requestId, failure);
            throw failure instanceof PlatformException known ? known : recorded;
        }
    }

    private static String tail(String appKey) {
        return appKey == null ? null : appKey.substring(Math.max(0, appKey.length() - 4));
    }
}
