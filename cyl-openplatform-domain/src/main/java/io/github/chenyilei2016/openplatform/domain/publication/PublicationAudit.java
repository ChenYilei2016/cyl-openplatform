package io.github.chenyilei2016.openplatform.domain.publication;

import java.time.Instant;

public record PublicationAudit(
        String id,
        String apiId,
        String releaseId,
        String action,
        String operatorTenantId,
        String operatorEmployeeNo,
        String outcome,
        String summary,
        String requestId,
        Instant occurredAt) {}
