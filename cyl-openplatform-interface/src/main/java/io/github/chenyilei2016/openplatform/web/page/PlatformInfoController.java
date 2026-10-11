package io.github.chenyilei2016.openplatform.web.page;

import io.github.chenyilei2016.openplatform.common.ApiResponse;
import io.github.chenyilei2016.openplatform.application.platform.PlatformSettings;
import lombok.RequiredArgsConstructor;
import io.github.chenyilei2016.openplatform.domain.environmentrelease.ReleaseEnvironment;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/** 提供不含凭据的公开登录引导信息。 */
@RestController
@RequiredArgsConstructor
public class PlatformInfoController {
    private final PlatformSettings properties;
    private final ReleaseEnvironment environment;

    @GetMapping("/platform-info")
    public ApiResponse<PlatformInfo> info() {
        return ApiResponse.success(new PlatformInfo(properties.getName(), properties.getAdminLoginUrl(), properties.getGatewayBaseUrl(), environment.environmentId()));
    }

    public record PlatformInfo(String name, String adminLoginUrl, String gatewayBaseUrl, String environmentId) {}
}
