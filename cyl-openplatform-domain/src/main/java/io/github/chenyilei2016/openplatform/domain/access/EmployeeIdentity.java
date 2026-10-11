package io.github.chenyilei2016.openplatform.domain.access;

import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import java.util.stream.Stream;

/** 从本地账号身份边界读取的人员事实，授权前必须重新核验租户和有效状态。 */
public record EmployeeIdentity(String tenantId, String userId, String employeeId, String employeeNo,
                               String displayName, boolean enabled, EmployeeStatus employeeStatus) {
    public void requireGrantable(String expectedTenantId, String expectedEmployeeNo) {
        boolean complete = Stream.of(tenantId, userId, employeeId, employeeNo, displayName)
                .allMatch(value -> value != null && !value.isBlank());
        if (!complete || !expectedTenantId.equals(tenantId) || !expectedEmployeeNo.equals(employeeNo)
                || !enabled || employeeStatus == null || !employeeStatus.isGrantable()
                || displayName.length() > 100 || employeeNo.length() > 64) {
            throw new PlatformException(ErrorCode.FORBIDDEN, "人员不存在、不属于目标租户或当前身份无效");
        }
    }
}
