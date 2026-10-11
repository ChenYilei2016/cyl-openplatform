package io.github.chenyilei2016.openplatform.web.admin.documentation;

import io.github.chenyilei2016.openplatform.domain.administration.AdminPermission;
import io.github.chenyilei2016.openplatform.web.shared.documentation.DocumentDownloads;
import io.github.chenyilei2016.openplatform.application.documentation.DocumentAccessService;
import io.github.chenyilei2016.openplatform.application.documentation.DocumentCatalogService;
import io.github.chenyilei2016.openplatform.common.ApiResponse;
import io.github.chenyilei2016.openplatform.domain.common.*;
import io.github.chenyilei2016.openplatform.domain.documentation.*;
import io.github.chenyilei2016.openplatform.identity.RequireAdmin;
import jakarta.servlet.http.*;
import jakarta.validation.constraints.*;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

/** 集中管理者核查公开生效文档，不代表客户Token授权。 */
@RequireAdmin(permissions = {AdminPermission.MANAGE_APIS, AdminPermission.PUBLISH_APIS, AdminPermission.REVIEW_APIS}, match = RequireAdmin.Match.ANY)
@RestController
@RequestMapping("/admin-api/documents")
@RequiredArgsConstructor
public class AdminDocumentsController {
    private final DocumentCatalogService catalog;
    private final DocumentAccessService documents;
    private final DocumentDownloads downloads;

    @GetMapping
    public ApiResponse<PageResult<DocumentSummary>> page(
            @RequestParam(defaultValue="1") int page, @RequestParam(defaultValue="20") int pageSize,
            @RequestParam(required=false) String query, @RequestParam(required=false) String category,
            @RequestParam(required=false) String service, @RequestParam(required=false) String version,
            @RequestParam(required=false) String method, @RequestParam(defaultValue="false") boolean mcpOnly, HttpServletRequest request, HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store");
        return ApiResponse.success(catalog.page(new DocumentQuery(page, pageSize, query, category, service, version, method, mcpOnly), DocumentAudience.ADMINISTRATIVE, java.util.List.of(), null));
    }

    @GetMapping("/categories")
    public ApiResponse<PageResult<DocumentCategory>> categories(
            @RequestParam(defaultValue="1") int page, @RequestParam(defaultValue="20") int pageSize,
            @RequestParam(required=false) String query, @RequestParam(required=false) String category,
            @RequestParam(required=false) String service, @RequestParam(required=false) String version,
            @RequestParam(required=false) String method, @RequestParam(defaultValue="false") boolean mcpOnly, HttpServletRequest request, HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store");
        return ApiResponse.success(catalog.categories(new DocumentQuery(page, pageSize, query, category, service, version, method, mcpOnly), DocumentAudience.ADMINISTRATIVE, java.util.List.of(), null));
    }

    @GetMapping("/{service}/{version}/{method}/view")
    public ApiResponse<DocumentView> view(@PathVariable @Size(max=64) String service,
            @PathVariable @Size(max=32) String version, @PathVariable @Size(max=64) String method,
            HttpServletRequest request, HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store");
        return ApiResponse.success(documents.administrative(service, version, method));
    }

    @GetMapping("/{service}/{version}/{method}/export")
    public ResponseEntity<byte[]> export(@PathVariable @Size(max=64) String service,
            @PathVariable @Size(max=32) String version, @PathVariable @Size(max=64) String method,
            @RequestParam DocumentFormat format, @RequestParam @Size(max=36) String releaseId,
            @RequestParam @Min(0) long stateVersion, HttpServletRequest request, HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store");
        return downloads.download(documents.administrative(service, version, method), releaseId, stateVersion, format);
    }
}
