package io.github.chenyilei2016.openplatform.environmentrelease;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.github.chenyilei2016.openplatform.domain.catalog.*;
import io.github.chenyilei2016.openplatform.infrastructure.properties.environmentrelease.EnvironmentReleaseProperties;
import java.math.BigDecimal;
import java.util.Map;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.json.JsonMapper;
import io.github.chenyilei2016.openplatform.domain.environmentrelease.EnvironmentReleaseClient;
import io.github.chenyilei2016.openplatform.domain.environmentrelease.EnvironmentReleaseModels.SendRequest;
import io.github.chenyilei2016.openplatform.domain.environmentrelease.ReleaseEnvironment;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/** 通过真实HTTP协议验证出站机器身份、有限资源和未知结果，不代替目标发布验收。 */
@io.github.chenyilei2016.openplatform.testing.TestAdministrators
@SpringBootTest
class EnvironmentReleaseTransportTest {
    private static final JsonMapper JSON = JsonMapper.builder().enable(DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS).build();
    private static final String CREDENTIAL = "transport-test-only-credential-at-least-32";
    private static final String TRANSFER = "578f1109-9a88-4447-b97e-cb98ebd8c9b8";
    private static final AtomicReference<String> MODE = new AtomicReference<>("ok");
    private static final AtomicReference<String> QUERY = new AtomicReference<>();
    private static final AtomicReference<String> AUTH = new AtomicReference<>();
    private static final AtomicReference<String> SOURCE = new AtomicReference<>();
    private static final AtomicInteger REDIRECT_HITS = new AtomicInteger();
    private static final java.util.concurrent.ExecutorService THREADS = Executors.newFixedThreadPool(4);
    private static final HttpServer NODE_A = server("a");
    private static final HttpServer NODE_B = server("b");

    @Autowired private EnvironmentReleaseClient client;
    @Autowired private ReleaseEnvironment environment;

    @DynamicPropertySource
    static void configuration(DynamicPropertyRegistry registry) {
        registry.add("open-platform.environment-release.environment-id", () -> "source");
        registry.add("open-platform.environment-release.node-id", () -> "source-node");
        registry.add("open-platform.environment-release.targets[0].id", () -> "target");
        registry.add("open-platform.environment-release.targets[0].name", () -> "目标环境");
        registry.add("open-platform.environment-release.targets[0].credential", () -> CREDENTIAL);
        registry.add("open-platform.environment-release.targets[0].nodes[0].id", () -> "a");
        registry.add("open-platform.environment-release.targets[0].nodes[0].origin", () -> origin(NODE_A));
        registry.add("open-platform.environment-release.targets[0].nodes[1].id", () -> "b");
        registry.add("open-platform.environment-release.targets[0].nodes[1].origin", () -> origin(NODE_B));
        registry.add("open-platform.environment-release.trusted-sources[0].id", () -> "trusted");
        registry.add("open-platform.environment-release.trusted-sources[0].credential", () -> CREDENTIAL);
    }

    @AfterEach void resetMode() { MODE.set("ok"); }
    @AfterAll static void close() {
        NODE_A.stop(0);
        NODE_B.stop(0);
        THREADS.shutdownNow();
    }

    @Test
    void authenticatesConfiguredSourceAndSendsIndependentMachineCredential() {
        environment.authenticate("trusted", CREDENTIAL);
        assertThatThrownBy(() -> environment.authenticate("missing", CREDENTIAL)).isInstanceOf(PlatformException.class);
        assertThatThrownBy(() -> environment.authenticate("trusted", "wrong")).isInstanceOf(PlatformException.class);
        assertThat(environment.targets().getFirst().nodeIds()).containsExactly("a", "b");
        assertThat(environment.targets().toString()).doesNotContain(CREDENTIAL, "http://");
        var delivered = client.receive("target", request());
        assertThat(delivered.rejected()).isFalse();
        assertThat(delivered.receipt().status().name()).isEqualTo("PENDING");
        assertThat(AUTH.get()).isEqualTo("Bearer " + CREDENTIAL);
        assertThat(SOURCE.get()).isEqualTo("source");
        assertThat(client.observe("target", TRANSFER)).allSatisfy(observation -> {
            assertThat(observation.receipt().nodeId()).isEqualTo(observation.nodeId());
            assertThat(observation.error()).isNull();
        });
    }

    @Test
    void ownerSearchEncodesChineseAndReservedCharactersExactlyOnce() {
        client.owners("target",new io.github.chenyilei2016.openplatform.domain.access.EmployeeProfileQuery("89","E+1","交付负责人+A",1,20));
        assertThat(java.net.URLDecoder.decode(QUERY.get(),StandardCharsets.UTF_8)).contains("name=交付负责人+A","employeeNo=E+1");
        assertThat(QUERY.get()).contains("%2B").doesNotContain("%25E");
    }

    @Test
    void readsBoundedTargetConnectionDirectoryUsingMachineIdentity() {
        var directory = client.connections("target", 1, 20, "订单+A/B &?");
        assertThat(java.net.URLDecoder.decode(QUERY.get(),StandardCharsets.UTF_8)).endsWith("query=订单+A/B &?");
        assertThat(QUERY.get()).contains("%2B").doesNotContain("%25E");
        assertThat(directory.items()).hasSize(1);
        assertThat(directory.items().getFirst().revision()).isEqualTo(3);
        assertThat(AUTH.get()).isEqualTo("Bearer " + CREDENTIAL);
        assertThat(SOURCE.get()).isEqualTo("source");
        MODE.set("wrong-environment");
        assertThatThrownBy(() -> client.connections("target", 1, 20, ""))
                .isInstanceOf(PlatformException.class);
    }

    @Test
    void previewRejectionShowsActionableScopesAndTargetRequestWithoutRemoteSecrets() {
        SchemaNode schema = new SchemaNode(SchemaType.OBJECT, null, true, null, null, null, null, null, false);
        ApiDefinition definition = new ApiDefinition(null, "orders", "v1", "query", "订单", "订单", "owner", ApiProtocol.HTTP, 0,
                java.util.stream.Stream.concat(java.util.stream.Stream.of("orders.read", "orders.write"),
                        java.util.stream.IntStream.range(0, 11).mapToObj(index -> "missing." + index)).toList(), schema, schema, List.of(),
                new ApiBinding(ApiProtocol.HTTP, 1000, new ApiBinding.Http(origin(NODE_A) + "/provider", "POST"), null),
                List.of(), null, null, false, null, ApiOperationKind.QUERY, null, null);
        MODE.set("scope-rejected");
        assertThatThrownBy(() -> client.preview("target", definition))
                .isInstanceOf(PlatformException.class)
                .satisfies(failure -> assertThat(failure.getMessage()).contains("orders.write", "按代码创建", "目标请求号：target-proof", "40000001")
                        .doesNotContain("orders.read"));
        MODE.set("many-scope-rejected");
        assertThatThrownBy(() -> client.preview("target", definition))
                .satisfies(failure -> assertThat(failure.getMessage()).contains("missing.0", "missing.10")
                        .doesNotContain("orders.read", "orders.write"));
        MODE.set("legacy-scope-rejected");
        assertThatThrownBy(() -> client.preview("target", definition))
                .satisfies(failure -> assertThat(failure.getMessage()).contains("本次需要核对", "orders.read", "orders.write", "重新预览")
                        .doesNotContain("以下权限组"));
        MODE.set("private-scope-rejected");
        assertThatThrownBy(() -> client.preview("target", definition))
                .satisfies(failure -> assertThat(failure.getMessage()).contains("本次需要核对")
                        .doesNotContain(CREDENTIAL, "private", "http://"));
        MODE.set("rejected");
        assertThatThrownBy(() -> client.preview("target", definition))
                .satisfies(failure -> assertThat(failure.getMessage()).contains("目标状态发生冲突", "目标请求号：r")
                        .doesNotContain("private"));
    }

    @Test
    void distinguishesAnExplicitProtocolRejectionFromUnknownTransportOutcome() {
        MODE.set("rejected");
        var rejected = client.receive("target", request());
        assertThat(rejected.rejected()).isTrue();
        assertThat(rejected.receipt()).isNull();
        assertThat(rejected.error()).doesNotContain(CREDENTIAL, "private");
        for (String mode : List.of("bad-error", "server-error", "wrong-environment", "wrong-node", "wrong-source", "wrong-transfer")) {
            MODE.set(mode);
            var unknown = client.receive("target", request());
            assertThat(unknown.rejected()).as(mode).isFalse();
            assertThat(unknown.receipt()).as(mode).isNull();
            assertThat(unknown.error()).doesNotContain(CREDENTIAL, "private");
        }
    }

    @Test
    void rejectsRedirectsLargeResponsesAndAmbiguousJsonWithoutFollowingOrLeaking() {
        for (String mode : List.of("redirect", "large", "duplicate", "trailing", "html")) {
            MODE.set(mode);
            var result = client.receive("target", request());
            assertThat(result.receipt()).as(mode).isNull();
            assertThat(result.rejected()).as(mode).isFalse();
            assertThat(result.error()).doesNotContain(CREDENTIAL, "private", "http://");
        }
        assertThat(REDIRECT_HITS.get()).isZero();
    }

    @Test
    void observesOtherNodesWhenOneExceedsTheTotalDeadline() {
        MODE.set("slow-a");
        long started = System.nanoTime();
        var observations = client.observe("target", TRANSFER);
        assertThat(java.time.Duration.ofNanos(System.nanoTime() - started)).isLessThan(java.time.Duration.ofSeconds(7));
        assertThat(observations).hasSize(2);
        assertThat(observations.getFirst().receipt()).isNull();
        assertThat(observations.getFirst().error()).isNotBlank();
        assertThat(observations.getLast().receipt().nodeId()).isEqualTo("b");
    }

    @Test
    void preservesPreciseContractNumbersAndAllowsTheBoundedBeforeAndAfterEnvelope() {
        var text = new SchemaNode(SchemaType.STRING, null, false, null, null, null, null, "x".repeat(9_000), false);
        var number = new SchemaNode(SchemaType.NUMBER, null, false, null, null, null, null,
                new BigDecimal("9007199254740993.1234567890123456789"), false);
        var input = new SchemaNode(SchemaType.OBJECT, null, true, null, null, null, null, null, false);
        Map<String, SchemaNode> fields = new java.util.LinkedHashMap<>();
        for (int index = 0; index < 15; index++) fields.put("field" + index, text);
        fields.put("number", number);
        var output = new SchemaNode(SchemaType.OBJECT, null, true, fields, null, null, null, null, false);
        var definition = new ApiDefinition(null, "orders", "v1", "query", "订单", "订单", "owner", ApiProtocol.HTTP, 0,
                List.of("orders.read"), input, output, List.of(),
                new ApiBinding(ApiProtocol.HTTP, 1000, new ApiBinding.Http(origin(NODE_A) + "/provider", "POST"), null), List.of(), null, null, false, null,
                io.github.chenyilei2016.openplatform.domain.catalog.ApiOperationKind.QUERY, null,
                new io.github.chenyilei2016.openplatform.domain.catalog.McpToolConfig(true, "按订单号查询订单"));
        definition.validate();
        var preview = client.preview("target", definition);
        assertThat(preview.definition()).isEqualTo(definition);
        assertThat(preview.before().id()).isEqualTo("api-target");
        assertThat(preview.definition().responseSchema().properties().get("number").example()).isEqualTo(number.example());
    }

    @Test
    void rejectsUnsafeConfiguredOriginsAndKeepsCredentialsOutOfConfigurationDescriptions() {
        for (String origin : List.of("http://example.com", "https://user:secret@example.com", "https://example.com/path",
                "https://example.com?q=secret", "https://example.com#secret", "https://example.com:0")) {
            var properties = new EnvironmentReleaseProperties();
            var target = new EnvironmentReleaseProperties.RemoteTarget("target", "目标", CREDENTIAL,
                    List.of(new EnvironmentReleaseProperties.Node("a", origin)));
            properties.setTargets(List.of(target));
            assertThat(target.toString()).doesNotContain(CREDENTIAL);
            assertThatThrownBy(properties::afterPropertiesSet).isInstanceOf(IllegalArgumentException.class)
                    .hasMessageNotContaining("secret").hasMessageNotContaining(CREDENTIAL);
        }
    }

    private static SendRequest request() {
        return new SendRequest(TRANSFER, "source", "target", "release-source", "tenant", "employee", 0,
                "0".repeat(64), null, "transport");
    }

    private static HttpServer server(String node) {
        try {
            HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            server.setExecutor(THREADS);
            server.createContext("/", exchange -> {
                QUERY.set(exchange.getRequestURI().getRawQuery());
                AUTH.set(exchange.getRequestHeaders().getFirst("Authorization"));
                SOURCE.set(exchange.getRequestHeaders().getFirst("X-Platform-Source"));
                byte[] incoming = exchange.getRequestBody().readAllBytes();
                String mode = MODE.get();
                if (mode.equals("slow-a") && node.equals("a")) {
                    try { Thread.sleep(6000); } catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); }
                }
                String body = "{\"code\":200,\"resultMsg\":\"success\",\"requestId\":\"r\",\"data\":{" +
                        "\"environmentId\":\"" + (mode.equals("wrong-environment") ? "other" : "target") + "\"," +
                        "\"nodeId\":\"" + (mode.equals("wrong-node") ? "other" : node) + "\"," +
                        "\"sourceEnvironment\":\"" + (mode.equals("wrong-source") ? "other" : "source") + "\"," +
                        "\"transferId\":\"" + (mode.equals("wrong-transfer") ? "other" : TRANSFER) + "\"," +
                        "\"apiId\":\"api-target\",\"releaseId\":\"release-target\",\"draftRevision\":1," +
                        "\"status\":\"PENDING\",\"auditRequired\":true,\"liveReleaseId\":null,\"enabled\":false," +
                        "\"stateVersion\":1,\"observedAt\":\"2026-09-10T00:00:00Z\"}}";
                if (exchange.getRequestURI().getPath().endsWith("/preview")) {
                    Map<?, ?> previewRequest = JSON.readValue(incoming, Map.class);
                    Object definition = previewRequest.get("definition");
                    @SuppressWarnings("unchecked")
                    var before = new java.util.LinkedHashMap<String, Object>((Map<String, Object>) definition);
                    before.put("id", "api-target");
                    before.put("draftRevision", 1);
                    body = JSON.writeValueAsString(Map.of("code", 200, "resultMsg", "success", "requestId", "r", "data",
                            Map.of("environmentId", "target", "nodeId", node, "definition", definition, "before", before,
                                    "change", "UPDATE", "expectedRevision", 1, "changedFields", List.of("responseSchema"),
                                    "previewDigest", "0".repeat(64), "auditRequired", true)));
                }
                if (exchange.getRequestURI().getPath().endsWith("/dubbo-connections")) {
                    body = JSON.writeValueAsString(Map.of("code", 200, "requestId", "r", "resultMsg", "success", "data", Map.of(
                            "environmentId", mode.equals("wrong-environment") ? "other" : "target", "nodeId", node,
                            "items", List.of(Map.of("id", "connection-1", "name", "订单连接", "description", "服务目录", "revision", 3)),
                            "total", 1, "page", 1, "pageSize", 20)));
                }
                if (exchange.getRequestURI().getPath().endsWith("/owners")) {
                    body=JSON.writeValueAsString(Map.of("code",200,"resultMsg","success","requestId","r","data",Map.of("items",List.of(),"total",0,"page",1,"pageSize",20)));
                }
                int status = 200;
                if (mode.endsWith("scope-rejected")) {
                    status = 400;
                    String reason = mode.equals("legacy-scope-rejected") ? "权限组不存在或已停用"
                            : "权限组不存在或已停用：" + (mode.equals("private-scope-rejected") ? "private http://secret " + CREDENTIAL : "orders.write");
                    if (mode.equals("many-scope-rejected")) reason = "权限组不存在或已停用："
                            + String.join("、", java.util.stream.IntStream.range(0, 11).mapToObj(index -> "missing." + index).toList());
                    body = JSON.writeValueAsString(new java.util.LinkedHashMap<>(Map.of("code", 40000001, "resultMsg", reason,
                            "requestId", mode.equals("private-scope-rejected") ? CREDENTIAL : "target-proof")))
                            .replaceFirst("}$", ",\"data\":null}");
                }
                if (mode.equals("rejected")) { status = 409; body = "{\"code\":40900001,\"resultMsg\":\"private details\",\"data\":null,\"requestId\":\"r\"}"; }
                if (mode.equals("bad-error")) { status = 409; body = "private intermediary error"; }
                if (mode.equals("server-error")) { status = 500; body = "private failure after commit"; }
                if (mode.equals("duplicate")) body = body.replace("\"code\":200", "\"code\":200,\"code\":200");
                if (mode.equals("trailing")) body += " {}";
                if (mode.equals("large")) body = "x".repeat(1_048_577);
                if (mode.equals("redirect")) { status = 302; exchange.getResponseHeaders().set("Location", "/followed"); }
                if (exchange.getRequestURI().getPath().equals("/followed")) REDIRECT_HITS.incrementAndGet();
                exchange.getResponseHeaders().set("Content-Type", mode.equals("html") ? "text/html" : "application/json");
                byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
                try (exchange) {
                    exchange.sendResponseHeaders(status, bytes.length);
                    exchange.getResponseBody().write(bytes);
                } catch (IOException closedByClient) { /* 客户端期限/大小取消后连接可以关闭。 */ }
            });
            server.start();
            return server;
        } catch (IOException failure) { throw new ExceptionInInitializerError(failure); }
    }

    private static String origin(HttpServer server) { return "http://127.0.0.1:" + server.getAddress().getPort(); }
}
