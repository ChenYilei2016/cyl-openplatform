package io.github.chenyilei2016.openplatform.domain.sdk;

/** ZIP根清单的人工声明，不含提供方地址或客户身份。 */
public record SdkManifest(String format, String sdkVersion, String language, String gatewayProtocol, String runtime) {}
