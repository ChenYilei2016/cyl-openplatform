package io.github.chenyilei2016.openplatform.domain.administration;

/** 只由当前可信管理会话构造的操作人。 */
public record AdministratorActor(
        String administratorId, String tenantId, String employeeNo, String requestId) {}
