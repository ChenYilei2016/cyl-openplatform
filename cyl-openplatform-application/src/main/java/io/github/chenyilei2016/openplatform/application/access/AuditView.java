package io.github.chenyilei2016.openplatform.application.access;

import io.github.chenyilei2016.openplatform.domain.access.AccessAudit;
import java.time.Instant;

public record AuditView(String id, String action, String operatorTenantId, String operatorEmployeeNo,
                        String targetTenantId, String targetId, String outcome, String summary,
                        String requestId, Instant occurredAt, String operatorUserId, String operatorEmployeeId,
                        String tenantGrantId, String targetUserId, String targetEmployeeId, String targetEmployeeNo) {
    public static AuditView from(AccessAudit audit) {
        return new AuditView(audit.id(), audit.action(), audit.operatorTenantId(), audit.operatorEmployeeNo(),
                audit.targetTenantId(), audit.targetId(), audit.outcome(), audit.summary(), audit.requestId(), audit.occurredAt(), audit.operatorUserId(), audit.operatorEmployeeId(),
                audit.tenantGrantId(), audit.targetUserId(), audit.targetEmployeeId(), audit.targetEmployeeNo());
    }
}
