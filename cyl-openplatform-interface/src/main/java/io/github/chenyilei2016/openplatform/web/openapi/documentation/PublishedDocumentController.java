package io.github.chenyilei2016.openplatform.web.openapi.documentation;

import io.github.chenyilei2016.openplatform.application.publication.PublishedApiService;
import io.github.chenyilei2016.openplatform.application.token.TokenVerifier;
import io.github.chenyilei2016.openplatform.common.ApiResponse;
import io.github.chenyilei2016.openplatform.web.shared.token.BearerToken;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.constraints.Size;

import lombok.RequiredArgsConstructor;

import org.springframework.web.bind.annotation.*;

/** 只暴露已生效文档，无内部提供方绑定、审核内容或草稿。 */
@RestController
@RequiredArgsConstructor
public class PublishedDocumentController {
    private final PublishedApiService publications;
    private final TokenVerifier tokens;

    @GetMapping("/api/docs/{service}/{version}/{method}")
    public ApiResponse<PublishedApiService.PublishedDocument> document(
            @PathVariable @Size(max = 64) String service,
            @PathVariable @Size(max = 32) String version,
            @PathVariable @Size(max = 64) String method,
            HttpServletRequest request,
            HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store");
        return ApiResponse.success(
                publications.document(
                        service, version, method, tokens.verify(BearerToken.read(request))));
    }
    @GetMapping("/api/docs/{service}/{version}/{method}/announcements")
    public ApiResponse<PublishedApiService.LifecycleAnnouncement> announcement(
            @PathVariable @Size(max = 64) String service,
            @PathVariable @Size(max = 32) String version,
            @PathVariable @Size(max = 64) String method,
            HttpServletRequest request, HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store");
        return ApiResponse.success(publications.announcement(service, version, method,
                tokens.verify(BearerToken.read(request))));
    }

}
