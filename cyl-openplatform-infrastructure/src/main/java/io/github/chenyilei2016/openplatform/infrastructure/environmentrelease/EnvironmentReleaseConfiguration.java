package io.github.chenyilei2016.openplatform.infrastructure.environmentrelease;

import io.netty.channel.ChannelOption;
import java.time.Duration;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.reactive.ReactorClientHttpConnector;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.netty.http.client.HttpClient;
import reactor.netty.resources.ConnectionProvider;

/** 专用有界连接池随Spring关闭；机器凭据仅在单次请求中发往固定节点。 */
@Configuration(proxyBeanMethods = false)
public class EnvironmentReleaseConfiguration {
    @Bean(destroyMethod = "dispose")
    public ConnectionProvider environmentReleaseConnections() {
        return ConnectionProvider.builder("open-platform-environment-release")
                .maxConnections(4).pendingAcquireMaxCount(8).pendingAcquireTimeout(Duration.ofSeconds(1))
                .maxIdleTime(Duration.ofSeconds(30)).maxLifeTime(Duration.ofMinutes(10)).build();
    }

    @Bean
    public WebClient environmentReleaseHttpClient(@Qualifier("environmentReleaseConnections") ConnectionProvider connections) {
        var http = HttpClient.create(connections).option(ChannelOption.CONNECT_TIMEOUT_MILLIS, 2000)
                .followRedirect(false).disableRetry(true);
        return WebClient.builder().clientConnector(new ReactorClientHttpConnector(http))
                .codecs(codecs -> codecs.defaultCodecs().maxInMemorySize(1_048_576)).build();
    }
}
