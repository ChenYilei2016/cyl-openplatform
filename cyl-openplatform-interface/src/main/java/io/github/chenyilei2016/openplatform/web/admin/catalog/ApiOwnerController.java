package io.github.chenyilei2016.openplatform.web.admin.catalog;

import io.github.chenyilei2016.openplatform.application.access.EmployeeProfileService;
import io.github.chenyilei2016.openplatform.application.access.EmployeeProfileService.EmployeeProfileOption;
import io.github.chenyilei2016.openplatform.application.catalog.ApiOwnerService;
import io.github.chenyilei2016.openplatform.common.ApiResponse;
import io.github.chenyilei2016.openplatform.domain.access.EmployeeProfileQuery;
import io.github.chenyilei2016.openplatform.domain.administration.AdminPermission;
import io.github.chenyilei2016.openplatform.domain.common.PageResult;
import io.github.chenyilei2016.openplatform.identity.AdminSession;
import io.github.chenyilei2016.openplatform.identity.RequireAdmin;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;

import lombok.RequiredArgsConstructor;

import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

/** API管理员按当前可信租户查找并核验负责人；不扩展员工授权管理权限。 */
@RestController
@Validated
@RequiredArgsConstructor
@RequestMapping("/admin-api/apis/owners")
public class ApiOwnerController {
    private final ApiOwnerService owners;
    private final EmployeeProfileService profiles;

    public record Lookup(
            @NotBlank @Size(max = 64) String employeeNo,
            @Size(max = 64) String expectedEmployeeId) {}

    @GetMapping
    @RequireAdmin(permissions = AdminPermission.MANAGE_APIS)
    public ApiResponse<PageResult<EmployeeProfileOption>> page(
            @RequestParam(required = false) String name,
            @RequestParam(required = false) String employeeNo,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int pageSize,
            HttpServletRequest request) {
        return ApiResponse.success(
                profiles.page(
                        new EmployeeProfileQuery(
                                AdminSession.current(request).tenantId(),
                                employeeNo,
                                name,
                                page,
                                pageSize)));
    }

    @GetMapping("/current")
    @RequireAdmin(permissions = AdminPermission.MANAGE_APIS)
    public ApiResponse<EmployeeProfileOption> current(HttpServletRequest request) {
        return ApiResponse.success(
                owners.current(
                        io.github.chenyilei2016.openplatform.identity.VerifiedEmployeeSession.current(request),
                        io.github.chenyilei2016.openplatform.identity.VerifiedEmployeeSession.tenantName(
                                request)));
    }

    @GetMapping("/{id}")
    @RequireAdmin(permissions = {AdminPermission.MANAGE_APIS, AdminPermission.PUBLISH_APIS, AdminPermission.REVIEW_APIS}, match = RequireAdmin.Match.ANY)
    public ApiResponse<EmployeeProfileOption> find(@PathVariable @Size(max = 100) String id) {
        return ApiResponse.success(owners.find(id));
    }

    @PostMapping("/verify")
    @RequireAdmin(permissions = AdminPermission.MANAGE_APIS)
    public ApiResponse<EmployeeProfileOption> verify(
            @Valid @RequestBody Lookup body, HttpServletRequest request) {
        return ApiResponse.success(
                owners.verify(
                        AdminSession.current(request).tenantId(),
                        body.employeeNo(),
                        body.expectedEmployeeId()));
    }
}
