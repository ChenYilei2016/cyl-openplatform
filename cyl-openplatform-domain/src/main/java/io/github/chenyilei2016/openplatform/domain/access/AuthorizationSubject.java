package io.github.chenyilei2016.openplatform.domain.access;

/** 固定的调用身份；归属租户和操作人员均不能替代授权目标。 */
public record AuthorizationSubject(String applicationId, String appKey, String tenantGrantId, String tenantId,
                                   String userGrantId, String userId, String employeeId, String employeeNo) {}
