package io.github.chenyilei2016.openplatform.domain.publication;

import java.time.Instant;

public record ReleaseSummary(
        String id,
        String apiId,
        String name,
        String service,
        String version,
        String method,
        long draftRevision,
        ReleaseStatus status,
        boolean auditRequired,
        Instant submittedAt,
        String submittedByTenantId,
        String submittedByEmployeeNo,
        Instant reviewedAt,
        String reviewedByTenantId,
        String reviewedByEmployeeNo,
        String failureReason,
        ReleaseKind kind,
        String sourceReleaseId,
        String comment) {}
