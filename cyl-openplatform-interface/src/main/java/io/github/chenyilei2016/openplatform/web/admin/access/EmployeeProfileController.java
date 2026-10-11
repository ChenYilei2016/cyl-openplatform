package io.github.chenyilei2016.openplatform.web.admin.access;

import io.github.chenyilei2016.openplatform.application.access.EmployeeProfileService;
import io.github.chenyilei2016.openplatform.application.access.EmployeeProfileService.EmployeeProfileOption;
import io.github.chenyilei2016.openplatform.common.ApiResponse;
import io.github.chenyilei2016.openplatform.domain.access.EmployeeProfileQuery;
import io.github.chenyilei2016.openplatform.domain.administration.AdminPermission;
import io.github.chenyilei2016.openplatform.domain.common.PageResult;
import io.github.chenyilei2016.openplatform.identity.RequireAdmin;

import lombok.RequiredArgsConstructor;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 仅查询指定租户已经登记的展示资料；选择结果不构成授权证明。 */
@RestController
@RequiredArgsConstructor
public class EmployeeProfileController {
    private final EmployeeProfileService profiles;

    @RequireAdmin(
            permissions = {AdminPermission.MANAGE_APPLICATIONS, AdminPermission.VIEW_AUDIT},
            match = RequireAdmin.Match.ANY)
    @GetMapping("/admin-api/employee-profiles")
    public ApiResponse<PageResult<EmployeeProfileOption>> page(
            @RequestParam String tenantId,
            @RequestParam(required = false) String employeeNo,
            @RequestParam(required = false) String name,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int pageSize) {
        return ApiResponse.success(
                profiles.page(
                        new EmployeeProfileQuery(tenantId, employeeNo, name, page, pageSize)));
    }

    @RequireAdmin(superAdministrator = true)
    @GetMapping("/admin-api/administrators/employee-profiles")
    public ApiResponse<PageResult<EmployeeProfileOption>> administratorCandidates(
            @RequestParam String tenantId,
            @RequestParam(required = false) String employeeNo,
            @RequestParam(required = false) String name,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int pageSize) {
        return ApiResponse.success(
                profiles.page(
                        new EmployeeProfileQuery(tenantId, employeeNo, name, page, pageSize)));
    }
}
