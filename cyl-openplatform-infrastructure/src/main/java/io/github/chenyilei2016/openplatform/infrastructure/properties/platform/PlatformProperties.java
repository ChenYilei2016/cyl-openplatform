package io.github.chenyilei2016.openplatform.infrastructure.properties.platform;

import io.github.chenyilei2016.openplatform.application.platform.PlatformSettings;
import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;

@Getter
@Setter
@org.springframework.validation.annotation.Validated
@ConfigurationProperties("open-platform")
public class PlatformProperties implements PlatformSettings {
    private String name = "CYL · 开放平台";
    private String adminLoginUrl = "";
    private String gatewayBaseUrl = "";
    public String getGatewayBaseUrl() { return gatewayBaseUrl == null ? "" : gatewayBaseUrl.strip().replaceAll("/+$", ""); }
    @jakarta.validation.constraints.AssertTrue(message = "网关对外地址必须是无账号、query和fragment的HTTP(S)地址，可包含contextPath")
    public boolean isGatewayBaseUrlValid() {
        if (gatewayBaseUrl == null || gatewayBaseUrl.isBlank()) return true;
        try {
            java.net.URI uri = java.net.URI.create(getGatewayBaseUrl());
            return ("http".equalsIgnoreCase(uri.getScheme()) || "https".equalsIgnoreCase(uri.getScheme())) && uri.getHost() != null
                    && uri.getUserInfo() == null && uri.getRawQuery() == null && uri.getRawFragment() == null
                    && uri.getPort() != 0 && uri.getPort() <= 65535;
        } catch (IllegalArgumentException invalid) { return false; }
    }
}
