package io.github.chenyilei2016.openplatform.domain.access;

public record UserGrant(String id, String tenantGrantId, String tenantId, String userId,
                        String employeeId, String employeeNo, String displayName,
                        GrantStatus status, long authorizationVersion) {}
