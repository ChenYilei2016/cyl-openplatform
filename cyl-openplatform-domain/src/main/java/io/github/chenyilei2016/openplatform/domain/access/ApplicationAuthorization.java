package io.github.chenyilei2016.openplatform.domain.access;

import io.github.chenyilei2016.openplatform.domain.runtime.InvocationContext;
import java.util.List;

/** 一次从持久化事实读取的授权快照，远程身份核验之后必须重新读取比较。 */
public record ApplicationAuthorization(ClientApplication application, TenantGrant tenant, UserGrant user, List<String> scopeCodes) {
    public ApplicationAuthorization { scopeCodes = List.copyOf(scopeCodes); }
    public boolean active() {
        return application.status() == ApplicationStatus.ENABLED && tenant.status() == GrantStatus.ACTIVE
                && (user == null || user.status() == GrantStatus.ACTIVE);
    }
    public AuthorizationSubject subject() {
        return new AuthorizationSubject(application.id(), application.appKey(), tenant.id(), tenant.tenantId(),
                user == null ? null : user.id(), user == null ? null : user.userId(),
                user == null ? null : user.employeeId(), user == null ? null : user.employeeNo());
    }
    public AuthorizationVersions versions() {
        return new AuthorizationVersions(application.authorizationVersion(), tenant.authorizationVersion(), user == null ? 0 : user.authorizationVersion());
    }
    public boolean matches(AuthorizationSubject expectedSubject, AuthorizationVersions expectedVersions, List<String> expectedScopes) {
        return active() && subject().equals(expectedSubject) && versions().equals(expectedVersions) && scopeCodes.equals(expectedScopes);
    }
    public InvocationContext invocationContext() {
        var subject = subject();
        return new InvocationContext(subject.applicationId(), subject.appKey(), subject.tenantId(),
                subject.userId(), subject.employeeId(), subject.employeeNo(), scopeCodes);
    }
}
