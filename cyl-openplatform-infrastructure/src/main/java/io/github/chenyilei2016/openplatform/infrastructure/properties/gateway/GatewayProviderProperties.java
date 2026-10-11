package io.github.chenyilei2016.openplatform.infrastructure.properties.gateway;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;

/** 环境级网关证明配置；不生成包含私钥的toString。缺失在签名器装配时失败。 */
@Getter
@Setter
@ConfigurationProperties("open-platform.gateway.provider")
public class GatewayProviderProperties {
    private String keyId;
    private String privateKey;
}
