package io.github.chenyilei2016.openplatform.domain.access;

import java.time.Instant;

/** 最近核验的展示资料，不是认证源；账号ID与人员ID分别保存。 */
public record EmployeeProfile(
        String id,
        String tenantId,
        String tenantName,
        String employeeId,
        String userId,
        String employeeNo,
        String displayName,
        Instant lastSeenAt) {}
