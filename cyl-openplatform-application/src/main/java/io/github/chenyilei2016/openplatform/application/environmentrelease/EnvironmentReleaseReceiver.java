package io.github.chenyilei2016.openplatform.application.environmentrelease;

import io.github.chenyilei2016.openplatform.application.catalog.CatalogReferencePolicy;
import io.github.chenyilei2016.openplatform.domain.access.EmployeeProfile;
import io.github.chenyilei2016.openplatform.domain.access.EmployeeProfileQuery;
import io.github.chenyilei2016.openplatform.domain.access.EmployeeProfileRepository;
import io.github.chenyilei2016.openplatform.domain.common.ObjectIdType;
import io.github.chenyilei2016.openplatform.application.catalog.ApiDraftSaveResult;
import io.github.chenyilei2016.openplatform.domain.connection.DubboConnection;
import io.github.chenyilei2016.openplatform.domain.connection.DubboConnectionRepository;
import io.github.chenyilei2016.openplatform.application.importing.ApiImportService;
import io.github.chenyilei2016.openplatform.application.importing.ImportModels;
import io.github.chenyilei2016.openplatform.application.publication.PublicationService;
import io.github.chenyilei2016.openplatform.domain.access.AccessOperator;
import io.github.chenyilei2016.openplatform.domain.access.ScopeRepository;
import io.github.chenyilei2016.openplatform.domain.catalog.*;
import io.github.chenyilei2016.openplatform.domain.common.*;
import io.github.chenyilei2016.openplatform.domain.environmentrelease.*;
import io.github.chenyilei2016.openplatform.domain.environmentrelease.EnvironmentReleaseModels.*;
import io.github.chenyilei2016.openplatform.domain.environmentrelease.IncomingReleaseRepository.IncomingRelease;
import io.github.chenyilei2016.openplatform.domain.publication.*;

import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Instant;
import java.util.List;
import java.util.Objects;

/** 回执、目标草稿和发布同事务提交；传输身份不具有本地审核权。 */
@Service
public class EnvironmentReleaseReceiver {
    private final CatalogReferencePolicy references;
    private final ApiCatalogRepository catalog;
    private final EmployeeProfileRepository profiles;
    private final ScopeRepository scopes;
    private final ApiImportService imports;
    private final PublicationService publications;
    private final IncomingReleaseRepository incoming;
    private final ReleaseEnvironment environment;
    private final DubboConnectionRepository connections;
    private final EnvironmentReleaseDigest digests;
    private final TransactionTemplate changes;

    public EnvironmentReleaseReceiver(
            ApiCatalogRepository catalog,
            EmployeeProfileRepository profiles,
            CatalogReferencePolicy references,
            ScopeRepository scopes,
            ApiImportService imports,
            PublicationService publications,
            IncomingReleaseRepository incoming,
            ReleaseEnvironment environment,
            DubboConnectionRepository connections,
            EnvironmentReleaseDigest digests,
            PlatformTransactionManager transactions) {
        this.catalog = catalog;
        this.profiles = profiles;
        this.references = references;
        this.scopes = scopes;
        this.imports = imports;
        this.publications = publications;
        this.incoming = incoming;
        this.environment = environment;
        this.connections = connections;
        this.digests = digests;
        changes = new TransactionTemplate(transactions);
        changes.setIsolationLevel(TransactionDefinition.ISOLATION_READ_COMMITTED);
    }

    public PageResult<EmployeeProfile> owners(EmployeeProfileQuery query) {
        return profiles.page(query);
    }
    public ConnectionDirectory connections(int page, int pageSize, String query) {
        PageResult<DubboConnection> result =
                connections.page(environment.environmentId(), page, pageSize, query, true);
        return new ConnectionDirectory(environment.environmentId(), environment.nodeId(), result.items().stream()
                .map(connection -> new ConnectionOption(connection.id(), connection.name(), connection.description(),
                        connection.activeRevision())).toList(), result.total(), result.page(), result.pageSize());
    }

    public Preview preview(PreviewRequest request) {
        requireTarget(request.targetEnvironment());
        ApiDefinition candidate = identity(request.definition(), null, 0);
        if (candidate.scopeCodes().isEmpty())
            throw new PlatformException(ErrorCode.INVALID_REQUEST, "发布权限组不能为空");
        var item =
                imports.preview(
                                new ImportModels.ParsedDocument(
                                        "",
                                        List.of(
                                                new ImportModels.SourceItem(
                                                        0, ApiOperation.of(candidate), candidate, List.of()))))
                        .items()
                        .getFirst();
        if (!item.errors().isEmpty())
            throw new PlatformException(ErrorCode.INVALID_REQUEST, String.join("；", item.errors()));
        String pending =
                item.before() == null
                        ? null
                        : publications.state(item.before().id()).pendingReleaseId();
        if (pending != null) throw new PlatformException(ErrorCode.CONFLICT, "目标API已有待审申请，请先完成审核");
        return new Preview(
                environment.environmentId(),
                environment.nodeId(),
                candidate,
                item.before(),
                item.change().name(),
                item.expectedRevision(),
                item.changedFields(),
                digests.preview(candidate, item.before()),
                publications.auditEnabled(),
                pending);
    }

    public Receipt receive(SendRequest request, String requestId) {
        requireTarget(request.targetEnvironment());
        String digest = digests.request(request);
        try {
            IncomingRelease accepted =
                    changes.execute(
                            status -> {
                                IncomingRelease previous =
                                        incoming.find(
                                                        request.sourceEnvironment(),
                                                        request.transferId())
                                                .orElse(null);
                                if (previous != null) return retry(previous, digest);
                                ApiDefinition candidate = identity(request.definition(), null, 0);
                                candidate.validate();
                                if (candidate.scopeCodes().isEmpty()
                                        || !scopes.allEnabled(
                                                candidate.scopeCodes().stream().sorted().toList()))
                                    throw new PlatformException(
                                            ErrorCode.INVALID_REQUEST, "目标权限组为空、不存在或已停用");
                                references.check(List.of(candidate), true).require(candidate);
                                Preview preview =
                                        preview(
                                                new PreviewRequest(
                                                        request.sourceEnvironment(),
                                                        request.targetEnvironment(),
                                                        candidate));
                                ApiDefinition before = preview.before();
                                if (before != null) {
                                    ApiDefinition locked =
                                            catalog.lock(before.id())
                                                    .orElseThrow(
                                                            () ->
                                                                    new PlatformException(
                                                                            ErrorCode.CONFLICT,
                                                                            "目标草稿已变化"));
                                    previous =
                                            incoming.find(
                                                            request.sourceEnvironment(),
                                                            request.transferId())
                                                    .orElse(null);
                                    if (previous != null) return retry(previous, digest);
                                    if (!Objects.equals(locked, before))
                                        throw new PlatformException(
                                                ErrorCode.CONFLICT, "目标草稿已变化，请重新预览");
                                }
                                if (request.expectedRevision() != preview.expectedRevision()
                                        || !Objects.equals(
                                                request.previewDigest(), preview.previewDigest()))
                                    throw new PlatformException(
                                            ErrorCode.CONFLICT, "目标差异或草稿修订已变化，请重新预览");
                                AccessOperator operator =
                                        new AccessOperator(
                                                "environment:" + request.sourceEnvironment(),
                                                "machine",
                                                requestId, null, null);
                                ApiDraftSaveResult saved = ApiDraftSaveResult.prepare(before,
                                        identity(candidate, before == null ? ObjectIdType.API.nextId() : before.id(),
                                                preview.expectedRevision() + 1), request.expectedRevision());
                                ApiDefinition snapshot = saved.definition();
                                if (saved.changed()) {
                                    if (preview.expectedRevision() == Long.MAX_VALUE)
                                        throw new PlatformException(
                                                ErrorCode.CONFLICT, "目标草稿修订已达上限");
                                    if (before == null) catalog.create(snapshot);
                                    else if (!catalog.update(snapshot, before.draftRevision()))
                                        throw new PlatformException(ErrorCode.CONFLICT, "目标草稿已变化");
                                    catalog.appendAudit(
                                            snapshot.id(),
                                            snapshot.draftRevision(),
                                            "ENVIRONMENT_RECEIVE_DRAFT",
                                            operator.tenantId(),
                                            operator.employeeNo(),
                                            operator.requestId(), null);
                                }
                                Release release =
                                        publications.submitLockedSnapshot(
                                                snapshot,
                                                java.util.UUID.randomUUID().toString(),
                                                request.comment(),
                                                operator);
                                IncomingReview review =
                                        new IncomingReview(
                                                request.sourceEnvironment(),
                                                request.sourceReleaseId(),
                                                request.operatorTenantId(),
                                                request.operatorEmployeeNo(),
                                                before,
                                                snapshot,
                                                preview.changedFields());
                                IncomingRelease result =
                                        new IncomingRelease(
                                                ObjectIdType.INCOMING_RELEASE.nextId(),
                                                request.sourceEnvironment(),
                                                request.transferId(),
                                                digest,
                                                snapshot.id(),
                                                release.id(),
                                                review);
                                incoming.insert(result);
                                return result;
                            });
            return receipt(accepted.sourceEnvironment(), accepted.transferId());
        } catch (RuntimeException failure) {
            // 事务结束后复核唯一幂等事实；连接异常不能翻译为“必然未写入”。
            IncomingRelease recorded;
            try {
                recorded =
                        incoming.find(request.sourceEnvironment(), request.transferId())
                                .orElse(null);
            } catch (RuntimeException unavailable) {
                throw failure;
            }
            if (recorded != null) {
                retry(recorded, digest);
                return receipt(recorded.sourceEnvironment(), recorded.transferId());
            }
            if (failure instanceof DataIntegrityViolationException)
                throw new PlatformException(ErrorCode.CONFLICT, "目标操作发生并发变更，请重新预览");
            throw failure;
        }
    }

    public Receipt receipt(String sourceEnvironment, String transferId) {
        IncomingRelease received =
                incoming.find(sourceEnvironment, transferId)
                        .orElseThrow(
                                () -> new PlatformException(ErrorCode.NOT_FOUND, "目标尚未查到传输回执"));
        Release release = publications.find(received.releaseId());
        PublicationState state = publications.state(received.apiId());
        return new Receipt(
                environment.environmentId(),
                environment.nodeId(),
                sourceEnvironment,
                transferId,
                received.apiId(),
                release.id(),
                release.draftRevision(),
                release.status(),
                release.auditRequired(),
                state.liveReleaseId(),
                state.enabled(),
                state.stateVersion(),
                Instant.now());
    }

    public IncomingReview incoming(String releaseId) {
        publications.find(releaseId);
        return incoming.findRelease(releaseId).map(IncomingRelease::review).orElse(null);
    }

    private IncomingRelease retry(IncomingRelease previous, String digest) {
        if (!previous.requestDigest().equals(digest))
            throw new PlatformException(ErrorCode.CONFLICT, "传输号已用于其他内容");
        return previous;
    }

    private void requireTarget(String target) {
        if (!environment.environmentId().equals(target))
            throw new PlatformException(ErrorCode.FORBIDDEN, "传输目标环境不匹配");
    }

    private ApiDefinition identity(ApiDefinition definition, String id, long revision) {
        if (definition == null) throw new PlatformException(ErrorCode.INVALID_REQUEST, "发布契约不能为空");
        return new ApiDefinition(
                id,
                definition.service(),
                definition.version(),
                definition.method(),
                definition.name(),
                definition.category(),
                definition.owner(),
                definition.protocol(),
                revision,
                definition.scopeCodes(),
                definition.requestSchema(),
                definition.responseSchema(),
                definition.errorDefinitions(),
                definition.binding(),
                definition.mappings(),
                definition.lifecycle(), definition.description(), definition.employeeRequired(), definition.responseAdapter(),
                definition.operationKind(), definition.idempotencyField(), definition.mcpTool());
    }
}
