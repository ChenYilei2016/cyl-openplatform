package io.github.chenyilei2016.openplatform.web.shared.documentation;

import io.github.chenyilei2016.openplatform.domain.common.*;
import io.github.chenyilei2016.openplatform.domain.documentation.*;
import lombok.RequiredArgsConstructor;
import org.springframework.http.*;
import org.springframework.stereotype.Component;

/** 先完成固定版本校验和有界生成，再写附件响应，失败不留下半份下载。 */
@Component
@RequiredArgsConstructor
public class DocumentDownloads {
    private final DocumentRenderer renderer;

    public ResponseEntity<byte[]> download(DocumentView document, String releaseId, long stateVersion, DocumentFormat format) {
        if (!document.releaseId().equals(releaseId) || document.stateVersion() != stateVersion)
            throw new PlatformException(ErrorCode.CONFLICT, "文档生效版本或启停状态已变化，请刷新后导出");
        var result = renderer.render(document, format);
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .header(HttpHeaders.CONTENT_DISPOSITION, ContentDisposition.attachment().filename(result.filename()).build().toString())
                .header("X-Content-Type-Options", "nosniff")
                .contentType(MediaType.parseMediaType(result.mediaType())).contentLength(result.bytes().length).body(result.bytes());
    }
}
