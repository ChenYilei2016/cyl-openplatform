package io.github.chenyilei2016.openplatform.web.admin.environmentrelease;

import io.github.chenyilei2016.openplatform.domain.administration.AdminPermission;
import io.github.chenyilei2016.openplatform.application.environmentrelease.EnvironmentReleaseReceiver;
import io.github.chenyilei2016.openplatform.common.ApiResponse;
import io.github.chenyilei2016.openplatform.domain.common.*;
import io.github.chenyilei2016.openplatform.domain.environmentrelease.EnvironmentReleaseModels.IncomingReview;
import io.github.chenyilei2016.openplatform.identity.RequireAdmin;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import lombok.RequiredArgsConstructor;

import org.springframework.web.bind.annotation.*;

/** 目标审核页读取来源标签和提交差异；本地发布没有跨环境来源。 */
@RequireAdmin(permissions = {AdminPermission.MANAGE_APIS, AdminPermission.PUBLISH_APIS, AdminPermission.REVIEW_APIS}, match = RequireAdmin.Match.ANY)
@RestController
@RequiredArgsConstructor
public class IncomingReleaseController {
    private final EnvironmentReleaseReceiver receiver;

    @GetMapping("/admin-api/environment-releases/incoming/{releaseId}")
    public ApiResponse<IncomingReview> incoming(
            @PathVariable String releaseId,
            HttpServletRequest request,
            HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store");
        if (releaseId.length() > 36)
            throw new PlatformException(ErrorCode.INVALID_REQUEST, "发布记录ID不合法");
        return ApiResponse.success(receiver.incoming(releaseId));
    }
}
