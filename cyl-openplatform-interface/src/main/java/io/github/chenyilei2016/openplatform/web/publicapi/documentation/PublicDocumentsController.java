package io.github.chenyilei2016.openplatform.web.publicapi.documentation;

import io.github.chenyilei2016.openplatform.web.shared.documentation.DocumentDownloads;
import io.github.chenyilei2016.openplatform.application.documentation.DocumentAccessService;
import io.github.chenyilei2016.openplatform.application.documentation.DocumentCatalogService;
import io.github.chenyilei2016.openplatform.common.ApiResponse;
import io.github.chenyilei2016.openplatform.domain.common.PageResult;
import io.github.chenyilei2016.openplatform.domain.documentation.*;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Size;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

/** 匿名读取公开生效文档；阅读与导出均不授予实际API调用权限。 */
@RestController
@RequestMapping("/public-api/documents")
@RequiredArgsConstructor
public class PublicDocumentsController {
    private final DocumentCatalogService catalog;
    private final DocumentAccessService documents;
    private final DocumentDownloads downloads;

    @GetMapping
    public ApiResponse<PageResult<DocumentSummary>> page(
            @RequestParam(defaultValue="1") int page, @RequestParam(defaultValue="20") int pageSize,
            @RequestParam(required=false) String query, @RequestParam(required=false) String category,
            @RequestParam(required=false) String service, @RequestParam(required=false) String version,
            @RequestParam(required=false) String method, @RequestParam(defaultValue="false") boolean mcpOnly, HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store");
        return ApiResponse.success(catalog.page(new DocumentQuery(page, pageSize, query, category, service, version, method, mcpOnly),
                DocumentAudience.PUBLIC, List.of(), null));
    }

    @GetMapping("/categories")
    public ApiResponse<PageResult<DocumentCategory>> categories(
            @RequestParam(defaultValue="1") int page, @RequestParam(defaultValue="20") int pageSize,
            @RequestParam(required=false) String query, @RequestParam(required=false) String category,
            @RequestParam(required=false) String service, @RequestParam(required=false) String version,
            @RequestParam(required=false) String method, @RequestParam(defaultValue="false") boolean mcpOnly, HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store");
        return ApiResponse.success(catalog.categories(new DocumentQuery(page, pageSize, query, category, service, version, method, mcpOnly),
                DocumentAudience.PUBLIC, List.of(), null));
    }

    @GetMapping("/{service}/{version}/{method}/view")
    public ApiResponse<DocumentView> view(@PathVariable @Size(max=64) String service,
            @PathVariable @Size(max=32) String version, @PathVariable @Size(max=64) String method,
            HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store");
        return ApiResponse.success(documents.visibleDocument(service, version, method, null));
    }

    @GetMapping("/{service}/{version}/{method}/export")
    public ResponseEntity<byte[]> export(@PathVariable @Size(max=64) String service,
            @PathVariable @Size(max=32) String version, @PathVariable @Size(max=64) String method,
            @RequestParam DocumentFormat format, @RequestParam @Size(max=36) String releaseId,
            @RequestParam @Min(0) long stateVersion, HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store");
        return downloads.download(documents.visibleDocument(service, version, method, null), releaseId, stateVersion, format);
    }
}
