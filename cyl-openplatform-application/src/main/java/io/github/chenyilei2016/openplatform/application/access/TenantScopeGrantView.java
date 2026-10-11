package io.github.chenyilei2016.openplatform.application.access;

import io.github.chenyilei2016.openplatform.domain.access.TenantScopeGrant;
import java.time.Instant;

/** 租户权限展示：tenantName 与 grantedByName 为最近登记的展示名称，取不到时为 null，不作授权依据。 */
public record TenantScopeGrantView(String id, String scopeCode, String tenantId, String tenantName, String status,
                                   String grantedByTenantId, String grantedByEmployeeNo, String grantedByName,
                                   Instant createdAt, Instant updatedAt, long revision) {
    public static TenantScopeGrantView from(TenantScopeGrant grant, String tenantName, String grantedByName) {
        return new TenantScopeGrantView(grant.id(), grant.scopeCode(), grant.tenantId(), tenantName, grant.status().name(),
                grant.grantedByTenantId(), grant.grantedByEmployeeNo(), grantedByName,
                grant.createdAt(), grant.updatedAt(), grant.revision());
    }
}
