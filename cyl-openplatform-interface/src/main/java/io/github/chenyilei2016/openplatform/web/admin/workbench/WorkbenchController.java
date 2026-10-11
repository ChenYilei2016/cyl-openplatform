package io.github.chenyilei2016.openplatform.web.admin.workbench;

import io.github.chenyilei2016.openplatform.application.workbench.GlobalSearchService;
import io.github.chenyilei2016.openplatform.application.workbench.WorkbenchService;
import io.github.chenyilei2016.openplatform.common.ApiResponse;
import io.github.chenyilei2016.openplatform.identity.AdminSession;
import io.github.chenyilei2016.openplatform.identity.RequireAdmin;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.constraints.Size;
import lombok.RequiredArgsConstructor;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 工作台聚合与全局搜索：任何已登录管理员可访问，返回内容按会话权限逐区块裁剪，
 * 身份与权限只取可信会话，不接受客户端传入。
 */
@RestController
@RequiredArgsConstructor
@Validated
public class WorkbenchController {
    private final WorkbenchService workbench;
    private final GlobalSearchService search;

    /**
     * 工作台聚合（B6）。pendingReviews 需 API 管理/发布/审核任一权限；myDrafts 需 MANAGE_APIS；
     * traffic 与 alerts 需 VIEW_AUDIT。无权限的区块为 null。
     */
    @RequireAdmin(sessionOnly = true)
    @GetMapping("/admin-api/workbench")
    public ApiResponse<WorkbenchService.Workbench> overview(HttpServletRequest request, HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store");
        AdminSession session = AdminSession.current(request);
        return ApiResponse.success(workbench.overview(
                new WorkbenchService.Viewer(session.tenantId(), session.employeeId(), session.permissions())));
    }

    /**
     * 全局搜索（B4）。q 为 1–100 个字符；apis 需 MANAGE_APIS，credentials 需 MANAGE_APPLICATIONS，
     * calls（requestId 精确）需 VIEW_AUDIT，people 需 MANAGE_APPLICATIONS 或 VIEW_AUDIT。每组最多 5 条，无权限的分组为 null。
     */
    @RequireAdmin(sessionOnly = true)
    @GetMapping("/admin-api/search")
    public ApiResponse<GlobalSearchService.SearchResult> search(
            @RequestParam @Size(min = 1, max = GlobalSearchService.MAX_KEYWORD_LENGTH) String q,
            HttpServletRequest request, HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store");
        return ApiResponse.success(search.search(q, AdminSession.current(request).permissions()));
    }
}
