package io.github.chenyilei2016.openplatform.domain.administration;

import java.time.Instant;

/** 授权变更的前后完整快照，不包含公司凭据或会话Token。 */
public record AdministratorAudit(
        String id,
        String administratorId,
        String operatorTenantId,
        String operatorEmployeeNo,
        String action,
        String reason,
        Administrator before,
        Administrator after,
        String requestId,
        Instant occurredAt) {}
