package io.github.chenyilei2016.openplatform.application.catalog;

import io.github.chenyilei2016.openplatform.domain.catalog.*;
import io.github.chenyilei2016.openplatform.domain.common.CredentialSecrets;
import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.github.chenyilei2016.openplatform.domain.common.ObjectIdType;
import io.github.chenyilei2016.openplatform.domain.publication.EffectiveRelease;
import io.github.chenyilei2016.openplatform.domain.publication.PublicationRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.util.List;
import java.util.Objects;

/** 复制只创建独立草稿；来源定位、幂等回执和草稿/审计/历史在同一事务内提交。 */
@Service
@RequiredArgsConstructor
public class ApiCopyService {
    public enum SourceKind { DRAFT, EFFECTIVE }
    public record Preview(String sourceApiId, SourceKind sourceKind, long sourceRevision,
                          String sourceReleaseId, ApiDefinition snapshot, List<String> warnings) {}
    private final ApiCatalogService catalog;
    private final PublicationRepository publications;
    private final ApiCopyRepository copies;
    private final ApiDefinitionCodec codec;

    public Preview preview(String sourceApiId, SourceKind kind, Long expectedRevision, String sourceReleaseId, String owner) {
        ApiDefinition source;
        String releaseId = null;
        if (kind == SourceKind.DRAFT) {
            if (sourceReleaseId != null) throw new PlatformException(ErrorCode.INVALID_REQUEST, "草稿来源不能携带发布记录");
            source = catalog.find(sourceApiId);
        } else if (kind == SourceKind.EFFECTIVE) {
            EffectiveRelease effective = publications.effective(sourceApiId)
                    .orElseThrow(() -> new PlatformException(ErrorCode.NOT_FOUND, "该API没有当前生效快照"));
            source = effective.snapshot();
            releaseId = effective.releaseId();
            if (sourceReleaseId != null && !sourceReleaseId.equals(releaseId))
                throw new PlatformException(ErrorCode.CONFLICT, "生效版本已变化，请重新选择复制来源");
        } else throw new PlatformException(ErrorCode.INVALID_REQUEST, "请选择复制来源");
        if (expectedRevision != null && source.draftRevision() != expectedRevision)
            throw new PlatformException(ErrorCode.CONFLICT, "来源修订已变化，请重新选择复制来源");
        return new ApiDefinitionSanitizer().preview(sourceApiId, kind, releaseId, source, owner);
    }

    @Transactional
    public ApiDefinition create(String creationKey, String sourceApiId, SourceKind sourceKind, long sourceRevision,
                                String sourceReleaseId, ApiDefinition definition, String tenantId, String employeeNo, String requestId) {
        if (sourceKind == null || sourceRevision < 1 || sourceKind == SourceKind.EFFECTIVE && sourceReleaseId == null)
            throw new PlatformException(ErrorCode.INVALID_REQUEST, "复制来源快照信息不完整");
        if (!definition.lifecycle().isDefault()) throw new PlatformException(ErrorCode.INVALID_REQUEST, "复制新API的生命周期必须为正常维护");
        // 输入使用固定ID，摘要不含每次重试重新生成的目标API编号。
        String digest = CredentialSecrets.digest(sourceApiId + "\n" + sourceKind + "\n" + sourceRevision + "\n"
                + sourceReleaseId + "\n" + codec.encode(definition));
        ApiCopyRepository.Receipt receipt = copies.reserve(tenantId, employeeNo, creationKey, digest);
        if (!receipt.contentDigest().equals(digest)) throw new PlatformException(ErrorCode.CONFLICT, "该创建键已用于不同的复制内容");
        if (receipt.result() != null) return receipt.result();
        ApiDefinition source = preview(sourceApiId, sourceKind, sourceRevision, sourceReleaseId, employeeNo).snapshot();
        if (Objects.equals(source.service(), definition.service()) && Objects.equals(source.version(), definition.version())
                && Objects.equals(source.method(), definition.method()))
            throw new PlatformException(ErrorCode.INVALID_REQUEST, "复制必须至少更换服务标识、外部版本或操作标识之一");
        definition.validate();
        if (!new ApiDefinitionSanitizer().preview(sourceApiId, sourceKind, sourceReleaseId, definition, definition.owner()).warnings().isEmpty())
            throw new PlatformException(ErrorCode.INVALID_REQUEST, "复制内容仍含敏感值，请清除敏感绑定参数、固定值或示例后重试；填写内容未被自动修改");
        ApiDefinition target = new ApiDefinition(ObjectIdType.API.nextId(), definition.service(), definition.version(), definition.method(),
                definition.name(), definition.category(), definition.owner(), definition.protocol(), 1, definition.scopeCodes(),
                definition.requestSchema(), definition.responseSchema(), definition.errorDefinitions(), definition.binding(),
                definition.mappings(), ApiLifecycle.DEFAULT, definition.description(), definition.employeeRequired(), definition.responseAdapter(),
                definition.operationKind(), definition.idempotencyField(), definition.mcpTool());
        ApiDefinition created = catalog.create(target, ApiRevisionSource.COPY_API_DRAFT, tenantId, employeeNo, requestId);
        copies.complete(tenantId, employeeNo, creationKey, created);
        return created;
    }

    public ApiDefinition result(String creationKey, String tenantId, String employeeNo) {
        return copies.find(tenantId, employeeNo, creationKey).map(ApiCopyRepository.Receipt::result)
                .orElseThrow(() -> new PlatformException(ErrorCode.NOT_FOUND, "该创建请求暂无成功结果，可使用原创建键和原内容重试"));
    }

}
