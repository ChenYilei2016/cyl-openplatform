package io.github.chenyilei2016.openplatform.web.admin.access;

import io.github.chenyilei2016.openplatform.application.access.TenantScopeAccessService;
import io.github.chenyilei2016.openplatform.application.access.TenantPermissionView;
import io.github.chenyilei2016.openplatform.application.access.TenantScopePermissionView;
import io.github.chenyilei2016.openplatform.domain.access.AccessPageQuery;
import io.github.chenyilei2016.openplatform.domain.access.TenantScopePermission;
import io.github.chenyilei2016.openplatform.domain.administration.AdminPermission;
import io.github.chenyilei2016.openplatform.domain.common.PageResult;
import io.github.chenyilei2016.openplatform.common.ApiResponse;
import io.github.chenyilei2016.openplatform.identity.RequireAdmin;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

/** 租户视角的权限管理；写入复用已有权限组开通/撤销接口及其审计与锁，不另建授权关系。 */
@RestController
@RequestMapping("/admin-api/tenant-permissions")
@RequireAdmin(permissions = AdminPermission.MANAGE_APPLICATIONS)
@RequiredArgsConstructor
public class TenantPermissionsController {
    private final TenantScopeAccessService service;

    /** 分页查找已有直接权限记录的租户；query为完整租户ID的精确匹配。 */
    @GetMapping
    public ApiResponse<PageResult<TenantPermissionView>> tenants(@RequestParam(defaultValue="1") int page,
            @RequestParam(defaultValue="20") int pageSize, @RequestParam(required=false) @Size(max=100) String query) {
        return ApiResponse.success(service.tenants(new AccessPageQuery(page, pageSize, query)));
    }

    /** 查询指定租户的全部/直接开通/公共通用/未开通权限组；不从客户端推断租户管理权限。 */
    @GetMapping("/{tenantId}/scopes")
    public ApiResponse<PageResult<TenantScopePermissionView>> scopes(@PathVariable @NotBlank @Size(max=64) String tenantId,
            @RequestParam(defaultValue="1") int page, @RequestParam(defaultValue="20") int pageSize,
            @RequestParam(required=false) @Size(max=100) String query,
            @RequestParam(defaultValue="ALL") TenantScopePermission.Filter filter) {
        return ApiResponse.success(service.permissions(tenantId, new AccessPageQuery(page, pageSize, query), filter));
    }
}
