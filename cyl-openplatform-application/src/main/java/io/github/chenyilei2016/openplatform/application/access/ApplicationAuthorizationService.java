package io.github.chenyilei2016.openplatform.application.access;

import io.github.chenyilei2016.openplatform.domain.access.ApplicationAuthorization;
import io.github.chenyilei2016.openplatform.domain.access.ApplicationKind;
import io.github.chenyilei2016.openplatform.domain.access.ApplicationRepository;
import io.github.chenyilei2016.openplatform.domain.access.AuthorizationSubject;
import io.github.chenyilei2016.openplatform.domain.access.ClientApplication;
import io.github.chenyilei2016.openplatform.domain.access.EmployeeDirectory;
import io.github.chenyilei2016.openplatform.domain.access.ScopeRepository;
import io.github.chenyilei2016.openplatform.domain.access.TenantGrantRepository;
import io.github.chenyilei2016.openplatform.domain.access.UserGrantRepository;
import io.github.chenyilei2016.openplatform.domain.common.CredentialSecrets;
import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

/** Token与请求签名共用的当前应用、租户和人员授权事实；远程身份核验不持有数据库写锁。 */
@Service
@RequiredArgsConstructor
public class ApplicationAuthorizationService {
    private final ApplicationRepository applications;
    private final TenantGrantRepository tenants;
    private final UserGrantRepository users;
    private final ScopeRepository scopes;
    private final EmployeeDirectory employees;

    public ClientApplication authenticate(String appKey, String secret) {
        // MCP 网关凭据只进入 MCP 入口，不能换取普通 Token。
        ClientApplication app = applications.findByKey(appKey).filter(found -> found.kind() == ApplicationKind.STANDARD)
                .orElseThrow(() -> new PlatformException(ErrorCode.INVALID_CREDENTIALS, "应用凭据无效"));
        if (!CredentialSecrets.matches(secret, applications.secretDigest(app.id()))) {
            throw new PlatformException(ErrorCode.INVALID_CREDENTIALS, "应用凭据无效");
        }
        return app;
    }

    public ApplicationAuthorization forTarget(ClientApplication app, String tenantId, String employeeNo) {
        var tenant = tenants.findByTenant(app.id(), tenantId).orElseThrow(() ->
                new PlatformException(ErrorCode.FORBIDDEN, "应用未获目标租户授权"));
        var user = employeeNo == null ? null : users.findByEmployeeNo(tenant.id(), employeeNo).orElseThrow(() ->
                new PlatformException(ErrorCode.FORBIDDEN, "人员未获此租户下的应用授权"));
        var authorization = new ApplicationAuthorization(app, tenant, user, scopes.enabledCodes(app.scopeCodes()));
        if (!authorization.active()) throw new PlatformException(ErrorCode.FORBIDDEN, "应用或目标授权已停用");
        return authorization;
    }

    public ApplicationAuthorization current(AuthorizationSubject subject) {
        var app = applications.find(subject.applicationId()).orElseThrow(this::invalidAuthorization);
        var tenant = tenants.find(subject.tenantGrantId()).orElseThrow(this::invalidAuthorization);
        var user = subject.userGrantId() == null ? null : users.find(subject.userGrantId()).orElseThrow(this::invalidAuthorization);
        if (!tenant.applicationId().equals(app.id()) || (user != null && !user.tenantGrantId().equals(tenant.id()))) {
            throw invalidAuthorization();
        }
        return new ApplicationAuthorization(app, tenant, user, scopes.enabledCodes(app.scopeCodes()));
    }

    public void verifyEmployee(ApplicationAuthorization authorization) {
        if (authorization.user() == null) return;
        var identity = employees.find(authorization.tenant().tenantId(), authorization.user().employeeNo());
        identity.requireGrantable(authorization.tenant().tenantId(), authorization.user().employeeNo());
        if (!identity.userId().equals(authorization.user().userId()) || !identity.employeeId().equals(authorization.user().employeeId())) {
            throw new PlatformException(ErrorCode.FORBIDDEN, "当前人员身份与已授权身份不一致");
        }
    }

    private PlatformException invalidAuthorization() { return new PlatformException(ErrorCode.FORBIDDEN, "调用授权无效或已失效"); }
}
