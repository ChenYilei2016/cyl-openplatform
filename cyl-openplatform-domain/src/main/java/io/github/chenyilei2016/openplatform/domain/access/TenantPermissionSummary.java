package io.github.chenyilei2016.openplatform.domain.access;

import java.time.Instant;

/** 已有直接权限记录的租户；直接授予数不含公共通用的隐式授权。 */
public record TenantPermissionSummary(String tenantId, long grantedScopeCount, Instant updatedAt) {}
