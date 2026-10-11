package io.github.chenyilei2016.openplatform.infrastructure.runtime;

import io.github.chenyilei2016.openplatform.domain.runtime.GatewayRequestLimits;
import io.netty.channel.ChannelOption;
import java.time.Duration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.reactive.ReactorClientHttpConnector;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.netty.http.client.HttpClient;
import reactor.netty.resources.ConnectionProvider;

/** 复用AAG的受控WebClient模式，连接池显式销毁，不影响其他客户端。 */
@Configuration(proxyBeanMethods = false)
public class GatewayHttpConfiguration {
    @Bean(destroyMethod = "dispose")
    public ConnectionProvider gatewayHttpConnections(GatewayHttpSettings properties) {
        return ConnectionProvider.builder("open-platform-provider")
                .maxConnections(properties.getMaxConnections())
                .pendingAcquireMaxCount(properties.getPendingAcquireMaxCount())
                .pendingAcquireTimeout(properties.getAcquireTimeout())
                .maxIdleTime(Duration.ofSeconds(30))
                .maxLifeTime(Duration.ofMinutes(10))
                .evictInBackground(Duration.ofSeconds(30))
                .disposeInactivePoolsInBackground(Duration.ofSeconds(30), Duration.ofSeconds(30))
                .build();
    }

    @Bean
    public WebClient gatewayHttpClient(@org.springframework.beans.factory.annotation.Qualifier("gatewayHttpConnections") ConnectionProvider gatewayHttpConnections, GatewayHttpSettings properties) {
        HttpClient client = HttpClient.create(gatewayHttpConnections)
                .option(ChannelOption.CONNECT_TIMEOUT_MILLIS, Math.toIntExact(properties.getConnectTimeout().toMillis()))
                .followRedirect(false)
                .disableRetry(true);
        return WebClient.builder()
                .clientConnector(new ReactorClientHttpConnector(client))
                .codecs(codecs -> codecs.defaultCodecs().maxInMemorySize(properties.getMaxResponseBytes()))
                .build();
    }

    @Bean
    public GatewayRequestLimits gatewayRequestLimits(GatewayHttpSettings properties) {
        return new GatewayRequestLimits(properties.getMaxRequestBytes());
    }
}
