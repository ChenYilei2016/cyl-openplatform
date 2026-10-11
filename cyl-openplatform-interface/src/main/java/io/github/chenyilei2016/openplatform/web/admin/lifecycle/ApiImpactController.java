package io.github.chenyilei2016.openplatform.web.admin.lifecycle;

import io.github.chenyilei2016.openplatform.application.lifecycle.ApiImpactService;
import io.github.chenyilei2016.openplatform.common.ApiResponse;
import io.github.chenyilei2016.openplatform.domain.access.AccessPageQuery;
import io.github.chenyilei2016.openplatform.domain.lifecycle.ImpactBasis;
import io.github.chenyilei2016.openplatform.domain.administration.AdminPermission;
import io.github.chenyilei2016.openplatform.identity.RequireAdmin;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.constraints.Size;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 集中后台查看API授权覆盖应用；同时要求应用管理和API发布查看权限。 */
@RequireAdmin(permissions = AdminPermission.MANAGE_APPLICATIONS)
@RestController
@RequiredArgsConstructor
public class ApiImpactController {
    private final ApiImpactService impacts;

    @GetMapping("/admin-api/apis/{id}/affected-applications")
    @RequireAdmin(permissions = {AdminPermission.MANAGE_APIS, AdminPermission.PUBLISH_APIS, AdminPermission.REVIEW_APIS}, match = RequireAdmin.Match.ANY)
    public ApiResponse<ApiImpactService.AffectedApplications> affected(
            @PathVariable @Size(max = 36) String id,
            @RequestParam(defaultValue = "EFFECTIVE") ImpactBasis basis,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int pageSize,
            @RequestParam(required = false) String query,
            @RequestParam(required = false) Long expectedRevision,
            HttpServletRequest request, HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store");
        return ApiResponse.success(impacts.affected(id, basis, expectedRevision, new AccessPageQuery(page, pageSize, query)));
    }
}
