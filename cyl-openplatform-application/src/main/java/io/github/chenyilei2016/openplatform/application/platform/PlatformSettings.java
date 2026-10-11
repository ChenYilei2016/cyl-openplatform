package io.github.chenyilei2016.openplatform.application.platform;

/** 平台展示与登录入口配置契约；绑定实现由 infrastructure.properties 提供。 */
public interface PlatformSettings {
    String getName();
    String getGatewayBaseUrl();
    String getAdminLoginUrl();
}
