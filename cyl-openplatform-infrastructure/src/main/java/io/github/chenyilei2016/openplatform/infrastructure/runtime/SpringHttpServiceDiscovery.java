package io.github.chenyilei2016.openplatform.infrastructure.runtime;

import io.github.chenyilei2016.openplatform.domain.catalog.ApiBinding;
import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.github.chenyilei2016.openplatform.domain.runtime.HttpServiceDiscovery;
import java.net.URI;
import java.time.Duration;
import java.time.Instant;
import com.alibaba.cloud.nacos.NacosServiceManager;
import com.alibaba.cloud.nacos.NacosDiscoveryProperties;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.cloud.loadbalancer.support.LoadBalancerClientFactory;
import org.springframework.stereotype.Component;
import reactor.core.publisher.Mono;

/** 使用当前环境已有发现缓存与负载均衡，不创建Feign客户端或独立连接池。 */
@Component
public class SpringHttpServiceDiscovery implements HttpServiceDiscovery {
    private final LoadBalancerClientFactory loadBalancers;
    private final ObjectProvider<NacosServiceManager> nacos;
    private final ObjectProvider<NacosDiscoveryProperties> settings;

    public SpringHttpServiceDiscovery(LoadBalancerClientFactory loadBalancers, ObjectProvider<NacosServiceManager> nacos,
                                      ObjectProvider<NacosDiscoveryProperties> settings) {
        this.loadBalancers = loadBalancers;
        this.nacos = nacos;
        this.settings = settings;
    }

    @Override
    public URI select(String serviceName, Duration timeout) {
        requireServiceName(serviceName);
        return Mono.from(loadBalancers.getInstance(serviceName).choose()).timeout(timeout)
                .map(response -> {
                    if (!response.hasServer()) throw new PlatformException(ErrorCode.DEPENDENCY_UNAVAILABLE, "当前环境没有可用的提供方实例");
                    URI uri = response.getServer().getUri();
                    if (!("http".equals(uri.getScheme()) || "https".equals(uri.getScheme())) || uri.getHost() == null
                            || uri.getRawUserInfo() != null || uri.getRawQuery() != null || uri.getRawFragment() != null
                            || !(uri.getRawPath().isEmpty() || "/".equals(uri.getRawPath())))
                        throw new PlatformException(ErrorCode.DEPENDENCY_UNAVAILABLE, "提供方实例地址不合法");
                    return uri;
                }).switchIfEmpty(Mono.error(new PlatformException(ErrorCode.DEPENDENCY_UNAVAILABLE, "当前环境没有可用的提供方实例"))).block();
    }

    @Override
    public Instances inspect(String serviceName) {
        requireServiceName(serviceName);
        NacosServiceManager manager = nacos.getIfAvailable();
        NacosDiscoveryProperties properties = settings.getIfAvailable();
        if (manager == null || properties == null) throw new PlatformException(ErrorCode.DEPENDENCY_UNAVAILABLE, "当前环境Nacos发现未启用");
        // 单服务、无订阅查询：检查临时名称不创建LB子上下文或持久订阅，失败也不伪装为空列表。
        Integer count = Mono.fromCallable(() -> manager.getNamingService().selectInstances(serviceName, properties.getGroup(), true, false).size())
                .subscribeOn(reactor.core.scheduler.Schedulers.boundedElastic()).timeout(Duration.ofSeconds(3))
                .onErrorMap(failure -> new PlatformException(ErrorCode.DEPENDENCY_UNAVAILABLE, "当前环境实例查询不可用，请稍后重试")).block();
        return new Instances(serviceName, count, Instant.now());
    }

    private static void requireServiceName(String value) {
        if (!ApiBinding.Http.validServiceName(value)) throw new PlatformException(ErrorCode.INVALID_REQUEST, "请填写合法服务名");
    }
}
