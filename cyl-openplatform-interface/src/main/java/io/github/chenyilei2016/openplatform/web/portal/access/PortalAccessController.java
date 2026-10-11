package io.github.chenyilei2016.openplatform.web.portal.access;

import io.github.chenyilei2016.openplatform.application.access.ApplicationCredentials;
import io.github.chenyilei2016.openplatform.application.access.UserGrantView;
import io.github.chenyilei2016.openplatform.domain.access.EmployeeIdentity;
import io.github.chenyilei2016.openplatform.application.access.TenantGrantView;
import io.github.chenyilei2016.openplatform.application.portal.PortalAccessService;
import io.github.chenyilei2016.openplatform.common.ApiResponse;
import io.github.chenyilei2016.openplatform.domain.access.AccessOperator;
import io.github.chenyilei2016.openplatform.domain.access.GrantStatus;
import io.github.chenyilei2016.openplatform.domain.access.AccessPageQuery;
import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PageResult;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.github.chenyilei2016.openplatform.domain.portal.PortalApplication;
import io.github.chenyilei2016.openplatform.domain.portal.PortalApplicationQuery;
import io.github.chenyilei2016.openplatform.identity.PortalSession;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.slf4j.MDC;
import org.springframework.web.bind.annotation.*;

/** 有自助资格的客户生成、绑定及撤销本租户关联；所有租户信息来自平台登录会话。 */
@RestController
@RequestMapping("/portal-api")
@RequiredArgsConstructor
public class PortalAccessController {
    private final PortalAccessService service;

    /** 备注可选；省略或空白时按既有凭据ID生成稳定展示名。 */
    /** 本租户用途备注，留空表示未设置；name兼容旧版门户请求。 */
    public record CreateApplication(
            @com.fasterxml.jackson.annotation.JsonAlias("name")
            @Size(max = 100) String note) {}
    public record BindApplication(@NotBlank @Pattern(regexp = "[a-f0-9]{32}") String appKey,
                                  @NotBlank @Size(max = 128) String appSecret) {
        @Override public String toString() { return "BindApplication[appKey=" + appKey + "]"; }
    }

    /** 仅查询可信当前租户，旧query与独立AK/备注条件取交集；包含停用及已解绑记录。 */
    @GetMapping("/applications")
    public ApiResponse<PageResult<PortalApplication>> applications(@RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int pageSize, @RequestParam(required = false) String query,
            @RequestParam(required = false) @Pattern(regexp = "[a-f0-9]{32}") String appKey,
            @RequestParam(required = false) @Size(max = 100) String name, @RequestParam(required = false) GrantStatus status, HttpServletRequest request) {
        return ApiResponse.success(service.applications(
                new PortalApplicationQuery(new AccessPageQuery(page, pageSize, query), appKey, name, status), operator(request)));
    }

    /** 生成前显示默认权限是否可用；不返回密钥或允许修改权限的入口。 */
    @GetMapping("/creation-availability")
    public ApiResponse<PortalAccessService.CreationAvailability> creationAvailability(HttpServletRequest request) {
        operator(request);
        return ApiResponse.success(service.creationAvailability());
    }

    /** 独立凭据工作区按本租户关系ID定位，返回列表同一最小投影。 */
    @GetMapping("/applications/{id}")
    public ApiResponse<PortalApplication> application(@PathVariable @Size(max = 36) String id, HttpServletRequest request) {
        return ApiResponse.success(service.application(id, operator(request)));
    }

    /** 原始Secret仅在此响应出现，应用与本租户关联创建保证原子性。 */
    @PostMapping("/applications")
    public ApiResponse<ApplicationCredentials> create(@Valid @RequestBody CreateApplication body, HttpServletRequest request) {
        return ApiResponse.success(service.create(body.note(), operator(request)));
    }

    @PostMapping("/bindings")
    public ApiResponse<TenantGrantView> bind(@Valid @RequestBody BindApplication body, HttpServletRequest request) {
        return ApiResponse.success(service.bind(body.appKey(), body.appSecret(), operator(request)));
    }

    public record UpdateNote(@NotNull String note, @NotNull @PositiveOrZero Long expectedRevision) {}

    /** 精确读取本租户关联，供并发冲突后核对；不扩大到后台角色可见的其他租户。 */
    @GetMapping("/bindings/{id}")
    public ApiResponse<TenantGrantView> binding(@PathVariable @Size(max = 36) String id, HttpServletRequest request) {
        return ApiResponse.success(service.binding(id, operator(request)));
    }

    /** 仅修改展示备注及其独立修订号，不影响调用授权或已签发Token。 */
    @PutMapping("/bindings/{id}/note")
    public ApiResponse<TenantGrantView> updateNote(@PathVariable @Size(max = 36) String id,
            @Valid @RequestBody UpdateNote body, HttpServletRequest request) {
        return ApiResponse.success(service.updateNote(id, body.note(), body.expectedRevision(), operator(request)));
    }

    @PostMapping("/bindings/{id}/revoke")
    public ApiResponse<Void> revoke(@PathVariable @Size(max = 36) String id,
            @RequestBody(required = false) Map<String, Object> body, HttpServletRequest request) {
        if (body != null && !body.isEmpty()) throw new PlatformException(ErrorCode.INVALID_REQUEST, "解绑请求不能指定租户或其他授权信息");
        service.revoke(id, operator(request));
        return ApiResponse.success(null);
    }

    public record LookupEmployee(@NotBlank @Size(max = 64) String employeeNo) {}
    /** 预览标识仅作并发保护，可信身份仍由服务端再次查询身份服务。 */
    public record GrantEmployee(@NotBlank @Size(max = 64) String employeeNo,
                                @NotBlank @Size(max = 64) String expectedUserId,
                                @NotBlank @Size(max = 64) String expectedEmployeeId) {}
    public record RevokeEmployee(@NotNull @PositiveOrZero Long expectedAuthorizationVersion) {}

    @GetMapping("/bindings/{id}/users")
    public ApiResponse<PageResult<UserGrantView>> users(@PathVariable @Size(max = 36) String id,
            @RequestParam(defaultValue = "1") int page, @RequestParam(defaultValue = "20") int pageSize,
            @RequestParam(required = false) @Size(max = 64) String employeeNo, HttpServletRequest request) {
        return ApiResponse.success(service.users(id, new AccessPageQuery(page, pageSize, employeeNo), operator(request)));
    }

    @PostMapping("/bindings/{id}/employee-lookup")
    public ApiResponse<EmployeeIdentity> lookupUser(@PathVariable @Size(max = 36) String id,
            @Valid @RequestBody LookupEmployee body, HttpServletRequest request) {
        return ApiResponse.success(service.lookupUser(id, body.employeeNo(), operator(request)));
    }

    /** 任意本租户有效员工可代办；不表示被委托人员本人确认。 */
    @PostMapping("/bindings/{id}/users")
    public ApiResponse<UserGrantView> grantUser(@PathVariable @Size(max = 36) String id,
            @Valid @RequestBody GrantEmployee body, HttpServletRequest request) {
        return ApiResponse.success(service.grantUser(id, body.employeeNo(), body.expectedUserId(), body.expectedEmployeeId(), operator(request)));
    }

    @PostMapping("/bindings/{id}/users/{userGrantId}/revoke")
    public ApiResponse<Void> revokeUser(@PathVariable @Size(max = 36) String id,
            @PathVariable @Size(max = 36) String userGrantId, @Valid @RequestBody RevokeEmployee body,
            HttpServletRequest request) {
        service.revokeUser(id, userGrantId, body.expectedAuthorizationVersion(), operator(request));
        return ApiResponse.success(null);
    }

    private AccessOperator operator(HttpServletRequest request) {
        PortalSession session = PortalSession.current(request);
        return new AccessOperator(session.tenantId(), session.employeeNo(), MDC.get("requestId"), session.userId(), session.employeeId());
    }
}
