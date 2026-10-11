package io.github.chenyilei2016.openplatform.infrastructure.runtime;

import java.time.Duration;

/** HTTP 客户端使用的只读资源限制。 */
public interface GatewayHttpSettings {
    int getMaxConnections();
    int getPendingAcquireMaxCount();
    Duration getConnectTimeout();
    Duration getAcquireTimeout();
    int getMaxConcurrentRequests();
    int getMaxRequestBytes();
    int getMaxResponseBytes();
    Duration getTotalTimeout();
}
