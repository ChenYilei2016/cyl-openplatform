package io.github.chenyilei2016.openplatform.infrastructure.properties.gateway;

import io.github.chenyilei2016.openplatform.infrastructure.runtime.GatewayHttpSettings;
import java.time.Duration;
import lombok.Getter;
import lombok.Setter;
import org.springframework.beans.factory.InitializingBean;
import org.springframework.boot.context.properties.ConfigurationProperties;

/** HTTP连接池、并发与载荷资源限制。目标由API绑定决定。 */
@Getter
@Setter
@ConfigurationProperties("open-platform.gateway.http")
public class GatewayHttpProperties implements GatewayHttpSettings, InitializingBean {
    private int maxConnections = 128;
    private int pendingAcquireMaxCount = 64;
    private Duration connectTimeout = Duration.ofSeconds(2);
    private Duration acquireTimeout = Duration.ofSeconds(1);
    private int maxConcurrentRequests = 128;
    private int maxRequestBytes = 65_536;
    private int maxResponseBytes = 262_144;
    private Duration totalTimeout = Duration.ofSeconds(8);

    @Override
    public void afterPropertiesSet() {
        if (maxConnections < 1 || maxConnections > 10_000 || pendingAcquireMaxCount < 1
                || pendingAcquireMaxCount > 10_000 || maxConcurrentRequests < 1 || maxConcurrentRequests > 10_000
                || maxRequestBytes < 1 || maxRequestBytes > 262_144
                || maxResponseBytes < 1 || maxResponseBytes > 262_144
                || !validTimeout(connectTimeout) || !validTimeout(acquireTimeout) || !validTimeout(totalTimeout)) {
            throw new IllegalArgumentException("网关HTTP资源配置超出支持范围");
        }
    }

    private static boolean validTimeout(Duration timeout) {
        return timeout != null && timeout.toMillis() >= 1 && timeout.compareTo(Duration.ofSeconds(30)) <= 0;
    }
}
