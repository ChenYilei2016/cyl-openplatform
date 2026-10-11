package io.github.chenyilei2016.openplatform.web.admin.access;

import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.ObjectIdType;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import io.github.chenyilei2016.openplatform.application.access.AccessManagementService;
import io.github.chenyilei2016.openplatform.application.access.ApplicationCredentials;
import io.github.chenyilei2016.openplatform.application.access.ApplicationView;
import io.github.chenyilei2016.openplatform.application.access.AuditView;
import io.github.chenyilei2016.openplatform.application.access.RotatedSecret;
import io.github.chenyilei2016.openplatform.application.access.ScopeView;
import io.github.chenyilei2016.openplatform.common.ApiResponse;
import io.github.chenyilei2016.openplatform.domain.access.AccessPageQuery;
import io.github.chenyilei2016.openplatform.domain.access.AccessOperator;
import org.slf4j.MDC;
import java.util.List;
import java.util.Set;
import io.github.chenyilei2016.openplatform.domain.access.ApplicationFilter;
import io.github.chenyilei2016.openplatform.domain.access.ApplicationStatus;
import io.github.chenyilei2016.openplatform.domain.access.CredentialSearch;
import io.github.chenyilei2016.openplatform.domain.access.GrantStatus;
import io.github.chenyilei2016.openplatform.domain.access.ScopeApi;
import io.github.chenyilei2016.openplatform.domain.access.ScopeFilter;
import io.github.chenyilei2016.openplatform.domain.common.PageResult;
import io.github.chenyilei2016.openplatform.domain.administration.AdminPermission;
import io.github.chenyilei2016.openplatform.identity.AdminSession;
import io.github.chenyilei2016.openplatform.identity.RequireAdmin;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 平台集中运维应用管理入口；所有操作要求MANAGE_APPLICATIONS。 */
@RequireAdmin(permissions = AdminPermission.MANAGE_APPLICATIONS)
@RestController
@RequestMapping("/admin-api")
@RequiredArgsConstructor
public class AccessManagementController {
    private final AccessManagementService service;

    public record CreateScope(@NotBlank @Pattern(regexp = "[a-z0-9][a-z0-9_.:-]{0,63}") String code,
                              @NotBlank @Size(max = 100) String name, @NotNull Boolean enabled,
                              @NotNull Boolean defaultForNewApplication, Boolean publicAccess) {}
    /** scopeCodes 省略时授予“新凭据默认授予”的权限组；传入（可为空数组）时按所选初始权限组创建。 */
    public record CreateApplication(@Size(max = 100) String name,
                                    @NotBlank @Size(max = 64) String ownerTenantId,
                                    @Size(max = 100) List<@NotBlank @Size(max = 64) String> scopeCodes) {}

    @PostMapping("/scopes")
    public ApiResponse<ScopeView> createScope(@Valid @RequestBody CreateScope body, HttpServletRequest request) {
        return ApiResponse.success(service.createScope(body.code(), body.name(), body.enabled(), body.defaultForNewApplication(),
                Boolean.TRUE.equals(body.publicAccess()), operator(request)));
    }

    @PostMapping("/applications")
    public ApiResponse<ApplicationCredentials> createApplication(@Valid @RequestBody CreateApplication body, HttpServletRequest request, HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store");
        return ApiResponse.success(service.createApplication(body.name(), body.ownerTenantId(), body.scopeCodes(), operator(request)));
    }

    @GetMapping("/applications/{id}")
    public ApiResponse<ApplicationView> application(@PathVariable @Size(max = 36) String id, HttpServletRequest request) {
        return ApiResponse.success(service.application(id));
    }

    /**
     * search 为凭据列表主搜索框（名称包含或 AK 精确，见 {@link CredentialSearch}，不接受完整 Token）；
     * tokenId 为单独的 Token 记录 ID 精确定位，命中时返回所属凭据及 matchedTokenId。query/appKey 为原有分项条件，供其他选择器沿用。
     */
    @GetMapping("/applications")
    public ApiResponse<PageResult<ApplicationView>> applications(@RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int pageSize, @RequestParam(required = false) String query,
            @RequestParam(required = false) @Size(max = 100) String search,
            @RequestParam(required = false) @Size(max = 64) String tokenId,
            @RequestParam(required = false) @Pattern(regexp = "[a-f0-9]{32}") String appKey,
            @RequestParam(required = false) @Size(min = 1, max = 64) @Pattern(regexp = "\\S+") String tenantId,
            @RequestParam(required = false) Set<ApplicationStatus> status,
            @RequestParam(required = false) Set<GrantStatus> relationStatus, HttpServletRequest request) {
        CredentialSearch keyword = CredentialSearch.parse(search);
        String token = tokenId == null || tokenId.isBlank() ? null : tokenId.strip();
        if (token != null && !ObjectIdType.TOKEN_RECORD.accepts(token))
            throw new PlatformException(ErrorCode.INVALID_REQUEST, "Token 记录 ID 格式不正确，应以 TOK_ 开头；不要粘贴完整 Token");
        return ApiResponse.success(service.applications(
                new AccessPageQuery(page, pageSize, keyword.nameContains() != null ? keyword.nameContains() : query),
                new ApplicationFilter(keyword.appKey() != null ? keyword.appKey() : appKey, tenantId, status, relationStatus, token)));
    }

    /** publicAccess（公共通用）可省略：创建时默认 false，修改时保留原值。 */
    public record EditScope(@NotBlank @Size(max = 100) String name, @NotNull Boolean enabled,
                            @NotNull Boolean defaultForNewApplication, Boolean publicAccess) {}
    // 兼容原管理请求中的只读归属字段，应用所有者始终由已存数据决定。
    @JsonIgnoreProperties("ownerTenantId")
    public record RenameApplication(@NotBlank @Size(max = 100) String name,
                                    @NotNull @Size(max = 100) String expectedName) {}
    public record ChangeStatus(@NotNull Boolean enabled) {}
    public record ChangeScopes(@NotNull @Size(max = 100) List<@NotBlank @Size(max = 64) String> scopeCodes) {}

    @GetMapping("/scopes")
    public ApiResponse<PageResult<ScopeView>> scopes(@RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int pageSize, @RequestParam(required = false) String query,
            @RequestParam(required = false) @Pattern(regexp = "[a-z0-9][a-z0-9_.:-]{0,63}") String code,
            @RequestParam(required = false) @Size(max = 100) String name,
            @RequestParam(required = false) Set<Boolean> enabled,
            @RequestParam(required = false) Set<Boolean> defaultForNewApplication, HttpServletRequest request) {
        return ApiResponse.success(service.scopes(new AccessPageQuery(page, pageSize, query),
                new ScopeFilter(code, name, enabled, defaultForNewApplication)));
    }

    @GetMapping("/scopes/{id}")
    public ApiResponse<ScopeView> scope(@PathVariable @Size(max = 36) String id, HttpServletRequest request) {
        return ApiResponse.success(service.scope(id));
    }

    /** 权限组抽屉的 API 页（只读）；增删由 API 草稿保存接口完成，需 API 管理权限且发布后才影响调用。 */
    @GetMapping("/scopes/{id}/apis")
    public ApiResponse<PageResult<ScopeApi>> scopeApis(@PathVariable @Size(max = 36) String id,
            @RequestParam(defaultValue = "1") int page, @RequestParam(defaultValue = "20") int pageSize,
            @RequestParam(required = false) @Size(max = 100) String query, HttpServletRequest request) {
        return ApiResponse.success(service.scopeApis(id, new AccessPageQuery(page, pageSize, query)));
    }

    @PutMapping("/scopes/{id}")
    public ApiResponse<ScopeView> updateScope(@PathVariable @Size(max = 36) String id, @Valid @RequestBody EditScope body, HttpServletRequest request) {
        return ApiResponse.success(service.updateScope(id, body.name(), body.enabled(), body.defaultForNewApplication(), body.publicAccess(), operator(request)));
    }

    @PutMapping("/applications/{id}")
    public ApiResponse<ApplicationView> renameApplication(@PathVariable @Size(max = 36) String id, @Valid @RequestBody RenameApplication body, HttpServletRequest request) {
        return ApiResponse.success(service.renameApplication(id, body.name(), body.expectedName(), operator(request)));
    }

    @PutMapping("/applications/{id}/scopes")
    public ApiResponse<ApplicationView> setScopes(@PathVariable @Size(max = 36) String id, @Valid @RequestBody ChangeScopes body, HttpServletRequest request) {
        return ApiResponse.success(service.setScopes(id, body.scopeCodes(), operator(request)));
    }

    @PutMapping("/applications/{id}/status")
    public ApiResponse<ApplicationView> setStatus(@PathVariable @Size(max = 36) String id, @Valid @RequestBody ChangeStatus body, HttpServletRequest request) {
        return ApiResponse.success(service.setStatus(id, body.enabled(), operator(request)));
    }

    @PostMapping("/applications/{id}/secret/rotate")
    public ApiResponse<RotatedSecret> rotateSecret(@PathVariable @Size(max = 36) String id, HttpServletRequest request, HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store");
        return ApiResponse.success(service.rotateSecret(id, operator(request)));
    }

    @GetMapping("/applications/{id}/audit")
    public ApiResponse<PageResult<AuditView>> audit(@PathVariable @Size(max = 36) String id, @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int pageSize, HttpServletRequest request) {
        return ApiResponse.success(service.audit(id, new AccessPageQuery(page, pageSize, null)));
    }

    private AccessOperator operator(HttpServletRequest request) {
        AdminSession session = AdminSession.current(request);
        return new AccessOperator(session.tenantId(), session.employeeNo(), MDC.get("requestId"), session.userId(), session.employeeId());
    }
}
