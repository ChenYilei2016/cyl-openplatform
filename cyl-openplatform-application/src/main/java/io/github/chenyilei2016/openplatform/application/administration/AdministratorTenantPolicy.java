package io.github.chenyilei2016.openplatform.application.administration;

/** 环境级管理租户准入，不替代管理员角色和权限。 */
public interface AdministratorTenantPolicy {
    boolean allows(String tenantId);
}
