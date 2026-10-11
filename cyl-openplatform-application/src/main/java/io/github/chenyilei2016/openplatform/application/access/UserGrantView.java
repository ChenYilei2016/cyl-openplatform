package io.github.chenyilei2016.openplatform.application.access;

import io.github.chenyilei2016.openplatform.domain.access.UserGrant;

public record UserGrantView(String id, String tenantGrantId, String tenantId, String userId,
                            String employeeId, String employeeNo, String displayName, String status,
                            long authorizationVersion) {
    public static UserGrantView from(UserGrant grant) {
        return new UserGrantView(grant.id(), grant.tenantGrantId(), grant.tenantId(), grant.userId(),
                grant.employeeId(), grant.employeeNo(), grant.displayName(), grant.status().name(), grant.authorizationVersion());
    }
}
