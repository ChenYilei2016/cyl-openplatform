package io.github.chenyilei2016.openplatform.infrastructure.runtime;

import java.time.Duration;

/** Dubbo 客户端使用的只读资源限制。 */
public interface GatewayDubboSettings {
    Duration getConnectTimeout();
    Duration getTotalTimeout();
    int getMaxConcurrentRequests();
    int getMaxRequestBytes();
    int getMaxResponseBytes();
    int getMaxPayloadBytes();
}
