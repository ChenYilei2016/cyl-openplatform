package io.github.chenyilei2016.openplatform.domain.administration;

/** 操作记录中保存的操作人（租户 + 工号）；仅用于查找展示姓名，不作为身份或授权依据。 */
public record OperatorRef(String tenantId, String employeeNo) {}
