package io.github.chenyilei2016.openplatform.web.admin.administration;

import io.github.chenyilei2016.openplatform.application.administration.AdministratorService;
import io.github.chenyilei2016.openplatform.application.administration.AdministratorView;
import io.github.chenyilei2016.openplatform.common.ApiResponse;
import io.github.chenyilei2016.openplatform.domain.access.EmployeeIdentity;
import io.github.chenyilei2016.openplatform.domain.administration.*;
import io.github.chenyilei2016.openplatform.domain.common.PageResult;
import io.github.chenyilei2016.openplatform.identity.AdminSession;
import io.github.chenyilei2016.openplatform.identity.RequireAdmin;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;

import lombok.RequiredArgsConstructor;

import org.slf4j.MDC;
import org.springframework.web.bind.annotation.*;

import java.util.Set;

/** 平台管理员资格管理；本租户自助开通及客户授权不在此控制面内。 */
@RestController
@RequestMapping("/admin-api/administrators")
@RequireAdmin(sessionOnly = true)
@RequiredArgsConstructor
public class AdministratorController {
    private final AdministratorService administrators;

    public record EmployeeLookup(
            @NotBlank @Size(max = 64) String tenantId,
            @NotBlank @Size(max = 64) String employeeNo) {}

    public record Create(
            @NotBlank @Size(max = 64) String tenantId,
            @NotBlank @Size(max = 64) String employeeNo,
            @NotBlank @Size(max = 64) String expectedUserId,
            @NotBlank @Size(max = 64) String expectedEmployeeId,
            @NotNull @Size(max = 7) Set<@NotNull AdminPermission> permissions,
            @NotNull Boolean superAdministrator,
            @NotBlank @Size(max = 500) String reason) {}

    public record Update(
            @NotNull @Min(1) @Max(Long.MAX_VALUE - 1) Long expectedRevision,
            @NotNull @Size(max = 7) Set<@NotNull AdminPermission> permissions,
            @NotNull Boolean enabled,
            @NotNull Boolean superAdministrator,
            @NotBlank @Size(max = 500) String reason) {}

    /** 读取权限由应用服务明确检查“总管理员或审计权限”，不扩大其他业务权限。
     * search 为姓名包含或工号精确的单一搜索；superAdministrator 按角色筛选（true 总管理员 / false 普通管理员）。 */
    @GetMapping
    public ApiResponse<PageResult<AdministratorView>> page(
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int pageSize,
            @RequestParam(required = false) String search,
            @RequestParam(required = false) String name,
            @RequestParam(required = false) String tenantId,
            @RequestParam(required = false) String employeeNo,
            @RequestParam(required = false) Boolean enabled,
            @RequestParam(required = false) Boolean superAdministrator,
            HttpServletRequest request) {
        return ApiResponse.success(
                administrators.page(
                        new AdministratorQuery(page, pageSize, search, name, tenantId, employeeNo, enabled, superAdministrator),
                        actor(request)));
    }

    @GetMapping("/status")
    public ApiResponse<AdministratorStatus> status(HttpServletRequest request) {
        return ApiResponse.success(administrators.status(actor(request)));
    }

    /** 读取最新管理员资格与修订，用于独立工作区及并发冲突核对。 */
    @GetMapping("/{id}")
    public ApiResponse<AdministratorView> detail(@PathVariable @Size(max = 36) String id, HttpServletRequest request) {
        return ApiResponse.success(administrators.detail(id, actor(request)));
    }

    @GetMapping("/audit")
    public ApiResponse<PageResult<AdministratorAudit>> audit(
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int pageSize,
            @RequestParam(required = false) String administratorId,
            HttpServletRequest request) {
        return ApiResponse.success(
                administrators.audit(
                        new AdministratorAuditQuery(page, pageSize, administratorId),
                        actor(request)));
    }

    @RequireAdmin(superAdministrator = true)
    @PostMapping("/employee-lookup")
    public ApiResponse<EmployeeIdentity> employee(
            @Valid @RequestBody EmployeeLookup body, HttpServletRequest request) {
        return ApiResponse.success(
                administrators.lookupEmployee(body.tenantId(), body.employeeNo(), actor(request)));
    }

    @RequireAdmin(superAdministrator = true)
    @PostMapping
    public ApiResponse<Administrator> create(
            @Valid @RequestBody Create body, HttpServletRequest request) {
        return ApiResponse.success(
                administrators.create(
                        body.tenantId(),
                        body.employeeNo(),
                        body.expectedUserId(),
                        body.expectedEmployeeId(),
                        body.permissions(),
                        body.superAdministrator(),
                        body.reason(),
                        actor(request)));
    }

    @RequireAdmin(superAdministrator = true)
    @PutMapping("/{id}")
    public ApiResponse<Administrator> update(
            @PathVariable String id, @Valid @RequestBody Update body, HttpServletRequest request) {
        return ApiResponse.success(
                administrators.update(
                        id,
                        body.expectedRevision(),
                        body.permissions(),
                        body.enabled(),
                        body.superAdministrator(),
                        body.reason(),
                        actor(request)));
    }

    private AdministratorActor actor(HttpServletRequest request) {
        AdminSession session = AdminSession.current(request);
        return new AdministratorActor(
                session.administratorId(),
                session.tenantId(),
                session.employeeNo(),
                MDC.get("requestId"));
    }
}
