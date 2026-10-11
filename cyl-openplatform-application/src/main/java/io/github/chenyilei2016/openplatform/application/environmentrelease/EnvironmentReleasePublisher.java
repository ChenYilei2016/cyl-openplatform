package io.github.chenyilei2016.openplatform.application.environmentrelease;

import io.github.chenyilei2016.openplatform.domain.access.EmployeeProfile;
import io.github.chenyilei2016.openplatform.domain.access.EmployeeProfileQuery;
import io.github.chenyilei2016.openplatform.application.publication.PublicationService;
import io.github.chenyilei2016.openplatform.domain.access.AccessOperator;
import io.github.chenyilei2016.openplatform.domain.catalog.*;
import io.github.chenyilei2016.openplatform.domain.common.*;
import io.github.chenyilei2016.openplatform.domain.environmentrelease.*;
import io.github.chenyilei2016.openplatform.domain.environmentrelease.EnvironmentReleaseModels.*;
import io.github.chenyilei2016.openplatform.domain.publication.ReleaseStatus;
import java.time.Instant;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;

/** 持久化不可变发送内容后才访问网络；节点观测按版本保存，不覆盖较新的观测。 */
@Service
@RequiredArgsConstructor
public class EnvironmentReleasePublisher {
    private final PublicationService publications;
    private final ApiCategoryRepository categories;
    private final ApiDefinitionCodec codec;
    private final ReleaseEnvironment environment;
    private final EnvironmentReleaseClient client;
    private final OutgoingTransferRepository transfers;

    public ConnectionDirectory connections(String targetId, int page, int pageSize, String query) {
        requireTarget(targetId);
        return client.connections(targetId, page, pageSize, query);
    }
    public PageResult<EmployeeProfile> owners(String targetId, EmployeeProfileQuery query) {
        requireTarget(targetId);
        return client.owners(targetId, query);
    }
    public List<Target> targets() { return environment.targets(); }
    /** apiId 非空时按该 API 的外部操作标识精确过滤（API 工作区内的“发往其他环境”记录）。 */
    public PageResult<TransferSummary> page(CatalogPageQuery query, String apiId) {
        return transfers.page(query, apiId == null ? null : ApiOperation.of(publications.candidate(apiId)));
    }
    public OutgoingTransfer find(String id) {
        return transfers.find(id).orElseThrow(() -> new PlatformException(ErrorCode.NOT_FOUND, "跨环境传输记录不存在"));
    }
    public Preview preview(String releaseId, String targetId, ApiBinding binding, String targetOwnerId) {
        requireTarget(targetId);
        return client.preview(targetId, candidate(releaseId, binding, targetOwnerId));
    }
    public OutgoingTransfer send(String id, String releaseId, String targetId, ApiBinding binding, String targetOwnerId,
                                  long expectedRevision, String previewDigest, String comment, AccessOperator operator) {
        requireTarget(targetId);
        SendRequest request = new SendRequest(id, environment.environmentId(), targetId, releaseId,
                operator.tenantId(), operator.employeeNo(), expectedRevision, previewDigest,
                candidate(releaseId, binding, targetOwnerId), comment);
        OutgoingTransfer transfer = transfers.find(id).orElse(null);
        if (transfer == null) {
            Instant now = Instant.now();
            transfer = new OutgoingTransfer(id, request, DeliveryState.READY, null, null, List.of(), now, now, 0);
            try { transfers.create(transfer); }
            catch (DuplicateKeyException raced) { transfer = find(id); }
        }
        if (!transfer.request().equals(request))
            throw new PlatformException(ErrorCode.CONFLICT, "传输ID已用于其他内容或操作者，请核对已有记录");
        return deliver(transfer);
    }
    public OutgoingTransfer retry(String id) {
        OutgoingTransfer transfer = find(id);
        requireTarget(transfer.request().targetEnvironment());
        return deliver(transfer);
    }
    public OutgoingTransfer refresh(String id) {
        OutgoingTransfer transfer = find(id);
        requireTarget(transfer.request().targetEnvironment());
        List<NodeObservation> observations = client.observe(transfer.request().targetEnvironment(), id);
        Receipt observed = observations.stream().map(NodeObservation::receipt).filter(java.util.Objects::nonNull)
                .max(java.util.Comparator.comparingLong(Receipt::stateVersion)).orElse(null);
        // 没有任何节点返回事实时，保留最后回执但明确这是历史观测，不能推断请求未提交。
        return save(transfer, observed == null ? transfer.deliveryState() : DeliveryState.ACCEPTED,
                observed == null ? "本次未取得目标回执，请查看各节点状态" : null,
                observed == null ? transfer.receipt() : observed, observations);
    }
    private OutgoingTransfer deliver(OutgoingTransfer transfer) {
        if (transfer.request().definition().employeeRequired()) {
            Preview preview = client.preview(transfer.request().targetEnvironment(), transfer.request().definition());
            if (!Boolean.TRUE.equals(preview.definition().employeeRequired())) {
                throw new PlatformException(ErrorCode.CONFLICT, "目标环境不支持必须指定调用员工，拒绝传输");
            }
        }
        DeliveryResult result = client.receive(transfer.request().targetEnvironment(), transfer.request());
        DeliveryState state = result.receipt() != null ? DeliveryState.ACCEPTED
                : result.rejected() ? DeliveryState.REJECTED : DeliveryState.UNKNOWN;
        return save(transfer, state, result.error(), result.receipt() == null ? transfer.receipt() : result.receipt(), List.of());
    }
    private OutgoingTransfer save(OutgoingTransfer previous, DeliveryState state, String error,
                                  Receipt receipt, List<NodeObservation> observations) {
        OutgoingTransfer changed = new OutgoingTransfer(previous.id(), previous.request(), state, error, receipt,
                observations, previous.createdAt(), Instant.now(), previous.version() + 1);
        return transfers.update(changed, previous.version()) ? changed : find(previous.id());
    }
    private ApiDefinition candidate(String id, ApiBinding binding, String targetOwnerId) {
        var release = publications.find(id);
        if (release.status() != ReleaseStatus.APPLIED)
            throw new PlatformException(ErrorCode.INVALID_REQUEST, "仅允许传递已通过发布的固定快照");
        ApiDefinition source = release.snapshot();
        if (source.binding().dubbo() != null && source.binding().dubbo().connectionId() != null
                && (binding == null || binding.dubbo() == null || binding.dubbo().connectionId() == null))
            throw new PlatformException(ErrorCode.INVALID_REQUEST, "请显式选择目标环境的Dubbo连接与修订后再预览发送");
        ApiBinding targetBinding = binding == null ? source.binding() : binding;
        ApiDefinition candidate = new ApiDefinition(null, source.service(), source.version(), source.method(),
                source.name(), categories.displayName(source.category()), targetOwnerId == null ? source.owner() : targetOwnerId, targetBinding.protocol(), 0, source.scopeCodes(),
                source.requestSchema(), source.responseSchema(), source.errorDefinitions(), targetBinding, source.mappings(), source.lifecycle(), source.description(), source.employeeRequired(), source.responseAdapter(),
                source.operationKind(), source.idempotencyField(), source.mcpTool());
        candidate.validate();
        codec.encode(candidate);
        return candidate;
    }
    private void requireTarget(String id) {
        if (environment.targets().stream().noneMatch(target -> target.id().equals(id)))
            throw new PlatformException(ErrorCode.INVALID_REQUEST, "目标环境未配置或已停用");
    }
}
