package io.github.chenyilei2016.openplatform.domain.administration;

/** 当前启用的总管理员数量，不代替平台人员有效性校验。 */
public record AdministratorStatus(long enabledSuperAdministratorCount) {}
