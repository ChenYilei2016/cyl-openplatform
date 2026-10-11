package io.github.chenyilei2016.openplatform.domain.runtime;

import java.net.URI;
import java.time.Duration;
import java.time.Instant;

/** 当前环境的宿主发现与负载均衡；共享客户端生命周期由宿主负责。 */
public interface HttpServiceDiscovery {
    URI select(String serviceName, Duration timeout);
    Instances inspect(String serviceName);
    record Instances(String serviceName, int instanceCount, Instant checkedAt) {}
}
