package io.github.chenyilei2016.openplatform.domain.access;

import io.github.chenyilei2016.openplatform.domain.common.PageResult;
import java.util.Optional;
import java.util.Set;

public interface TenantScopeGrantRepository {
    Optional<TenantScopeGrant> find(String id);
    Optional<TenantScopeGrant> findByTenant(String scopeCode, String tenantId);
    /** 该权限组的租户权限（含已撤销），有效在前、按最近变更倒序；query 按租户 ID 精确匹配。 */
    PageResult<TenantScopeGrant> page(String scopeCode, AccessPageQuery query);
    PageResult<TenantPermissionSummary> tenants(AccessPageQuery query);
    PageResult<TenantScopePermission> permissions(String tenantId, AccessPageQuery query, TenantScopePermission.Filter filter);
    void create(TenantScopeGrant grant);
    /** 以 expectedRevision 为条件写入状态、开通人、更新时间与新版本；版本不符时返回 false。 */
    boolean changeStatus(TenantScopeGrant grant, long expectedRevision);
    /**
     * 租户当前可用的权限组代码：启用的公共通用权限组 ∪ 该租户 ACTIVE 授予且权限组启用的权限组；单次查询。
     * tenantId 为 null 时只返回启用的公共通用权限组。
     */
    Set<String> availableScopeCodes(String tenantId, java.util.List<String> candidates);
}
