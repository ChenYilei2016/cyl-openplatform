package io.github.chenyilei2016.openplatform.domain.access;

/** 接口层从已验证会话补充，客户端不能自行指定。 */
public record AccessOperator(String tenantId, String employeeNo, String requestId, String userId, String employeeId) {}
