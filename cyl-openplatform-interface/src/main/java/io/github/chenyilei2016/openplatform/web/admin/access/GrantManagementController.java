package io.github.chenyilei2016.openplatform.web.admin.access;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;
import org.springframework.web.bind.annotation.PutMapping;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import io.github.chenyilei2016.openplatform.application.access.GrantManagementService;
import io.github.chenyilei2016.openplatform.application.access.TenantGrantView;
import io.github.chenyilei2016.openplatform.application.access.UserGrantView;
import io.github.chenyilei2016.openplatform.common.ApiResponse;
import io.github.chenyilei2016.openplatform.domain.access.AccessOperator;
import io.github.chenyilei2016.openplatform.domain.access.AccessPageQuery;
import io.github.chenyilei2016.openplatform.domain.access.EmployeeIdentity;
import io.github.chenyilei2016.openplatform.domain.common.PageResult;
import io.github.chenyilei2016.openplatform.domain.administration.AdminPermission;
import io.github.chenyilei2016.openplatform.identity.AdminSession;
import io.github.chenyilei2016.openplatform.identity.RequireAdmin;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import lombok.RequiredArgsConstructor;
import org.slf4j.MDC;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 平台集中运维的租户/人员授权入口，不作为客户自助资格入口。 */
@RequireAdmin(permissions = AdminPermission.MANAGE_APPLICATIONS)
@RestController
@RequestMapping("/admin-api")
@RequiredArgsConstructor
public class GrantManagementController {
    private final GrantManagementService service;

    public record BindTenant(@NotBlank @Pattern(regexp = "[a-f0-9]{32}") String appKey, @NotBlank @Size(max = 128) String appSecret,
                             @NotBlank @Size(max = 64) String tenantId) {
        @Override public String toString() { return "BindTenant[tenantId=" + tenantId + "]"; }
    }

    @PostMapping("/tenant-grants")
    public ApiResponse<TenantGrantView> bindTenant(@Valid @RequestBody BindTenant body, HttpServletRequest request) {
        return ApiResponse.success(service.bindTenant(body.appKey(), body.appSecret(), body.tenantId(), operator(request)));
    }

    @GetMapping("/applications/{id}/tenant-grants")
    public ApiResponse<PageResult<TenantGrantView>> tenants(@PathVariable @Size(max = 36) String id,
            @RequestParam(defaultValue = "1") int page, @RequestParam(defaultValue = "20") int pageSize,
            @RequestParam(required = false) @Size(max = 64) String tenantId, HttpServletRequest request) {
        return ApiResponse.success(service.tenants(id, new AccessPageQuery(page, pageSize, tenantId)));
    }

    @GetMapping("/applications/{applicationId}/tenant-grants/{id}")
    public ApiResponse<TenantGrantView> tenant(@PathVariable @Size(max = 36) String applicationId,
            @PathVariable @Size(max = 36) String id) {
        return ApiResponse.success(service.tenant(applicationId, id));
    }

    public record UpdateNote(@NotNull @Size(max = 100) String note,
                             @NotNull @PositiveOrZero Long expectedRevision) {}

    /** 修改指定关系的展示备注；expectedRevision必填，空串清除，不改变授权版本。 */
    @PutMapping("/applications/{applicationId}/tenant-grants/{id}/note")
    public ApiResponse<TenantGrantView> updateNote(@PathVariable @Size(max = 36) String applicationId,
            @PathVariable @Size(max = 36) String id, @Valid @RequestBody UpdateNote body, HttpServletRequest request) {
        return ApiResponse.success(service.updateNote(applicationId, id, body.note(), body.expectedRevision(), operator(request)));
    }

    @DeleteMapping("/tenant-grants/{id}")
    public ApiResponse<Void> revokeTenant(@PathVariable @Size(max = 36) String id, HttpServletRequest request) {
        service.revokeTenant(id, operator(request));
        return ApiResponse.success(null);
    }

    // 兼容原管理请求中的只读展示字段，实际人员身份必须来自人员目录SPI。
    @JsonIgnoreProperties({"userId", "displayName"})
    public record GrantUser(@NotBlank @Size(max = 64) String employeeNo,
                            @Size(min = 1, max = 64) String expectedUserId,
                            @Size(min = 1, max = 64) String expectedEmployeeId) {}

    public record LookupEmployee(@NotBlank @Size(max = 64) String employeeNo) {}

    /** 核验当前租户关联内的员工。仅查询权威人员身份，不建立委托。提交时携带已核验标识，服务端会再次核验。 */
    @PostMapping("/tenant-grants/{id}/employee-lookup")
    public ApiResponse<EmployeeIdentity> lookupUser(@PathVariable @Size(max = 36) String id,
            @Valid @RequestBody LookupEmployee body) {
        return ApiResponse.success(service.lookupUser(id, body.employeeNo()));
    }

    /** 核验并建立人员委托。租户由关联确定，身份取自人员目录查询；提供已核验标识时必须与最新身份一致。已有有效委托幂等返回。 */
    @PostMapping("/tenant-grants/{id}/users")
    public ApiResponse<UserGrantView> grantUser(@PathVariable @Size(max = 36) String id,
            @Valid @RequestBody GrantUser body, HttpServletRequest request) {
        return ApiResponse.success(service.grantUser(id, body.employeeNo(), body.expectedUserId(), body.expectedEmployeeId(), operator(request)));
    }

    @GetMapping({"/tenant-grants/{id}/users", "/applications/{applicationId}/tenant-grants/{id}/users"})
    public ApiResponse<PageResult<UserGrantView>> users(@PathVariable @Size(max = 36) String id,
            @RequestParam(defaultValue = "1") int page, @RequestParam(defaultValue = "20") int pageSize,
            @RequestParam(required = false) @Size(max = 64) String employeeNo,
            @PathVariable(required = false) @Size(max = 36) String applicationId, HttpServletRequest request) {
        if (applicationId != null) service.tenant(applicationId, id);
        return ApiResponse.success(service.users(id, new AccessPageQuery(page, pageSize, employeeNo)));
    }

    /** 撤销指定人员委托。可携带已查看的授权版本，防止撤销并发重新建立的委托。 */
    @DeleteMapping("/user-grants/{id}")
    public ApiResponse<Void> revokeUser(@PathVariable @Size(max = 36) String id,
            @RequestParam(required = false) @PositiveOrZero Long expectedVersion, HttpServletRequest request) {
        service.revokeUser(id, expectedVersion, operator(request));
        return ApiResponse.success(null);
    }

    private AccessOperator operator(HttpServletRequest request) {
        AdminSession session = AdminSession.current(request);
        return new AccessOperator(session.tenantId(), session.employeeNo(), MDC.get("requestId"), session.userId(), session.employeeId());
    }
}
