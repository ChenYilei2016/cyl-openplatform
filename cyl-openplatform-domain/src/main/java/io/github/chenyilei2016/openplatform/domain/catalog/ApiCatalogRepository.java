package io.github.chenyilei2016.openplatform.domain.catalog;

import io.github.chenyilei2016.openplatform.domain.common.PageResult;
import java.util.Optional;
import java.util.List;
import io.github.chenyilei2016.openplatform.domain.access.AccessOperator;

public interface ApiCatalogRepository {
    PageResult<ApiSummary> page(CatalogPageQuery query, ApiCatalogFilter filter);
    PageResult<String> categories(CatalogPageQuery query);
    /** 按名称、service/method、service.method 或内部类包含匹配，最多返回 limit 条。 */
    List<ApiSearchHit> search(String keyword, int limit);
    Optional<ApiDefinition> find(String id);
    boolean portalVisible(String id);
    void setPortalVisible(String id, boolean visible, AccessOperator operator);
    Optional<ApiDefinition> lock(String id);
    void create(ApiDefinition definition);
    boolean update(ApiDefinition definition, long expectedRevision);
    void appendAudit(String apiId, long revision, String action, String operatorTenantId, String operatorEmployeeNo, String requestId, Long restoredFromRevision);
    List<ApiDefinition> findOperations(List<ApiOperation> operations);
    /** 查询生成给定工具名的已有操作；包含未启用MCP的草稿，避免生效快照仍在使用同名工具。 */
    List<ApiOperation> findToolNameOperations(List<String> toolNames);
    List<ApiDefinition> lockAll(List<String> ids);
    void writeImported(List<ApiDefinition> creates, List<ApiDefinition> updates, AccessOperator operator);
}
