package io.github.chenyilei2016.openplatform.application.access;

import io.github.chenyilei2016.openplatform.domain.access.GrantStatus;
import io.github.chenyilei2016.openplatform.domain.access.TenantScopePermission;

public record TenantScopePermissionView(String id, String code, String name, boolean enabled, boolean publicAccess,
                                        String grantId, GrantStatus grantStatus, boolean available) {
    public static TenantScopePermissionView from(TenantScopePermission value) {
        return new TenantScopePermissionView(value.scope().id(), value.scope().code(), value.scope().name(), value.scope().enabled(),
                value.scope().publicAccess(), value.grantId(), value.grantStatus(), value.available());
    }
}
