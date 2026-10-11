package io.github.chenyilei2016.openplatform.application.access;

import java.time.Instant;

/** 名称只是展示资料，未登记时为空。 */
public record TenantPermissionView(String tenantId, String tenantName, long grantedScopeCount, Instant updatedAt) {}
