package io.github.chenyilei2016.openplatform.web.admin.catalog;

import io.github.chenyilei2016.openplatform.application.catalog.ApiCategoryService;
import io.github.chenyilei2016.openplatform.common.ApiResponse;
import io.github.chenyilei2016.openplatform.domain.access.AccessOperator;
import io.github.chenyilei2016.openplatform.domain.administration.AdminPermission;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiCategory;
import io.github.chenyilei2016.openplatform.domain.catalog.CatalogPageQuery;
import io.github.chenyilei2016.openplatform.domain.common.PageResult;
import io.github.chenyilei2016.openplatform.identity.AdminSession;
import io.github.chenyilei2016.openplatform.identity.RequireAdmin;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;

import lombok.RequiredArgsConstructor;

import org.slf4j.MDC;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

@RestController
@Validated
@RequiredArgsConstructor
@RequestMapping("/admin-api/api-categories")
@RequireAdmin(permissions = AdminPermission.MANAGE_APIS)
public class ApiCategoryController {
    private final ApiCategoryService categories;

    public record CreateRequest(@NotBlank @Size(max = 100) String name) {}

    public record RenameRequest(
            @NotBlank @Size(max = 100) String name, @NotNull @Positive Long expectedRevision) {}

    public record RemoveRequest(
            @Size(max = 36) String targetId, @NotNull @Positive Long expectedRevision) {}

    @GetMapping
    public ApiResponse<PageResult<ApiCategoryService.View>> page(
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int pageSize,
            @RequestParam(required = false) String query) {
        return ApiResponse.success(categories.page(new CatalogPageQuery(page, pageSize, query)));
    }

    @GetMapping("/resolve")
    public ApiResponse<String> resolve(@RequestParam @NotBlank @Size(max = 100) String name) {
        return ApiResponse.success(categories.displayName(name));
    }

    @GetMapping("/{id}")
    public ApiResponse<ApiCategoryService.View> find(@PathVariable @Size(max = 36) String id) {
        return ApiResponse.success(categories.find(id));
    }

    @PostMapping
    public ApiResponse<ApiCategory> create(
            @Valid @RequestBody CreateRequest body, HttpServletRequest request) {
        return ApiResponse.success(categories.create(body.name(), operator(request)));
    }

    @PutMapping("/{id}")
    public ApiResponse<ApiCategory> rename(
            @PathVariable @Size(max = 36) String id,
            @Valid @RequestBody RenameRequest body,
            HttpServletRequest request) {
        return ApiResponse.success(
                categories.rename(id, body.name(), body.expectedRevision(), operator(request)));
    }

    @PostMapping("/{id}/remove")
    public ApiResponse<Void> remove(
            @PathVariable @Size(max = 36) String id,
            @Valid @RequestBody RemoveRequest body,
            HttpServletRequest request) {
        categories.remove(id, body.targetId(), body.expectedRevision(), operator(request));
        return ApiResponse.success(null);
    }

    private AccessOperator operator(HttpServletRequest request) {
        AdminSession session = AdminSession.current(request);
        return new AccessOperator(
                session.tenantId(),
                session.employeeNo(),
                MDC.get("requestId"),
                session.userId(),
                session.employeeId());
    }
}
