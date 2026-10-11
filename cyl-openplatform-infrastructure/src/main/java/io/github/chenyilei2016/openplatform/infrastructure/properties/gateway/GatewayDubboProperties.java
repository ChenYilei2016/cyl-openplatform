package io.github.chenyilei2016.openplatform.infrastructure.properties.gateway;

import io.github.chenyilei2016.openplatform.infrastructure.runtime.GatewayDubboSettings;
import java.time.Duration;
import lombok.Getter;
import lombok.Setter;
import org.springframework.beans.factory.InitializingBean;
import org.springframework.boot.context.properties.ConfigurationProperties;

/** Dubbo调用资源限制；注册中心及目标由固定连接修订与API绑定提供。 */
@Getter
@Setter
@ConfigurationProperties("open-platform.gateway.dubbo")
public class GatewayDubboProperties implements GatewayDubboSettings, InitializingBean {
    private Duration connectTimeout = Duration.ofSeconds(2);
    private Duration totalTimeout = Duration.ofSeconds(8);
    private int maxConcurrentRequests = 128;
    private int maxRequestBytes = 65_536;
    private int maxResponseBytes = 262_144;
    private int maxPayloadBytes = 524_288;

    @Override
    public void afterPropertiesSet() {
        if (connectTimeout == null || connectTimeout.toMillis() < 1 || connectTimeout.toMillis() > 30_000
                || totalTimeout == null || totalTimeout.toMillis() < 1 || totalTimeout.toMillis() > 30_000
                || maxConcurrentRequests < 1 || maxConcurrentRequests > 10_000
                || maxRequestBytes < 1 || maxRequestBytes > 262_144
                || maxResponseBytes < 1 || maxResponseBytes > 262_144
                || maxPayloadBytes < Math.max(maxRequestBytes, maxResponseBytes) || maxPayloadBytes > 1_048_576) {
            throw new IllegalArgumentException("网关Dubbo资源配置超出支持范围");
        }
    }
}
