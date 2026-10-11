package io.github.chenyilei2016.openplatform.web.admin.access;

import io.github.chenyilei2016.openplatform.application.access.TenantScopeAccessService;
import io.github.chenyilei2016.openplatform.application.access.TenantScopeGrantView;
import io.github.chenyilei2016.openplatform.common.ApiResponse;
import io.github.chenyilei2016.openplatform.domain.access.AccessOperator;
import io.github.chenyilei2016.openplatform.domain.access.AccessPageQuery;
import io.github.chenyilei2016.openplatform.domain.administration.AdminPermission;
import io.github.chenyilei2016.openplatform.domain.common.PageResult;
import io.github.chenyilei2016.openplatform.identity.AdminSession;
import io.github.chenyilei2016.openplatform.identity.RequireAdmin;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
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

/**
 * 权限组抽屉“已开通租户”：把权限组开通给指定租户（租户权限），只用于 MCP 工具可用性与门户展示，
 * 不改变普通凭据调用判断。写操作记入访问审计；要求 MANAGE_APPLICATIONS。
 */
@RequireAdmin(permissions = AdminPermission.MANAGE_APPLICATIONS)
@RestController
@RequestMapping("/admin-api/scopes/{id}/tenant-grants")
@RequiredArgsConstructor
public class TenantScopeGrantController {
    private final TenantScopeAccessService service;

    public record GrantTenant(@NotBlank @Size(max = 64) String tenantId) {}

    /** 分页列出该权限组的租户权限（含已撤销），有效在前；tenantId 按租户 ID 精确筛选。 */
    @GetMapping
    public ApiResponse<PageResult<TenantScopeGrantView>> grants(@PathVariable @Size(max = 36) String id,
            @RequestParam(defaultValue = "1") int page, @RequestParam(defaultValue = "20") int pageSize,
            @RequestParam(required = false) @Size(max = 64) String tenantId) {
        return ApiResponse.success(service.grants(id, new AccessPageQuery(page, pageSize, tenantId)));
    }

    /** 按租户 ID 开通；该租户已有有效授予时返回冲突，曾撤销的记录重新开通。 */
    @PostMapping
    public ApiResponse<TenantScopeGrantView> grant(@PathVariable @Size(max = 36) String id,
            @Valid @RequestBody GrantTenant body, HttpServletRequest request) {
        return ApiResponse.success(service.grant(id, body.tenantId(), operator(request)));
    }

    /** 撤销租户权限，保留记录；重复撤销返回当前记录。 */
    @DeleteMapping("/{grantId}")
    public ApiResponse<TenantScopeGrantView> revoke(@PathVariable @Size(max = 36) String id,
            @PathVariable @Size(max = 64) String grantId, HttpServletRequest request) {
        return ApiResponse.success(service.revoke(id, grantId, operator(request)));
    }

    private AccessOperator operator(HttpServletRequest request) {
        AdminSession session = AdminSession.current(request);
        return new AccessOperator(session.tenantId(), session.employeeNo(), MDC.get("requestId"), session.userId(), session.employeeId());
    }
}
