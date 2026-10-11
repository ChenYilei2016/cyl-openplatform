package io.github.chenyilei2016.openplatform.domain.publication;

import io.github.chenyilei2016.openplatform.domain.catalog.ApiDefinition;

import java.time.Instant;

/** 提交内容固定；审核仅改变结果元数据。 */
public record Release(
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
        String submissionKey,
        String comment,
        String reviewComment,
        ApiDefinition snapshot,
        ApiDefinition baseline,
        boolean baselineKnown,
        ReleaseKind kind,
        String sourceReleaseId,
        String baselineReleaseId,
        Long baselineStateVersion) {
    public Release decided(
            ReleaseStatus decision,
            String reason,
            String reviewComment,
            String tenantId,
            String employeeNo,
            Instant now) {
        return new Release(
                id,
                apiId,
                name,
                service,
                version,
                method,
                draftRevision,
                decision,
                auditRequired,
                submittedAt,
                submittedByTenantId,
                submittedByEmployeeNo,
                now,
                tenantId,
                employeeNo,
                reason,
                submissionKey,
                comment,
                reviewComment,
                snapshot,
                baseline,
                baselineKnown,
                kind,
                sourceReleaseId,
                baselineReleaseId,
                baselineStateVersion);
    }
}
