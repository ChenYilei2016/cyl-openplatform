package io.github.chenyilei2016.openplatform.application.access;

import java.time.Instant;
import java.util.Map;

import io.github.chenyilei2016.openplatform.domain.access.ClientApplication;
import io.github.chenyilei2016.openplatform.domain.access.ApplicationListing;
import java.util.List;

/**
 * 凭据视图。列表补充字段（租户名称、最近正式调用时间）按页批量聚合；
 * matchedTokenId 仅在按 Token 记录 ID 搜索命中时返回，供界面定位到该记录。
 */
public record ApplicationView(String id, String appKey, String name, String ownerTenantId,
                              String status, long authorizationVersion, List<String> scopeCodes, String selectedTenantGrantStatus,
                              Long tenantGrantCount, Long matchedTenantGrantCount,
                              List<ApplicationListing.TenantRelation> matchedTenantGrants,
                              Map<String, String> tenantNames, Map<String, String> scopeNames, Long activeTenantGrantCount,
                              Instant lastCalledAt, String matchedTokenId) {
    public static ApplicationView from(ClientApplication app) {
        return new ApplicationView(app.id(), app.appKey(), app.name(), app.ownerTenantId(),
                app.status().name(), app.authorizationVersion(), app.scopeCodes(), null, null, null, List.of(), Map.of(), Map.of(), null,
                null, null);
    }

    public ApplicationView withDetails(Map<String, String> names, Map<String, String> scopes, long activeTenants) {
        return new ApplicationView(id, appKey, name, ownerTenantId, status, authorizationVersion, scopeCodes,
                selectedTenantGrantStatus, tenantGrantCount, matchedTenantGrantCount, matchedTenantGrants, names, scopes, activeTenants,
                lastCalledAt, matchedTokenId);
    }
}
