package io.github.chenyilei2016.openplatform.web.shared.sdk;

import io.github.chenyilei2016.openplatform.application.sdk.SdkAssetService;
import org.springframework.http.*;

/** 错误由统一JSON处理；只有完整校验后的ZIP才带下载响应头。 */
public final class SdkDownloads {
    private SdkDownloads() {}

    public static ResponseEntity<byte[]> response(SdkAssetService.Download download) {
        return ResponseEntity.ok().contentType(MediaType.parseMediaType("application/zip"))
                .contentLength(download.content().length).cacheControl(CacheControl.noStore())
                .header("X-Content-Type-Options", "nosniff")
                .header(HttpHeaders.CONTENT_DISPOSITION, ContentDisposition.attachment().filename(download.filename()).build().toString())
                .body(download.content());
    }
}
