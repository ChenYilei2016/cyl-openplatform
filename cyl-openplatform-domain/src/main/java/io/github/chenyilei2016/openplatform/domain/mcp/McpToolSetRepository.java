package io.github.chenyilei2016.openplatform.domain.mcp;

import io.github.chenyilei2016.openplatform.domain.catalog.CatalogPageQuery;
import io.github.chenyilei2016.openplatform.domain.common.PageResult;
import java.util.List;
import java.util.Optional;

public interface McpToolSetRepository {
    PageResult<McpToolSet> page(CatalogPageQuery query);
    Optional<McpToolSet> find(String id);
    Optional<McpToolSet> findByCode(String code);
    Optional<McpToolSet> lock(String id);
    void create(McpToolSet set);
    boolean update(McpToolSet set, long expectedRevision);
    boolean delete(String id, long expectedRevision);
    List<String> members(String id);
    void replaceMembers(String id, List<String> apiIds);
}
