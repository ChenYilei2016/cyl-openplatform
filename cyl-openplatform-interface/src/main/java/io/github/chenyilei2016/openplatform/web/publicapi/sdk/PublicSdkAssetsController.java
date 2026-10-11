package io.github.chenyilei2016.openplatform.web.publicapi.sdk;

import io.github.chenyilei2016.openplatform.application.sdk.SdkAssetService;
import io.github.chenyilei2016.openplatform.common.ApiResponse;
import io.github.chenyilei2016.openplatform.domain.common.PageResult;
import io.github.chenyilei2016.openplatform.domain.sdk.SdkAsset;
import io.github.chenyilei2016.openplatform.domain.sdk.SdkAssetQuery;
import io.github.chenyilei2016.openplatform.web.shared.sdk.SdkDownloads;
import io.github.chenyilei2016.openplatform.web.shared.sdk.SdkTransferLimiter;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Size;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

/** 已发布平台SDK的匿名目录；下载文件不授予任何API调用权限。 */
@RestController
@RequestMapping("/public-api/sdk-assets")
@RequiredArgsConstructor
public class PublicSdkAssetsController {
    private final SdkAssetService service;
    private final SdkTransferLimiter transfers;

    @GetMapping
    public ApiResponse<PageResult<SdkAsset>> page(@RequestParam(defaultValue="1") int page,
            @RequestParam(defaultValue="20") int pageSize, @RequestParam(required=false) String query,
            @RequestParam(required=false) String sdkVersion, @RequestParam(required=false) String language,
            HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store");
        return ApiResponse.success(service.publicPage(new SdkAssetQuery(page, pageSize, query, null, null, null, sdkVersion, language)));
    }

    @GetMapping("/{id}")
    public ApiResponse<SdkAsset> detail(@PathVariable @Size(max=36) String id, HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store");
        return ApiResponse.success(service.publicAsset(id));
    }

    @GetMapping("/{id}/download")
    public ResponseEntity<byte[]> download(@PathVariable @Size(max=36) String id,
            @RequestParam @Min(1) @Max(Long.MAX_VALUE-1) long expectedRevision, HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store");
        return transfers.execute(() -> SdkDownloads.response(service.publicDownload(id, expectedRevision)));
    }
}
