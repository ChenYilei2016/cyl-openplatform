package io.github.chenyilei2016.openplatform.domain.mcp;

import io.github.chenyilei2016.openplatform.domain.access.AccessPageQuery;
import io.github.chenyilei2016.openplatform.domain.common.PageResult;
import java.util.Optional;

public interface McpTenantActivationRepository {
    Optional<McpTenantActivation> find(String id);

    Optional<McpTenantActivation> findByTenant(String tenantId);

    /** 每租户唯一；并发重复开通由数据库唯一约束拒绝并转换为冲突。 */
    void create(McpTenantActivation activation);

    /** 按修订号条件更新状态；已被他人修改时返回 false。 */
    boolean updateStatus(McpTenantActivation activation, long expectedRevision);

    /** query 为租户 ID 精确匹配；status 为空时不过滤；按开通时间倒序。 */
    PageResult<McpTenantActivation> page(AccessPageQuery query, McpActivationStatus status);
}
