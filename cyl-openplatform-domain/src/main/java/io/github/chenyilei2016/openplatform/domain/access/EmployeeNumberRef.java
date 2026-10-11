package io.github.chenyilei2016.openplatform.domain.access;

/** 记录中保存的人员引用（租户 + 工号）；仅用于查找展示姓名，工号不是唯一人员身份，也不作为授权依据。 */
public record EmployeeNumberRef(String tenantId, String employeeNo) {}
