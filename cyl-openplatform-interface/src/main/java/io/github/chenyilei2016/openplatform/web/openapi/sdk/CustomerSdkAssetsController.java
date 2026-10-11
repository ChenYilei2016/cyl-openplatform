package io.github.chenyilei2016.openplatform.web.openapi.sdk;

import io.github.chenyilei2016.openplatform.web.shared.sdk.SdkDownloads;
import io.github.chenyilei2016.openplatform.web.shared.sdk.SdkTransferLimiter;
import io.github.chenyilei2016.openplatform.application.sdk.SdkAssetService;
import io.github.chenyilei2016.openplatform.application.token.TokenVerifier;
import io.github.chenyilei2016.openplatform.common.ApiResponse;
import io.github.chenyilei2016.openplatform.domain.common.PageResult;
import io.github.chenyilei2016.openplatform.domain.sdk.*;
import io.github.chenyilei2016.openplatform.domain.token.TokenContext;
import io.github.chenyilei2016.openplatform.web.shared.token.BearerToken;
import jakarta.servlet.http.*;
import jakarta.validation.constraints.*;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

/** 已授权客户查看指定生效API的SDK与发布说明，不接受门户会话替代业务Token。 */
@RestController
@RequestMapping("/api/sdk-assets")
@RequiredArgsConstructor
public class CustomerSdkAssetsController {
    private final SdkAssetService service;
    private final TokenVerifier tokens;
    private final SdkTransferLimiter transfers;

    @GetMapping
    public ApiResponse<PageResult<SdkAsset>> page(@RequestParam @NotBlank @Size(max=64) String service,
            @RequestParam @NotBlank @Size(max=32) String version, @RequestParam @NotBlank @Size(max=64) String method,
            @RequestParam(defaultValue="1") int page, @RequestParam(defaultValue="20") int pageSize,
            HttpServletRequest request, HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store");
        return ApiResponse.success(this.service.customerPage(service, version, method, page, pageSize, tokens.verify(BearerToken.read(request))));
    }

    @GetMapping("/{id}")
    public ApiResponse<SdkAsset> detail(@PathVariable @Size(max=36) String id, HttpServletRequest request, HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store");
        return ApiResponse.success(service.customer(id, tokens.verify(BearerToken.read(request))));
    }

    @GetMapping("/{id}/download")
    public ResponseEntity<byte[]> download(@PathVariable @Size(max=36) String id,
            @RequestParam @Min(1) @Max(Long.MAX_VALUE-1) long expectedRevision, HttpServletRequest request, HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store");
        TokenContext token = tokens.verify(BearerToken.read(request));
        return transfers.execute(() -> SdkDownloads.response(service.customerDownload(id, expectedRevision, token)));
    }
}
