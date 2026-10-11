package io.github.chenyilei2016.openplatform.domain.access;

import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;

public record EmployeeProfileQuery(
        String tenantId, String employeeNo, String name, int page, int pageSize) {
    public EmployeeProfileQuery {
        tenantId = normalized(tenantId);
        employeeNo = normalized(employeeNo);
        name = normalized(name);
        if (tenantId == null
                || tenantId.length() > 64
                || employeeNo != null && employeeNo.length() > 64
                || name != null && name.length() > 100
                || page < 1
                || pageSize < 1
                || pageSize > 100
                || (long) (page - 1) * pageSize > 100_000) {
            throw new PlatformException(ErrorCode.INVALID_REQUEST, "请提供有效租户、姓名或工号，分页大小须为1至100");
        }
    }

    private static String normalized(String value) {
        return value == null || value.isBlank() ? null : value.strip();
    }
}
