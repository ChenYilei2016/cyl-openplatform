package io.github.chenyilei2016.openplatform.web.openapi.documentation;

import io.github.chenyilei2016.openplatform.web.shared.documentation.DocumentDownloads;
import io.github.chenyilei2016.openplatform.application.documentation.DocumentAccessService;
import io.github.chenyilei2016.openplatform.application.documentation.DocumentCatalogService;
import io.github.chenyilei2016.openplatform.application.token.TokenVerifier;
import io.github.chenyilei2016.openplatform.common.ApiResponse;
import io.github.chenyilei2016.openplatform.domain.common.*;
import io.github.chenyilei2016.openplatform.domain.documentation.*;
import io.github.chenyilei2016.openplatform.identity.*;
import io.github.chenyilei2016.openplatform.web.shared.token.BearerToken;
import jakarta.servlet.http.*;
import jakarta.validation.constraints.*;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

/** 客户目录、详情及导出均重新验证业务Token，不接受管理会话替代。 */
@RestController
@RequestMapping("/api/docs")
@RequiredArgsConstructor
public class CustomerDocumentsController {
    private final DocumentCatalogService catalog;
    private final DocumentAccessService documents;
    private final DocumentDownloads downloads;
    private final TokenVerifier tokens;

    @GetMapping
    public ApiResponse<PageResult<DocumentSummary>> page(
            @RequestParam(defaultValue="1") int page, @RequestParam(defaultValue="20") int pageSize,
            @RequestParam(required=false) String query, @RequestParam(required=false) String category,
            @RequestParam(required=false) String service, @RequestParam(required=false) String version,
            @RequestParam(required=false) String method, @RequestParam(defaultValue="false") boolean mcpOnly, HttpServletRequest request, HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store");
        return ApiResponse.success(catalog.page(new DocumentQuery(page, pageSize, query, category, service, version, method, mcpOnly), DocumentAudience.CUSTOMER, tokens.verify(BearerToken.read(request)).scopeCodes(), null));
    }

    @GetMapping("/categories")
    public ApiResponse<PageResult<DocumentCategory>> categories(
            @RequestParam(defaultValue="1") int page, @RequestParam(defaultValue="20") int pageSize,
            @RequestParam(required=false) String query, @RequestParam(required=false) String category,
            @RequestParam(required=false) String service, @RequestParam(required=false) String version,
            @RequestParam(required=false) String method, @RequestParam(defaultValue="false") boolean mcpOnly, HttpServletRequest request, HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store");
        return ApiResponse.success(catalog.categories(new DocumentQuery(page, pageSize, query, category, service, version, method, mcpOnly), DocumentAudience.CUSTOMER, tokens.verify(BearerToken.read(request)).scopeCodes(), null));
    }

    @GetMapping("/{service}/{version}/{method}/view")
    public ApiResponse<DocumentView> view(@PathVariable @Size(max=64) String service,
            @PathVariable @Size(max=32) String version, @PathVariable @Size(max=64) String method,
            HttpServletRequest request, HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store");
        return ApiResponse.success(documents.customer(service, version, method, tokens.verify(BearerToken.read(request))));
    }

    @GetMapping("/{service}/{version}/{method}/export")
    public ResponseEntity<byte[]> export(@PathVariable @Size(max=64) String service,
            @PathVariable @Size(max=32) String version, @PathVariable @Size(max=64) String method,
            @RequestParam DocumentFormat format, @RequestParam @Size(max=36) String releaseId,
            @RequestParam @Min(0) long stateVersion, HttpServletRequest request, HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store");
        return downloads.download(documents.customer(service, version, method, tokens.verify(BearerToken.read(request))), releaseId, stateVersion, format);
    }
}
