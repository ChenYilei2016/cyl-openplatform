package io.github.chenyilei2016.openplatform.domain.access;

import java.time.Instant;

public record AccessAudit(String id, String applicationId, String action, String operatorTenantId,
                          String operatorEmployeeNo, String targetTenantId, String targetId,
                          String outcome, String summary, String requestId, Instant occurredAt,
                          String operatorUserId, String operatorEmployeeId, String tenantGrantId,
                          String targetUserId, String targetEmployeeId, String targetEmployeeNo) {
    /** 仅携带已核验归属或本地账号身份的目标，不以请求参数伪造审计事实。 */
    public record EmployeeTarget(String tenantGrantId, String userId, String employeeId, String employeeNo) {
        public static EmployeeTarget from(String tenantGrantId, EmployeeIdentity identity) {
            return new EmployeeTarget(tenantGrantId, identity.userId(), identity.employeeId(), identity.employeeNo());
        }
        public static EmployeeTarget from(UserGrant grant) {
            return new EmployeeTarget(grant.tenantGrantId(), grant.userId(), grant.employeeId(), grant.employeeNo());
        }
    }
}
