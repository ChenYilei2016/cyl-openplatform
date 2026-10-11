package io.github.chenyilei2016.openplatform.domain.observability;

import java.time.Instant;

/** 现有管理审计的只读投影；不复制快照和可能包含用户原文的说明。 */
public record ManagementAudit(String id, AuditSource source, String requestId,
                              String apiId, String applicationId, String tenantId, String targetId,
                              String action, String outcome, String actorKind,
                              String operatorTenantId, String operatorEmployeeNo,
                              String releaseId, Long draftRevision, Instant occurredAt) {}
