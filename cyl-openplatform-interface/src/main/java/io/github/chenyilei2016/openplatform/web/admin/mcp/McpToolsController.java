package io.github.chenyilei2016.openplatform.web.admin.mcp;

import io.github.chenyilei2016.openplatform.application.mcp.McpToolCatalogService;
import io.github.chenyilei2016.openplatform.application.mcp.McpToolSetService;
import io.github.chenyilei2016.openplatform.common.ApiResponse;
import io.github.chenyilei2016.openplatform.domain.access.AccessOperator;
import io.github.chenyilei2016.openplatform.domain.administration.AdminPermission;
import io.github.chenyilei2016.openplatform.domain.catalog.CatalogPageQuery;
import io.github.chenyilei2016.openplatform.domain.common.PageResult;
import io.github.chenyilei2016.openplatform.domain.mcp.McpToolSet;
import io.github.chenyilei2016.openplatform.identity.AdminSession;
import io.github.chenyilei2016.openplatform.identity.RequireAdmin;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.slf4j.MDC;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/admin-api/mcp")
@RequireAdmin(permissions = AdminPermission.MANAGE_APPLICATIONS)
@RequiredArgsConstructor
public class McpToolsController {
    private final McpToolCatalogService catalog;
    private final McpToolSetService sets;

    public record ToolPage(List<McpToolCatalogService.ToolRow> items, String nextCursor) {}
    public record CreateSet(@NotBlank @Size(max = 64) String code, @NotBlank @Size(max = 100) String name,
                            @Size(max = 500) String description, @NotNull Boolean enabled,
                            @NotNull @Size(max = 200) List<@NotBlank @Size(max = 36) String> apiIds) {}
    public record UpdateSet(@NotBlank @Size(max = 100) String name, @Size(max = 500) String description,
                            @NotNull Boolean enabled, @NotNull @Size(max = 200) List<@NotBlank @Size(max = 36) String> apiIds,
                            @NotNull @PositiveOrZero @Max(9007199254740990L) Long expectedRevision) {}

    /** 按游标列出当前已发布的MCP工具；单页最多100项；setCode可限定启用的工具集。 */
    @GetMapping("/tools")
    public ApiResponse<ToolPage> tools(@RequestParam(required = false) @Size(max = 256) String cursor,
                                      @RequestParam(required = false) @Size(max = 64) String setCode) {
        McpToolCatalogService.ManagementPage page = catalog.managementList(sets.requireActiveId(setCode), cursor);
        return ApiResponse.success(new ToolPage(page.rows(), page.nextCursor()));
    }

    /** 分页检索MCP工具集 */
    @GetMapping("/tool-sets")
    public ApiResponse<PageResult<McpToolSet>> sets(@RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int pageSize, @RequestParam(required = false) String query) {
        return ApiResponse.success(sets.page(new CatalogPageQuery(page, pageSize, query)));
    }
    /** 读取工具集及其成员 */
    @GetMapping("/tool-sets/{id}")
    public ApiResponse<McpToolSetService.Detail> detail(@PathVariable @Size(max = 64) String id) { return ApiResponse.success(sets.detail(id)); }

    /** 创建MCP工具集；代码创建后不可修改；最多200个已发布可用工具。 */
    @PostMapping("/tool-sets")
    public ApiResponse<McpToolSetService.Detail> create(@Valid @RequestBody CreateSet body, HttpServletRequest request) {
        return ApiResponse.success(sets.create(body.code(), body.name(), body.description(), body.enabled(), body.apiIds(), operator(request)));
    }
    /** 修改工具集配置和成员；使用修订号防止覆盖他人编辑；停用立即阻止新调用。 */
    @PutMapping("/tool-sets/{id}")
    public ApiResponse<McpToolSetService.Detail> update(@PathVariable @Size(max = 64) String id,
            @Valid @RequestBody UpdateSet body, HttpServletRequest request) {
        return ApiResponse.success(sets.update(id, body.name(), body.description(), body.enabled(), body.apiIds(), body.expectedRevision(), operator(request)));
    }
    /** 删除工具集；只删除分类和成员关系，不删除API；原分类地址返回404。 */
    @DeleteMapping("/tool-sets/{id}")
    public ApiResponse<Void> delete(@PathVariable @Size(max = 64) String id,
            @RequestParam @PositiveOrZero @Max(9007199254740990L) long expectedRevision, HttpServletRequest request) {
        sets.delete(id, expectedRevision, operator(request));
        return ApiResponse.success(null);
    }
    private AccessOperator operator(HttpServletRequest request) {
        AdminSession session = AdminSession.current(request);
        return new AccessOperator(session.tenantId(), session.employeeNo(), MDC.get("requestId"), session.userId(), session.employeeId());
    }
}
