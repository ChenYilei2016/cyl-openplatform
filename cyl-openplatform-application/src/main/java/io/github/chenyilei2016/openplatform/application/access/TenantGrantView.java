package io.github.chenyilei2016.openplatform.application.access;

import io.github.chenyilei2016.openplatform.domain.access.TenantGrant;

public record TenantGrantView(String id, String applicationId, String tenantId, String status, long authorizationVersion, String note, long noteRevision, String tenantName) {
    public static TenantGrantView from(TenantGrant grant) {
        return new TenantGrantView(grant.id(), grant.applicationId(), grant.tenantId(), grant.status().name(), grant.authorizationVersion(), grant.note(), grant.noteRevision(), null);
    }
    public TenantGrantView withTenantName(String name) {
        return new TenantGrantView(id, applicationId, tenantId, status, authorizationVersion, note, noteRevision, name);
    }
}
