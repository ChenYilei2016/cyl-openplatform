package io.github.chenyilei2016.openplatform.domain.access;

import java.util.Set;

/**
 * 租户条件按授权关联查询，不使用凭据的创建归属；各状态维度内部取并集。
 * tokenId 为 Token 记录 ID，命中时只返回该记录所属凭据。
 */
public record ApplicationFilter(String appKey, String tenantId, Set<ApplicationStatus> statuses,
                                Set<GrantStatus> relationStatuses, String tokenId) {
    public ApplicationFilter {
        statuses = statuses == null ? Set.of() : Set.copyOf(statuses);
        relationStatuses = relationStatuses == null || relationStatuses.isEmpty()
                ? (tenantId == null ? Set.of() : Set.of(GrantStatus.ACTIVE)) : Set.copyOf(relationStatuses);
    }
}
