package io.github.chenyilei2016.openplatform.domain.access;

import java.util.List;

/** 页内关联摘要最多两项，其他关系由凭据详情分页读取。 */
public record ApplicationListing(ClientApplication application, GrantStatus selectedTenantGrantStatus,
                                 long tenantGrantCount, long matchedTenantGrantCount,
                                 List<TenantRelation> matchedTenantGrants) {
    public record TenantRelation(String tenantId, GrantStatus status) {}
}
