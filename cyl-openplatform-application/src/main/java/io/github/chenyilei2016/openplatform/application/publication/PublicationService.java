package io.github.chenyilei2016.openplatform.application.publication;

import io.github.chenyilei2016.openplatform.domain.common.ObjectIdType;
import io.github.chenyilei2016.openplatform.application.administration.OperatorNames;
import io.github.chenyilei2016.openplatform.application.catalog.McpToolNamePolicy;
import io.github.chenyilei2016.openplatform.application.connection.DubboBindingPolicy;
import io.github.chenyilei2016.openplatform.domain.administration.OperatorRef;
import io.github.chenyilei2016.openplatform.domain.access.AccessOperator;
import io.github.chenyilei2016.openplatform.domain.access.Scope;
import io.github.chenyilei2016.openplatform.domain.access.ScopeRepository;
import io.github.chenyilei2016.openplatform.domain.catalog.*;
import io.github.chenyilei2016.openplatform.domain.common.*;
import io.github.chenyilei2016.openplatform.domain.publication.*;

import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.function.Supplier;
import java.util.stream.Stream;

/** scope → API父行锁的统一顺序；运行指针、审核结果及成功审计原子提交。 */
@Slf4j
@Service
public class PublicationService {
    private final ApiCatalogRepository catalog;
    private final ScopeRepository scopes;
    private final DubboBindingPolicy bindings;
    private final McpToolNamePolicy toolNames;
    private final PublicationRepository publications;
    private final PublishSettings settings;
    private final OperatorNames operatorNames;
    private final TransactionTemplate changes;
    private final TransactionTemplate failures;

    public PublicationService(
            ApiCatalogRepository catalog,
            ScopeRepository scopes,
            DubboBindingPolicy bindings,
            McpToolNamePolicy toolNames,
            PublicationRepository publications,
            PublishSettings settings,
            OperatorNames operatorNames,
            PlatformTransactionManager transactions) {
        this.catalog = catalog;
        this.scopes = scopes;
        this.bindings = bindings;
        this.toolNames = toolNames;
        this.publications = publications;
        this.settings = settings;
        this.operatorNames = operatorNames;
        changes = new TransactionTemplate(transactions);
        changes.setIsolationLevel(TransactionDefinition.ISOLATION_READ_COMMITTED);
        failures = new TransactionTemplate(transactions);
        failures.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    /** 当前名称仅作展示元信息，不进入发布内容或修订。 */
    public List<Scope> currentScopes(List<String> codes) {
        return scopes.findByCodes(codes.stream().distinct().toList());
    }

    public boolean auditEnabled() {
        return settings.auditEnabled();
    }

    public PageResult<ApiSummary> apis(CatalogPageQuery query) {
        return catalog.page(query, new io.github.chenyilei2016.openplatform.domain.catalog.ApiCatalogFilter(null, null, null, null, null));
    }

    /** 发布人员只读核对当前草稿；提交时仍独立校验草稿与状态版本。 */
    public ApiDefinition candidate(String apiId) {
        return requireDraft(apiId);
    }

    /** 发布记录及提交人、审核人的展示姓名；姓名只作展示，未登记时为 null。 */
    public record ReleaseEntry(ReleaseSummary release, String submittedByName, String reviewedByName) {}

    /** 发布操作审计及操作人展示姓名。 */
    public record AuditEntry(PublicationAudit audit, String operatorName) {}

    public PageResult<ReleaseEntry> page(CatalogPageQuery query, ReleaseStatus status, Boolean auditRequired) {
        return named(publications.page(query, status, auditRequired));
    }

    public PageResult<ReleaseEntry> apiReleases(String apiId, CatalogPageQuery query) {
        requireDraft(apiId);
        return named(publications.apiReleases(apiId, query));
    }

    private PageResult<ReleaseEntry> named(PageResult<ReleaseSummary> page) {
        Map<OperatorRef, String> names = operatorNames.of(page.items().stream().flatMap(item -> Stream.of(
                new OperatorRef(item.submittedByTenantId(), item.submittedByEmployeeNo()),
                new OperatorRef(item.reviewedByTenantId(), item.reviewedByEmployeeNo()))));
        return page.map(item -> new ReleaseEntry(item,
                names.get(new OperatorRef(item.submittedByTenantId(), item.submittedByEmployeeNo())),
                names.get(new OperatorRef(item.reviewedByTenantId(), item.reviewedByEmployeeNo()))));
    }

    /** 未知提交结果按原幂等键只读查询，不触发新的发布。 */
    public Release submission(String apiId, String key) {
        return publications.findSubmission(key).filter(release -> release.apiId().equals(apiId))
                .orElseThrow(() -> new PlatformException(ErrorCode.NOT_FOUND, "尚未查询到这次发布提交"));
    }

    public Release find(String id) {
        return publications
                .find(id)
                .orElseThrow(() -> new PlatformException(ErrorCode.NOT_FOUND, "发布记录不存在"));
    }

    /** 发布详情及提交人、审核人的展示姓名（与列表同一来源，未登记时为 null）。 */
    public record NamedRelease(Release release, String submittedByName, String reviewedByName) {}

    public NamedRelease findNamed(String id) {
        Release release = find(id);
        OperatorRef submitter = new OperatorRef(release.submittedByTenantId(), release.submittedByEmployeeNo());
        OperatorRef reviewer = new OperatorRef(release.reviewedByTenantId(), release.reviewedByEmployeeNo());
        Map<OperatorRef, String> names = operatorNames.of(Stream.of(submitter, reviewer));
        return new NamedRelease(release, names.get(submitter), names.get(reviewer));
    }

    public PublicationState state(String apiId) {
        requireDraft(apiId);
        return publications.state(apiId);
    }

    public EffectiveRelease effective(String apiId) {
        return publications
                .effective(apiId)
                .orElseThrow(() -> new PlatformException(ErrorCode.NOT_FOUND, "API尚未发布"));
    }

    public PageResult<AuditEntry> audit(String apiId, CatalogPageQuery query) {
        requireDraft(apiId);
        PageResult<PublicationAudit> page = publications.audit(apiId, query);
        Map<OperatorRef, String> names = operatorNames.of(page.items().stream()
                .map(item -> new OperatorRef(item.operatorTenantId(), item.operatorEmployeeNo())));
        return page.map(item -> new AuditEntry(item, names.get(new OperatorRef(item.operatorTenantId(), item.operatorEmployeeNo()))));
    }

    public Release submit(
            String apiId, long revision, long expectedStateVersion, String key, String comment,
            AccessOperator operator) {
        return submit(new Submission(apiId, revision, null, null, expectedStateVersion, key, comment,
                ReleaseKind.STANDARD), operator);
    }

    public Release rollback(
            String apiId, String sourceReleaseId, String expectedLiveReleaseId, long expectedStateVersion,
            String key, String comment, AccessOperator operator) {
        return submit(new Submission(apiId, null, sourceReleaseId, expectedLiveReleaseId,
                expectedStateVersion, key, comment, ReleaseKind.ROLLBACK), operator);
    }

    /** 两类提交共享加锁、幂等恢复与审计；仅快照来源和请求基线不同。 */
    private record Submission(String apiId, Long revision, String sourceReleaseId,
                              String expectedLiveReleaseId, long expectedStateVersion,
                              String key, String comment, ReleaseKind kind) {}

    private Release submit(Submission request, AccessOperator operator) {
        try {
            return changes.execute(transaction -> {
                Release previous = publications.findSubmission(request.key()).orElse(null);
                if (previous != null) return retry(previous, request, operator);
                // 非锁定读取只决定 scope 锁集合；锁父行后重核修订或固定发布基线。
                ApiDefinition candidate = request.kind() == ReleaseKind.ROLLBACK
                        ? rollbackSource(request.apiId(), request.sourceReleaseId()).snapshot()
                        : requireDraft(request.apiId());
                validate(candidate);
                ApiDefinition draft = lock(request.apiId());
                previous = publications.findSubmission(request.key()).orElse(null);
                if (previous != null) return retry(previous, request, operator);
                PublicationState state = publications.state(request.apiId());
                if (request.kind() == ReleaseKind.STANDARD
                        && (draft.draftRevision() != request.revision()
                        || candidate.draftRevision() != draft.draftRevision()))
                    conflict("草稿已修改，请重新核对修订");
                if (state.stateVersion() != request.expectedStateVersion()
                        || (request.kind() == ReleaseKind.ROLLBACK
                        && !Objects.equals(state.liveReleaseId(), request.expectedLiveReleaseId())))
                    conflict("发布状态或生效基线已变化，请重新核对差异后提交");
                if (request.kind() == ReleaseKind.ROLLBACK
                        && Objects.equals(state.liveReleaseId(), request.sourceReleaseId()))
                    conflict("所选发布记录已是当前生效版本");
                return createSubmission(candidate, request.key(), request.comment(), operator,
                        request.kind(), request.sourceReleaseId());
            });
        } catch (RuntimeException failure) {
            // 并发请求可能已提交成功；新事务视图只复核幂等事实，不重写指针或审计。
            Release recorded = null;
            try {
                recorded = publications.findSubmission(request.key()).orElse(null);
            } catch (RuntimeException lookupFailure) {
                /* 存储仍不可读时保留原错误，不猜测成功。 */
            }
            String action = request.kind() == ReleaseKind.ROLLBACK ? "ROLLBACK" : "SUBMIT";
            if (recorded != null) {
                try {
                    return retry(recorded, request, operator);
                } catch (PlatformException mismatch) {
                    throw recordFailure(action, request.apiId(), recorded.id(), operator, mismatch);
                }
            }
            throw recordFailure(action, request.apiId(), null, operator, failure);
        }
    }

    private Release rollbackSource(String apiId, String sourceReleaseId) {
        Release source = find(sourceReleaseId);
        if (!source.apiId().equals(apiId) || source.status() != ReleaseStatus.APPLIED)
            throw new PlatformException(ErrorCode.INVALID_REQUEST, "只能回滚当前API的历史已生效发布记录");
        return source;
    }

    /** 在调用方已校验并持有scope→目录父行锁的事务内提交固定快照。 本地提交与跨环境接收共用；失败必须交由最外层事务回滚后处理。 */
    @org.springframework.transaction.annotation.Transactional(
            propagation = org.springframework.transaction.annotation.Propagation.MANDATORY)
    public Release submitLockedSnapshot(
            ApiDefinition snapshot, String key, String comment, AccessOperator operator) {
        if (!org.springframework.transaction.support.TransactionSynchronizationManager
                .isActualTransactionActive()) throw new IllegalStateException("发布快照必须在持锁事务内提交");
        return createSubmission(snapshot, key, comment, operator, ReleaseKind.STANDARD, null);
    }

    private Release createSubmission(ApiDefinition snapshot, String key, String comment,
                                     AccessOperator operator, ReleaseKind kind, String sourceReleaseId) {
        PublicationState state = publications.state(snapshot.id());
        if (state.pendingReleaseId() != null) conflict("已有待审申请，请先完成审核");
        ApiDefinition baseline = state.liveReleaseId() == null ? null : find(state.liveReleaseId()).snapshot();
        boolean audit = auditEnabled();
        Instant now = Instant.now();
        Release release =
                new Release(
                        ObjectIdType.API_RELEASE.nextId(),
                        snapshot.id(),
                        snapshot.name(),
                        snapshot.service(),
                        snapshot.version(),
                        snapshot.method(),
                        snapshot.draftRevision(),
                        audit ? ReleaseStatus.PENDING : ReleaseStatus.APPLIED,
                        audit,
                        now,
                        operator.tenantId(),
                        operator.employeeNo(),
                        null,
                        null,
                        null,
                        null,
                        key,
                        comment,
                        null,
                        snapshot,
                        baseline,
                        true,
                        kind,
                        sourceReleaseId,
                        state.liveReleaseId(),
                        state.stateVersion());
        publications.insert(release);
        publications.saveState(state.submitted(release.id(), audit));
        record(
                kind == ReleaseKind.ROLLBACK ? "ROLLBACK" : "SUBMIT",
                snapshot.id(),
                release.id(),
                operator,
                "SUCCESS",
                audit ? "已提交待审快照" : "审核关闭，提交直接生效");
        return release;
    }

    public Release approve(String id, String comment, AccessOperator operator) {
        Release candidate = find(id);
        return change(
                "APPROVE",
                candidate.apiId(),
                id,
                operator,
                () -> {
                    String validationFailure = null;
                    try {
                        validate(candidate.snapshot());
                    } catch (PlatformException invalid) {
                        validationFailure = invalid.getMessage();
                    }
                    lock(candidate.apiId());
                    Release current = find(id);
                    PublicationState state = publications.state(candidate.apiId());
                    requirePending(current, state);
                    if (!current.baselineKnown() || current.baselineStateVersion() == null)
                        conflict("缺少固定比较基线，请拒绝此申请后重新提交审核");
                    if (!Objects.equals(current.baselineReleaseId(), state.liveReleaseId())
                            || (current.kind() == ReleaseKind.ROLLBACK
                            && state.stateVersion() != current.baselineStateVersion() + 1))
                        conflict("生效基线已变化，请拒绝此申请后重新核对并提交");
                    Release result =
                            current.decided(
                                    validationFailure == null
                                            ? ReleaseStatus.APPLIED
                                            : ReleaseStatus.FAILED,
                                    validationFailure,
                                    comment,
                                    operator.tenantId(),
                                    operator.employeeNo(),
                                    Instant.now());
                    publications.decide(result);
                    publications.saveState(state.decided(id, validationFailure == null));
                    record(
                            "APPROVE",
                            current.apiId(),
                            id,
                            operator,
                            validationFailure == null ? "SUCCESS" : "FAILURE",
                            validationFailure == null ? "审核通过并生效" : "提交快照失效，保留原生效版本");
                    return result;
                });
    }

    public Release reject(String id, String comment, AccessOperator operator) {
        Release candidate = find(id);
        return change(
                "REJECT",
                candidate.apiId(),
                id,
                operator,
                () -> {
                    lock(candidate.apiId());
                    Release current = find(id);
                    PublicationState state = publications.state(candidate.apiId());
                    requirePending(current, state);
                    Release result =
                            current.decided(
                                    ReleaseStatus.REJECTED,
                                    null,
                                    comment,
                                    operator.tenantId(),
                                    operator.employeeNo(),
                                    Instant.now());
                    publications.decide(result);
                    publications.saveState(state.decided(id, false));
                    record("REJECT", current.apiId(), id, operator, "SUCCESS", "已拒绝发布申请");
                    return result;
                });
    }

    public PublicationState status(
            String apiId,
            boolean enabled,
            long expectedVersion,
            String reason,
            AccessOperator operator) {
        return change(
                enabled ? "ENABLE" : "DISABLE",
                apiId,
                null,
                operator,
                () -> {
                    EffectiveRelease candidate = enabled ? effective(apiId) : null;
                    if (enabled) validate(candidate.snapshot());
                    lock(apiId);
                    PublicationState current = publications.state(apiId);
                    if (current.stateVersion() != expectedVersion
                            || (enabled && !candidate.releaseId().equals(current.liveReleaseId())))
                        conflict("发布状态已变更，请刷新后操作");
                    PublicationState changed = current.enabled(enabled);
                    publications.saveState(changed);
                    record(
                            enabled ? "ENABLE" : "DISABLE",
                            apiId,
                            current.liveReleaseId(),
                            operator,
                            "SUCCESS",
                            reason);
                    return changed;
                });
    }

    private ApiDefinition requireDraft(String id) {
        return catalog.find(id)
                .orElseThrow(() -> new PlatformException(ErrorCode.NOT_FOUND, "API不存在"));
    }

    private ApiDefinition lock(String id) {
        return catalog.lock(id)
                .orElseThrow(() -> new PlatformException(ErrorCode.NOT_FOUND, "API不存在"));
    }

    private void validate(ApiDefinition snapshot) {
        snapshot.validate();
        toolNames.require(snapshot);
        bindings.validate(snapshot, snapshot);
        if (snapshot.scopeCodes().isEmpty() || !scopes.allEnabled(snapshot.scopeCodes()))
            throw new PlatformException(ErrorCode.INVALID_REQUEST, "发布权限组为空、不存在或已停用");
    }

    private Release retry(Release previous, Submission request, AccessOperator operator) {
        boolean matches = previous.kind() == request.kind()
                && previous.apiId().equals(request.apiId())
                && Objects.equals(previous.comment(), request.comment());
        if (request.kind() == ReleaseKind.ROLLBACK) {
            matches = matches && Objects.equals(previous.sourceReleaseId(), request.sourceReleaseId())
                    && Objects.equals(previous.baselineReleaseId(), request.expectedLiveReleaseId())
                    && Objects.equals(previous.baselineStateVersion(), request.expectedStateVersion())
                    && previous.submittedByTenantId().equals(operator.tenantId())
                    && previous.submittedByEmployeeNo().equals(operator.employeeNo());
        } else {
            // 兼容普通发布：查询到同一修订和备注后返回原结果，不用新的状态版本重发。
            matches = matches && previous.draftRevision() == request.revision();
        }
        if (!matches) conflict("提交幂等键已用于其他内容或操作人");
        return previous;
    }

    private void requirePending(Release release, PublicationState state) {
        if (!release.status().pending() || !release.id().equals(state.pendingReleaseId()))
            conflict("申请已处理，不能重复审核");
    }

    private static void conflict(String message) {
        throw new PlatformException(ErrorCode.CONFLICT, message);
    }

    private <T> T change(
            String action,
            String apiId,
            String releaseId,
            AccessOperator operator,
            Supplier<T> mutation) {
        try {
            return changes.execute(status -> mutation.get());
        } catch (RuntimeException failure) {
            throw recordFailure(action, apiId, releaseId, operator, failure);
        }
    }

    private PlatformException recordFailure(
            String action,
            String apiId,
            String releaseId,
            AccessOperator operator,
            RuntimeException failure) {
        ErrorCode errorCode = ErrorCode.INTERNAL_ERROR;
        if (failure instanceof DataIntegrityViolationException) errorCode = ErrorCode.CONFLICT;
        for (Throwable cause = failure; cause != null; cause = cause.getCause()) {
            if (cause instanceof DataAccessResourceFailureException
                    || cause instanceof TransientDataAccessResourceException
                    || cause instanceof QueryTimeoutException
                    || cause instanceof java.sql.SQLTimeoutException
                    || cause instanceof java.sql.SQLTransientConnectionException
                    || cause instanceof java.sql.SQLNonTransientConnectionException) {
                errorCode = ErrorCode.DEPENDENCY_UNAVAILABLE;
                break;
            }
            if (cause == cause.getCause()) break;
        }
        PlatformException translated =
                failure instanceof PlatformException known
                        ? known
                        : new PlatformException(errorCode, errorCode.getMessage(), failure);
        try {
            failures.executeWithoutResult(
                    status ->
                            record(
                                    action,
                                    apiId,
                                    releaseId,
                                    operator,
                                    "FAILURE",
                                    translated.getErrorCode().getMessage()));
        } catch (RuntimeException auditFailure) {
            log.error("发布失败审计未落库 requestId={}", operator.requestId(), auditFailure);
        }
        return translated;
    }

    private void record(
            String action,
            String apiId,
            String releaseId,
            AccessOperator operator,
            String outcome,
            String summary) {
        publications.appendAudit(
                new PublicationAudit(
                        ObjectIdType.PUBLICATION_AUDIT.nextId(),
                        apiId,
                        releaseId,
                        action,
                        operator.tenantId(),
                        operator.employeeNo(),
                        outcome,
                        summary,
                        operator.requestId(),
                        Instant.now()));
    }
}
