package io.github.chenyilei2016.openplatform.application.administration;

import io.github.chenyilei2016.openplatform.domain.access.EmployeeDirectory;
import io.github.chenyilei2016.openplatform.domain.access.EmployeeIdentity;
import io.github.chenyilei2016.openplatform.domain.administration.Administrator;
import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;

import lombok.RequiredArgsConstructor;

import org.springframework.stereotype.Service;

/** 将平台登录账号、当前人员事实和数据库管理资格合并为一次授权结果。 */
@Service
@RequiredArgsConstructor
public class AdministratorLoginService {
    private final EmployeeDirectory employees;
    private final AdministratorService administrators;

    public record AuthenticatedAdministrator(
            Administrator administrator, EmployeeIdentity employee) {}

    public AuthenticatedAdministrator authenticate(
            String tenantId,
            String userId,
            String employeeNo,
            EmployeeIdentity verifiedLocalEmployee) {
        // 平台登录缓存不含员工启用/任职状态，仍须实时核验；local入口已在本请求完成同一核验。
        EmployeeIdentity employee =
                verifiedLocalEmployee == null
                        ? employees.find(tenantId, employeeNo)
                        : verifiedLocalEmployee;
        if (employee == null) throw new PlatformException(ErrorCode.FORBIDDEN, "未核验到有效人员，请重新登录");
        employee.requireGrantable(tenantId, employeeNo);
        if (!employee.userId().equals(userId))
            throw new PlatformException(ErrorCode.FORBIDDEN, "登录账号与当前人员不一致，请重新登录");
        return new AuthenticatedAdministrator(administrators.authenticate(employee), employee);
    }
}
