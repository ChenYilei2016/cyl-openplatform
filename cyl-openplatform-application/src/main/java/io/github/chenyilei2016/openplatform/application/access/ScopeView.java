package io.github.chenyilei2016.openplatform.application.access;

import io.github.chenyilei2016.openplatform.domain.access.Scope;
import io.github.chenyilei2016.openplatform.domain.access.ScopeUsage;

/** apiCount 只计已发布生效版本携带该组的 API；草稿中的增删发布后才计入。credentialCount 为持有该组的凭据数。 */
public record ScopeView(String id, String code, String name, boolean enabled, boolean defaultForNewApplication,
                        boolean publicAccess, long apiCount, long credentialCount, long tenantCount) {
    public static ScopeView from(Scope scope, ScopeUsage usage) {
        return new ScopeView(scope.id(), scope.code(), scope.name(), scope.enabled(), scope.defaultForNewApplication(),
                scope.publicAccess(), usage.apiCount(), usage.credentialCount(), usage.tenantCount());
    }
}
