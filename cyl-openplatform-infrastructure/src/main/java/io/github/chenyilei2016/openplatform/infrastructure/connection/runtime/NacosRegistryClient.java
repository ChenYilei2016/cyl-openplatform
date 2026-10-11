package io.github.chenyilei2016.openplatform.infrastructure.connection.runtime;

import io.github.chenyilei2016.openplatform.domain.connection.DubboConnectionConfig.Registry;
import io.github.chenyilei2016.openplatform.domain.connection.DubboConnectionRuntime.CheckStatus;
import io.github.chenyilei2016.openplatform.infrastructure.connection.DubboConnectionSettings.Credential;
import java.net.URI;
import java.time.Duration;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;
import org.springframework.http.client.reactive.ReactorClientHttpConnector;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.reactive.function.client.WebClientResponseException;
import reactor.netty.http.client.HttpClient;
import reactor.netty.resources.ConnectionProvider;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** 固定修订的只读注册中心客户端；不创建NamingService、Dubbo模型或元数据客户端。 */
final class NacosRegistryClient implements AutoCloseable {
    record Access(CheckStatus status, String summary) {}
    private final Registry registry;
    private final Duration timeout;
    private final JsonMapper json;
    private final WebClient http;
    private final ConnectionProvider pool;

    NacosRegistryClient(Registry registry, Credential credential, Duration timeout, JsonMapper json) {
        this.registry = registry;
        this.timeout = timeout;
        this.json = json;
        URI address = URI.create(registry.address());
        pool = ConnectionProvider.builder("dubbo-registry-check").maxConnections(2).pendingAcquireMaxCount(2)
                .pendingAcquireTimeout(timeout).maxIdleTime(Duration.ofSeconds(30)).evictInBackground(Duration.ofSeconds(30)).build();
        WebClient.Builder client = WebClient.builder().baseUrl("http://" + address.getRawAuthority() + "/nacos")
                .clientConnector(new ReactorClientHttpConnector(HttpClient.create(pool).responseTimeout(timeout)))
                .codecs(codecs -> codecs.defaultCodecs().maxInMemorySize(65_536));
        if (credential.username() != null) client.defaultHeader("username", credential.username());
        if (credential.password() != null) client.defaultHeader("password", credential.password());
        http = client.build();
    }

    Access check() {
        // 沿用已验证的Nacos分页端点，只读1项窗口及分组事实，不解析接口/方法/实例。
        String groupPattern = "(?<=^" + Pattern.quote(registry.group()) + "\\x40\\x40).*";
        try {
            String body = http.get().uri(builder -> builder.path("/v1/ns/catalog/services")
                    .queryParam("namespaceId", "{namespace}").queryParam("groupNameParam", "{group}")
                    .queryParam("groupName", "{group}")
                    .queryParam("serviceNameParam", "{pattern}").queryParam("pageNo", 1).queryParam("pageSize", 1)
                    .queryParam("withInstances", false).queryParam("hasIpCount", false)
                    .build(Map.of("namespace", registry.namespace(), "group", registry.group(), "pattern", groupPattern)))
                    .retrieve().bodyToMono(String.class).block(timeout);
            JsonNode root = json.readTree(body);
            JsonNode rows = root.path("serviceList");
            if (!rows.isArray() || rows.size() > 1 || !root.path("count").isIntegralNumber() || root.path("count").asLong() < 0)
                return new Access(CheckStatus.FAILED, "注册中心响应不符合只读协议，请核对Nacos地址及版本");
            for (JsonNode row : rows) if (!registry.group().equals(row.path("groupName").asText()))
                return new Access(CheckStatus.FAILED, "注册中心未按已保存分组返回只读窗口");
            return new Access(CheckStatus.PASSED, "注册中心可访问；账号可读取所配置namespace/group的有界窗口，未检查业务接口或实例");
        } catch (WebClientResponseException failure) {
            int status = failure.getStatusCode().value();
            if (status == 401) return new Access(CheckStatus.FAILED, "注册中心认证失败，请检查中心账号引用");
            if (status == 403) return forbidden(failure.getResponseBodyAsString());
            return new Access(CheckStatus.UNAVAILABLE, "注册中心接口暂不可用（HTTP " + status + "）");
        } catch (RuntimeException failure) {
            return new Access(CheckStatus.UNAVAILABLE, "注册中心读取失败或超时，请检查网络后重试");
        }
    }

    private Access forbidden(String body) {
        String reason = body.strip();
        try {
            JsonNode message = json.readTree(body).path("message");
            if (message.isString()) reason = message.asText().strip();
        } catch (RuntimeException ignored) { /* Nacos也会返回纯文本认证原因，只识别固定协议文字。 */ }
        return switch (reason.toLowerCase(Locale.ROOT)) {
            case "unknown user!", "user not found!" -> new Access(CheckStatus.FAILED, "注册中心认证失败，请检查中心账号引用（HTTP 403）");
            case "authorization failed!" -> new Access(CheckStatus.FAILED, "中心账号读取权限被拒绝，请核对所配置namespace/group权限（HTTP 403）");
            default -> new Access(CheckStatus.FAILED, "中心账号认证或读取权限被拒绝，请核对账号与namespace/group权限（HTTP 403）");
        };
    }

    @Override public void close() { pool.dispose(); }
}
