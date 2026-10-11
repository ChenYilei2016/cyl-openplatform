package io.github.chenyilei2016.openplatform.infrastructure.catalog.dal.impl;

import io.github.chenyilei2016.openplatform.domain.environmentrelease.ReleaseEnvironment;
import io.github.chenyilei2016.openplatform.domain.common.ObjectIdType;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import io.github.chenyilei2016.openplatform.infrastructure.catalog.dal.dataobject.ApiSummaryDO;
import io.github.chenyilei2016.openplatform.infrastructure.common.SqlPatterns;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiCatalogRepository;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiDefinition;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiDefinitionContent;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiOperation;
import io.github.chenyilei2016.openplatform.domain.access.AccessOperator;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiProtocol;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiSummary;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiCatalogFilter;
import io.github.chenyilei2016.openplatform.domain.catalog.CatalogPageQuery;
import io.github.chenyilei2016.openplatform.domain.common.PageResult;
import io.github.chenyilei2016.openplatform.infrastructure.catalog.dal.dataobject.ApiDraftDO;
import io.github.chenyilei2016.openplatform.infrastructure.catalog.dal.dataobject.CatalogAuditDO;
import io.github.chenyilei2016.openplatform.infrastructure.catalog.dal.mapper.ApiDraftMapper;
import io.github.chenyilei2016.openplatform.infrastructure.catalog.dal.mapper.CatalogAuditMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Repository;
import io.github.chenyilei2016.openplatform.infrastructure.catalog.ApiDefinitionJson;
import java.time.Instant;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import io.github.chenyilei2016.openplatform.infrastructure.catalog.dal.dataobject.ApiRevisionDO;
import io.github.chenyilei2016.openplatform.infrastructure.catalog.dal.mapper.ApiRevisionMapper;
import java.util.Optional;
import java.util.List;
import java.util.stream.Stream;
import org.springframework.dao.OptimisticLockingFailureException;

/** 元数据支持分页检索，结构正文一次保存，避免逐字段查询与写入。 */
@Repository
@RequiredArgsConstructor
public class ApiCatalogRepositoryImpl implements ApiCatalogRepository {
    private final ReleaseEnvironment environment;
    private final ApiDraftMapper drafts;
    private final CatalogAuditMapper audits;
    private final ApiRevisionMapper revisions;
    private final ApiDefinitionJson json;
    /** 单批最多读取1000个同名候选；额外读一条识别截断，不能以部分数据通过校验。 */
    private static final int TOOL_NAME_CANDIDATE_LIMIT = 1000;

    @Override
    public PageResult<ApiSummary> page(CatalogPageQuery query, ApiCatalogFilter filter) {
        IPage<ApiSummaryDO> page = drafts.selectSummaries(environment.environmentId(), new Page<>(query.page(), query.pageSize()),
                SqlPatterns.contains(query.query()), filter, SqlPatterns.contains(filter.internalClass()),
                simpleClassPattern(filter.internalClass()), SqlPatterns.contains(filter.internalMethod()));
        return new PageResult<>(page.getRecords().stream().map(value -> new ApiSummary(value.getId(), value.getService(),
                value.getVersion(), value.getMethod(), value.getName(), value.getCategory(), value.getOwner(), value.getOwnerName(),
                value.isOwnerProfileLinked(), value.getOwnerEmployeeNo(), value.getOwnerTenantId(), value.getOwnerTenantName(),
                ApiProtocol.valueOf(value.getProtocol()), value.getDraftRevision(), value.getLiveDraftRevision(),
                value.isEnabled(), value.getPendingReleaseId(), ApiCatalogFilter.Review.valueOf(value.getLatestReviewStatus()), value.getLatestReviewDraftRevision(),
                value.getLiveSnapshotJson() == null || !ApiDefinitionContent.changedFields(
                        json.decode(value.getLiveSnapshotJson()), json.decode(value.getDefinitionJson())).isEmpty(), value.getInternalClass(), value.getInternalMethod(), value.getUpdatedAt(), value.isMcpToolEnabled(), value.isPortalVisible())).toList(), page.getTotal(), query.page(), query.pageSize());
    }

    @Override
    public PageResult<String> categories(CatalogPageQuery query) {
        IPage<String> page = drafts.selectCategories(new Page<>(query.page(), query.pageSize()), SqlPatterns.contains(query.query()));
        return new PageResult<>(page.getRecords(), page.getTotal(), query.page(), query.pageSize());
    }

    @Override
    public List<io.github.chenyilei2016.openplatform.domain.catalog.ApiSearchHit> search(String keyword, int limit) {
        if (limit < 1 || limit > 20) throw new IllegalArgumentException("API 搜索最多返回20条");
        return drafts.searchIdentities(environment.environmentId(), SqlPatterns.contains(keyword), limit).stream()
                .map(value -> new io.github.chenyilei2016.openplatform.domain.catalog.ApiSearchHit(value.getId(), value.getName(), value.getService(),
                        value.getVersion(), value.getMethod(), value.getInternalClass(), value.getInternalMethod())).toList();
    }

    @Override public boolean portalVisible(String id) { return Boolean.TRUE.equals(drafts.portalVisible(environment.environmentId(), id)); }

    @Override public void setPortalVisible(String id, boolean visible, AccessOperator operator) {
        drafts.setPortalVisible(environment.environmentId(), id, visible);
        ApiDraftDO draft = findDraftRow(id);
        CatalogAuditDO audit = new CatalogAuditDO();
        audit.setEnvironmentId(environment.environmentId());
        audit.setId(ObjectIdType.CATALOG_AUDIT.nextId());
        audit.setApiId(id);
        audit.setDraftRevision(draft.getDraftRevision());
        audit.setAction(visible ? "SHOW_API_IN_PORTAL" : "HIDE_API_FROM_PORTAL");
        audit.setOperatorTenantId(operator.tenantId());
        audit.setOperatorEmployeeNo(operator.employeeNo());
        audit.setRequestId(operator.requestId());
        audit.setOccurredAt(Instant.now());
        audits.insert(audit);
    }

    private ApiDraftDO findDraftRow(String id) {
        return drafts.selectOne(new QueryWrapper<ApiDraftDO>()
                .eq("environment_id", environment.environmentId()).eq("id", id));
    }

    @Override public Optional<ApiDefinition> find(String id) {
        return Optional.ofNullable(findDraftRow(id)).map(value -> json.decode(value.getDefinitionJson()));
    }

    @Override public Optional<ApiDefinition> lock(String id) {
        return Optional.ofNullable(drafts.selectForUpdate(environment.environmentId(), id)).map(value -> json.decode(value.getDefinitionJson()));
    }

    @Override public void create(ApiDefinition definition) { drafts.insert(toDataObject(definition)); }
    @Override public boolean update(ApiDefinition definition, long expectedRevision) {
        // 所有更新入口已持有草稿锁；覆盖前归档尚未有历史的旧头，不伪造旧作者。
        preserveMissingHistory(List.of(definition.id()));
        return drafts.updateDraft(toDataObject(definition), expectedRevision) == 1;
    }

    @Override public List<ApiDefinition> findOperations(List<ApiOperation> operations) {
        if (operations.isEmpty()) return List.of();
        return drafts.selectOperations(environment.environmentId(), operations).stream().map(value -> json.decode(value.getDefinitionJson())).toList();
    }

    @Override public List<ApiOperation> findToolNameOperations(List<String> toolNames) {
        if (toolNames.isEmpty()) return List.of();
        List<ApiDraftDO> candidates = drafts.selectToolNameOperations(environment.environmentId(), toolNames.stream().distinct().toList(), TOOL_NAME_CANDIDATE_LIMIT + 1);
        if (candidates.size() > TOOL_NAME_CANDIDATE_LIMIT)
            throw new io.github.chenyilei2016.openplatform.domain.common.PlatformException(io.github.chenyilei2016.openplatform.domain.common.ErrorCode.CONFLICT,
                    "同名工具候选过多，请缩小本次导入范围并处理冲突后重试");
        return candidates.stream()
                .map(value -> new ApiOperation(value.getService(), value.getVersion(), value.getMethod())).toList();
    }

    @Override public List<ApiDefinition> lockAll(List<String> ids) {
        if (ids.isEmpty()) return List.of();
        return drafts.selectAllForUpdate(environment.environmentId(), ids).stream().map(value -> json.decode(value.getDefinitionJson())).toList();
    }

    /** 调用方持有scope及现有草稿锁；正文、历史及审计均按批写入；旧数据基线也不逐条读取。 */
    @Override public void writeImported(List<ApiDefinition> creates, List<ApiDefinition> updates, AccessOperator operator) {
        List<ApiDraftDO> newDrafts = creates.stream().map(this::toDataObject).toList();
        List<ApiDraftDO> changedDrafts = updates.stream().map(this::toDataObject).toList();
        Instant occurredAt = Instant.now();
        List<CatalogAuditDO> importedAudits = Stream.concat(creates.stream(), updates.stream()).map(definition -> {
            CatalogAuditDO audit = new CatalogAuditDO();
            audit.setEnvironmentId(environment.environmentId());
            audit.setId(ObjectIdType.CATALOG_AUDIT.nextId());
            audit.setApiId(definition.id());
            audit.setDraftRevision(definition.draftRevision());
            audit.setAction(definition.draftRevision() == 1 ? "IMPORT_CREATE_API_DRAFT" : "IMPORT_UPDATE_API_DRAFT");
            audit.setOperatorTenantId(operator.tenantId());
            audit.setOperatorEmployeeNo(operator.employeeNo());
            audit.setRequestId(operator.requestId());
            audit.setOccurredAt(occurredAt);
            return audit;
        }).toList();
        List<ApiRevisionDO> importedRevisions = Stream.concat(newDrafts.stream(), changedDrafts.stream())
                .map(draft -> revision(draft,
                        draft.getDraftRevision() == 1 ? "IMPORT_CREATE_API_DRAFT" : "IMPORT_UPDATE_API_DRAFT",
                        operator.tenantId(), operator.employeeNo(), occurredAt, false)).toList();
        if (!changedDrafts.isEmpty()) preserveMissingHistory(updates.stream().map(ApiDefinition::id).toList());
        if (!newDrafts.isEmpty()) drafts.insertAll(newDrafts);
        if (!changedDrafts.isEmpty() && drafts.updateAll(environment.environmentId(), changedDrafts) != changedDrafts.size())
            throw new OptimisticLockingFailureException("导入草稿修订冲突");
        if (!importedRevisions.isEmpty()) revisions.insertAll(importedRevisions);
        if (!importedAudits.isEmpty()) audits.insertAll(importedAudits);
    }

    private ApiDraftDO toDataObject(ApiDefinition definition) {
        ApiDraftDO data = new ApiDraftDO();
        data.setEnvironmentId(environment.environmentId());
        data.setId(definition.id());
        data.setService(definition.service());
        data.setVersion(definition.version());
        data.setMethod(definition.method());
        data.setName(definition.name());
        data.setCategory(definition.category());
        data.setOwner(definition.owner());
        data.setProtocol(definition.protocol().name());
        data.setDraftRevision(definition.draftRevision());
        if (definition.binding().dubbo() != null) {
            data.setInternalClass(definition.binding().dubbo().interfaceName());
            data.setInternalMethod(definition.binding().dubbo().method());
        } else if (definition.binding().http() != null) {
            data.setInternalClass(emptyToNull(definition.binding().http().sourceClass()));
            data.setInternalMethod(emptyToNull(definition.binding().http().sourceMethod()));
        }
        if (definition.binding().dubbo() != null) {
            data.setDubboConnectionId(definition.binding().dubbo().connectionId());
            data.setDubboConnectionRevision(definition.binding().dubbo().connectionRevision());
        }
        data.setMcpToolEnabled(definition.mcpTool().enabled());
        data.setDefinitionJson(json.encode(definition));
        return data;
    }

    private static String simpleClassPattern(String name) {
        if (name == null) return null;
        String pattern = SqlPatterns.contains(name);
        return "%." + pattern.substring(1, pattern.length() - 1);
    }

    private static String emptyToNull(String value) { return value == null || value.isEmpty() ? null : value; }

    @Override
    public void appendAudit(String apiId, long revision, String action, String operatorTenantId, String operatorEmployeeNo, String requestId, Long restoredFromRevision) {
        CatalogAuditDO audit = new CatalogAuditDO();
        audit.setEnvironmentId(environment.environmentId());
        audit.setId(ObjectIdType.CATALOG_AUDIT.nextId());
        audit.setApiId(apiId);
        audit.setDraftRevision(revision);
        audit.setAction(action);
        audit.setOperatorTenantId(operatorTenantId);
        audit.setOperatorEmployeeNo(operatorEmployeeNo);
        audit.setRequestId(requestId);
        audit.setOccurredAt(Instant.now());
        ApiDraftDO draft = findDraftRow(apiId);
        if (draft == null || draft.getDraftRevision() != revision) {
            throw new OptimisticLockingFailureException("归档草稿修订与审计不一致");
        }
        ApiRevisionDO snapshot = revision(draft, action, operatorTenantId, operatorEmployeeNo,
                audit.getOccurredAt(), false);
        snapshot.setRestoredFromRevision(restoredFromRevision);
        revisions.insertAll(List.of(snapshot));
        audits.insert(audit);
    }

    /** 仅补全当前尚未归档的旧稿；同事务回滚，且不补造已丢失的修订。 */
    private void preserveMissingHistory(List<String> apiIds) {
        Instant recordedAt = Instant.now();
        List<ApiRevisionDO> missing = revisions.selectMissingDrafts(environment.environmentId(), apiIds).stream()
                .map(draft -> revision(draft, "HISTORY_BASELINE", null, null, recordedAt, true)).toList();
        if (!missing.isEmpty()) revisions.insertAll(missing);
    }

    private ApiRevisionDO revision(ApiDraftDO draft, String source, String tenantId, String employeeNo,
                                   Instant recordedAt, boolean historyStart) {
        ApiRevisionDO result = new ApiRevisionDO();
        result.setEnvironmentId(environment.environmentId());
        result.setApiId(draft.getId());
        result.setRevision(draft.getDraftRevision());
        result.setSource(source);
        result.setOperatorTenantId(tenantId);
        result.setOperatorEmployeeNo(employeeNo);
        result.setRecordedAt(recordedAt);
        result.setHistoryStart(historyStart);
        result.setSnapshotJson(draft.getDefinitionJson());
        // 此摘要校验存储正文，不替代ApiDefinitionContent的业务内容比较。
        result.setDigestVersion("snapshot-json-sha256-v1");
        try {
            result.setContentDigest(HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(draft.getDefinitionJson().getBytes(StandardCharsets.UTF_8))));
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("JDK不支持SHA-256", exception);
        }
        return result;
    }

}
