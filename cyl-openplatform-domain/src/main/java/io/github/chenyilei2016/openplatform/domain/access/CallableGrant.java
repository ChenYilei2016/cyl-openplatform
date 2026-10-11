package io.github.chenyilei2016.openplatform.domain.access;

/** 草稿调试可选的调用身份：启用凭据在某租户下的有效授权。 */
public record CallableGrant(String applicationId, String applicationName, String appKey,
                            String tenantGrantId, String tenantId, String note) {}
