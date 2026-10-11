package io.github.chenyilei2016.openplatform.infrastructure.publication.dal.impl;

import io.github.chenyilei2016.openplatform.domain.environmentrelease.ReleaseEnvironment;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.UpdateWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import io.github.chenyilei2016.openplatform.domain.catalog.CatalogPageQuery;
import io.github.chenyilei2016.openplatform.domain.common.PageResult;
import io.github.chenyilei2016.openplatform.domain.publication.*;
import io.github.chenyilei2016.openplatform.infrastructure.catalog.ApiDefinitionJson;
import io.github.chenyilei2016.openplatform.infrastructure.common.SqlPatterns;
import io.github.chenyilei2016.openplatform.infrastructure.publication.dal.dataobject.*;
import io.github.chenyilei2016.openplatform.infrastructure.publication.dal.mapper.*;

import lombok.RequiredArgsConstructor;

import org.springframework.stereotype.Repository;

import java.util.Optional;

@Repository
@RequiredArgsConstructor
public class PublicationRepositoryImpl implements PublicationRepository {
    private final ReleaseEnvironment environment;
    private final PublicationReleaseMapper releases;
    private final PublicationStateMapper states;
    private final PublicationAuditMapper audits;
    private final ApiDefinitionJson json;

    @Override
    public Optional<Release> find(String id) {
        return Optional.ofNullable(releases.selectOne(new QueryWrapper<PublicationReleaseDO>().eq("environment_id", environment.environmentId()).eq("id", id))).map(this::release);
    }

    @Override
    public Optional<Release> findSubmission(String key) {
        return Optional.ofNullable(
                        releases.selectOne(
                                new QueryWrapper<PublicationReleaseDO>().eq("environment_id", environment.environmentId()).eq("submission_key", key)))
                .map(this::release);
    }

    @Override
    public PageResult<ReleaseSummary> page(CatalogPageQuery query, ReleaseStatus status, Boolean auditRequired) {
        return releasePage(query, new QueryWrapper<PublicationReleaseDO>().eq("environment_id", environment.environmentId())
                .apply("(name LIKE {0} ESCAPE '!' OR service LIKE {0} ESCAPE '!' OR method LIKE {0} ESCAPE '!')",
                        SqlPatterns.contains(query.query()))
                .eq(status != null, "status", status == null ? null : status.name())
                .eq(auditRequired != null, "audit_required", auditRequired));
    }

    @Override
    public PageResult<ReleaseSummary> apiReleases(String apiId, CatalogPageQuery query) {
        return releasePage(query, new QueryWrapper<PublicationReleaseDO>().eq("environment_id", environment.environmentId()).eq("api_id", apiId));
    }

    private PageResult<ReleaseSummary> releasePage(CatalogPageQuery query, QueryWrapper<PublicationReleaseDO> filter) {
        filter.select("id", "api_id", "name", "service", "version", "method", "draft_revision", "status",
                "audit_required", "submitted_at", "submitted_by_tenant_id", "submitted_by_employee_no",
                "reviewed_at", "reviewed_by_tenant_id", "reviewed_by_employee_no", "failure_reason",
                "kind", "source_release_id", "comment").orderByDesc("submitted_at", "id");
        Page<PublicationReleaseDO> page = releases.selectPage(new Page<>(query.page(), query.pageSize()), filter);
        return new PageResult<>(page.getRecords().stream().map(r -> new ReleaseSummary(
                r.getId(), r.getApiId(), r.getName(), r.getService(), r.getVersion(), r.getMethod(),
                r.getDraftRevision(), ReleaseStatus.valueOf(r.getStatus()), r.getAuditRequired(),
                r.getSubmittedAt(), r.getSubmittedByTenantId(), r.getSubmittedByEmployeeNo(),
                r.getReviewedAt(), r.getReviewedByTenantId(), r.getReviewedByEmployeeNo(), r.getFailureReason(),
                ReleaseKind.valueOf(r.getKind()), r.getSourceReleaseId(), r.getComment())).toList(),
                page.getTotal(), query.page(), query.pageSize());
    }

    @Override
    public java.util.Map<String, Long> draftRevisions(String apiId, java.util.Set<String> releaseIds) {
        if (releaseIds.isEmpty()) return java.util.Map.of();
        if (releaseIds.size() > 2) throw new IllegalArgumentException("工作区最多查询生效与待审两份修订");
        return releases.selectList(new QueryWrapper<PublicationReleaseDO>().eq("environment_id", environment.environmentId())
                        .select("id", "draft_revision").eq("api_id", apiId).in("id", releaseIds))
                .stream().collect(java.util.stream.Collectors.toMap(PublicationReleaseDO::getId, PublicationReleaseDO::getDraftRevision));
    }

    @Override
    public PublicationState state(String apiId) {
        var s = states.selectOne(new QueryWrapper<PublicationStateDO>().eq("environment_id", environment.environmentId()).eq("api_id", apiId));
        return s == null
                ? PublicationState.initial(apiId)
                : new PublicationState(
                        apiId,
                        s.getStateVersion(),
                        s.getEnabled(),
                        s.getLiveReleaseId(),
                        s.getPendingReleaseId());
    }

    @Override
    public void saveState(PublicationState s) {
        if (s.stateVersion() == 1) {
            var row = new PublicationStateDO();
        row.setEnvironmentId(environment.environmentId());
            row.setApiId(s.apiId());
            row.setStateVersion(s.stateVersion());
            row.setEnabled(s.enabled());
            row.setLiveReleaseId(s.liveReleaseId());
            row.setPendingReleaseId(s.pendingReleaseId());
            states.insert(row);
        } else
            states.update(
                    null,
                    new UpdateWrapper<PublicationStateDO>().eq("environment_id", environment.environmentId())
                            .eq("api_id", s.apiId())
                            .set("state_version", s.stateVersion())
                            .set("enabled", s.enabled())
                            .set("live_release_id", s.liveReleaseId())
                            .set("pending_release_id", s.pendingReleaseId()));
    }

    @Override
    public void insert(Release r) {
        var row = new PublicationReleaseDO();
        row.setEnvironmentId(environment.environmentId());
        row.setId(r.id());
        row.setApiId(r.apiId());
        row.setName(r.name());
        row.setCategory(r.snapshot().category());
        row.setLifecycleStatus(r.snapshot().lifecycle().status().name());
        row.setMcpToolEnabled(r.snapshot().mcpTool().enabled());
        row.setService(r.service());
        row.setVersion(r.version());
        row.setMethod(r.method());
        row.setDraftRevision(r.draftRevision());
        row.setStatus(r.status().name());
        row.setAuditRequired(r.auditRequired());
        row.setSubmittedAt(r.submittedAt());
        row.setSubmittedByTenantId(r.submittedByTenantId());
        row.setSubmittedByEmployeeNo(r.submittedByEmployeeNo());
        row.setSubmissionKey(r.submissionKey());
        row.setComment(r.comment());
        if (r.snapshot().binding().dubbo() != null) {
            row.setDubboConnectionId(r.snapshot().binding().dubbo().connectionId());
            row.setDubboConnectionRevision(r.snapshot().binding().dubbo().connectionRevision());
        }
        row.setSnapshotJson(json.encode(r.snapshot()));
        row.setBaselineJson(r.baseline() == null ? null : json.encode(r.baseline()));
        row.setBaselineKnown(r.baselineKnown());
        row.setKind(r.kind().name());
        row.setSourceReleaseId(r.sourceReleaseId());
        row.setBaselineReleaseId(r.baselineReleaseId());
        row.setBaselineStateVersion(r.baselineStateVersion());
        row.setReviewedAt(r.reviewedAt());
        row.setReviewedByTenantId(r.reviewedByTenantId());
        row.setReviewedByEmployeeNo(r.reviewedByEmployeeNo());
        row.setReviewComment(r.reviewComment());
        releases.insert(row);
        if (!r.snapshot().scopeCodes().isEmpty()) releases.insertScopes(environment.environmentId(), r.id(), r.snapshot().scopeCodes());
    }

    @Override
    public void decide(Release r) {
        releases.update(
                null,
                new UpdateWrapper<PublicationReleaseDO>().eq("environment_id", environment.environmentId())
                        .eq("id", r.id())
                        .set("status", r.status().name())
                        .set("reviewed_at", r.reviewedAt())
                        .set("reviewed_by_tenant_id", r.reviewedByTenantId())
                        .set("reviewed_by_employee_no", r.reviewedByEmployeeNo())
                        .set("review_comment", r.reviewComment())
                        .set("failure_reason", r.failureReason()));
    }

    @Override
    public Optional<EffectiveRelease> effective(String apiId) {
        return Optional.ofNullable(releases.effective(environment.environmentId(), apiId)).map(this::effective);
    }

    @Override
    public Optional<EffectiveRelease> effective(String service, String version, String method) {
        return Optional.ofNullable(releases.effectiveOperation(environment.environmentId(), service, version, method))
                .map(this::effective);
    }

    private EffectiveRelease effective(PublicationReleaseDO r) {
        return new EffectiveRelease(
                r.getApiId(),
                r.getId(),
                r.getEffectiveStateVersion(),
                r.getEffectiveEnabled(),
                r.getReviewedAt() == null ? r.getSubmittedAt() : r.getReviewedAt(),
                json.decode(r.getSnapshotJson()));
    }

    private Release release(PublicationReleaseDO r) {
        return new Release(
                r.getId(),
                r.getApiId(),
                r.getName(),
                r.getService(),
                r.getVersion(),
                r.getMethod(),
                r.getDraftRevision(),
                ReleaseStatus.valueOf(r.getStatus()),
                r.getAuditRequired(),
                r.getSubmittedAt(),
                r.getSubmittedByTenantId(),
                r.getSubmittedByEmployeeNo(),
                r.getReviewedAt(),
                r.getReviewedByTenantId(),
                r.getReviewedByEmployeeNo(),
                r.getFailureReason(),
                r.getSubmissionKey(),
                r.getComment(),
                r.getReviewComment(),
                json.decode(r.getSnapshotJson()),
                r.getBaselineJson() == null ? null : json.decode(r.getBaselineJson()),
                Boolean.TRUE.equals(r.getBaselineKnown()),
                ReleaseKind.valueOf(r.getKind()),
                r.getSourceReleaseId(),
                r.getBaselineReleaseId(),
                r.getBaselineStateVersion());
    }

    @Override
    public void appendAudit(PublicationAudit a) {
        var row = new PublicationAuditDO();
        row.setEnvironmentId(environment.environmentId());
        row.setId(a.id());
        row.setApiId(a.apiId());
        row.setReleaseId(a.releaseId());
        row.setAction(a.action());
        row.setOperatorTenantId(a.operatorTenantId());
        row.setOperatorEmployeeNo(a.operatorEmployeeNo());
        row.setOutcome(a.outcome());
        row.setSummary(a.summary());
        row.setRequestId(a.requestId());
        row.setOccurredAt(a.occurredAt());
        audits.insert(row);
    }

    @Override
    public PageResult<PublicationAudit> audit(String apiId, CatalogPageQuery query) {
        var page =
                audits.selectPage(
                        new Page<>(query.page(), query.pageSize()),
                        new QueryWrapper<PublicationAuditDO>().eq("environment_id", environment.environmentId())
                                .eq("api_id", apiId)
                                .orderByDesc("occurred_at", "id"));
        return new PageResult<>(
                page.getRecords().stream()
                        .map(
                                a ->
                                        new PublicationAudit(
                                                a.getId(),
                                                a.getApiId(),
                                                a.getReleaseId(),
                                                a.getAction(),
                                                a.getOperatorTenantId(),
                                                a.getOperatorEmployeeNo(),
                                                a.getOutcome(),
                                                a.getSummary(),
                                                a.getRequestId(),
                                                a.getOccurredAt()))
                        .toList(),
                page.getTotal(),
                query.page(),
                query.pageSize());
    }
}
