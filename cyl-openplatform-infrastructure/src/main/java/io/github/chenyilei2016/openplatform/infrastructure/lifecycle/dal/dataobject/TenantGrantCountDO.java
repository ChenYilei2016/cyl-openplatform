package io.github.chenyilei2016.openplatform.infrastructure.lifecycle.dal.dataobject;

/** 当前页应用有效租户授权的聚合投影。 */
public record TenantGrantCountDO(String applicationId, long activeTenantGrantCount) {}
