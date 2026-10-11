package io.github.chenyilei2016.openplatform.runtime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import io.github.chenyilei2016.openplatform.domain.catalog.ApiBinding;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiProtocol;
import io.github.chenyilei2016.openplatform.domain.catalog.SchemaNode;
import io.github.chenyilei2016.openplatform.domain.catalog.SchemaType;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiDefinition;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiLifecycle;
import io.github.chenyilei2016.openplatform.domain.catalog.ParameterMapping;
import io.github.chenyilei2016.openplatform.application.runtime.RequestPreparation;
import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.github.chenyilei2016.openplatform.domain.runtime.HttpApiInvoker;
import io.github.chenyilei2016.openplatform.domain.runtime.HttpParameters;
import io.github.chenyilei2016.openplatform.domain.runtime.InvocationContext;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/** 真实HTTP边界验证：资源保护、目标资格、凭据及编码，不替代跨进程订单验收。 */
@io.github.chenyilei2016.openplatform.testing.TestAdministrators
@SpringBootTest
class GatewayHttpTransportTest {
    private static final InvocationContext CONTEXT = new InvocationContext("app-id", "app-key", "tenant101",
            null, null, null, List.of("orders.read"));
    private static final java.util.concurrent.ExecutorService SERVER_THREADS = Executors.newFixedThreadPool(4);
    private static final HttpServer SERVER;
    private static final AtomicReference<String> QUERY = new AtomicReference<>();
    private static final AtomicReference<String> BODY = new AtomicReference<>();
    private static final AtomicReference<String> RAW_PATH = new AtomicReference<>();
    private static final AtomicReference<String> TRACE_PARENT = new AtomicReference<>();
    private static final AtomicReference<String> TRACE_STATE = new AtomicReference<>();
    private static final AtomicReference<String> AUTH = new AtomicReference<>();
    private static final AtomicInteger REDIRECT_HITS = new AtomicInteger();
    private static final CountDownLatch SLOW_STARTED = new CountDownLatch(1);

    static {
        try {
            SERVER = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            SERVER.setExecutor(SERVER_THREADS);
            SERVER.createContext("/", exchange -> {
                String path = exchange.getRequestURI().getPath();
                QUERY.set(exchange.getRequestURI().getRawQuery());
                RAW_PATH.set(exchange.getRequestURI().getRawPath());
                BODY.set(new String(exchange.getRequestBody().readAllBytes(), java.nio.charset.StandardCharsets.UTF_8));
                TRACE_PARENT.set(exchange.getRequestHeaders().getFirst("traceparent"));
                TRACE_STATE.set(exchange.getRequestHeaders().getFirst("tracestate"));
                AUTH.set(io.github.chenyilei2016.openplatform.testing.ProviderProofTestSupport.verifier().authenticate(
                        name -> exchange.getRequestHeaders().getFirst(name),
                        io.github.chenyilei2016.openplatform.provider.OpenPlatformTarget.http(java.net.URI.create(origin() + exchange.getRequestURI()), exchange.getRequestMethod())).getTenantId());
                byte[] body = "{\"ok\":true}".getBytes(java.nio.charset.StandardCharsets.UTF_8);
                int status = 200;
                if (path.equals("/slow")) {
                    SLOW_STARTED.countDown();
                    try {
                        Thread.sleep(3000);
                    } catch (InterruptedException interrupted) {
                        Thread.currentThread().interrupt();
                    }
                } else if (path.equals("/large")) {
                    body = ("{\"data\":\"" + "x".repeat(2000) + "\"}").getBytes(java.nio.charset.StandardCharsets.UTF_8);
                } else if (path.equals("/redirect")) {
                    status = 302;
                    exchange.getResponseHeaders().add("Location", "/redirect-target");
                } else if (path.equals("/redirect-target")) {
                    REDIRECT_HITS.incrementAndGet();
                } else if (path.startsWith("/status/")) {
                    status = Integer.parseInt(path.substring("/status/".length()));
                    body = "secret internal failure details".getBytes(java.nio.charset.StandardCharsets.UTF_8);
                } else if (path.equals("/null")) {
                    body = "null".getBytes(java.nio.charset.StandardCharsets.UTF_8);
                } else if (path.equals("/trailing")) {
                    body = "{} {}".getBytes(java.nio.charset.StandardCharsets.UTF_8);
                } else if (path.equals("/invalid")) {
                    body = "{\"key\":1,\"key\":2}".getBytes(java.nio.charset.StandardCharsets.UTF_8);
                }
                exchange.getResponseHeaders().add("Content-Type", "application/json");
                try (exchange) {
                    exchange.sendResponseHeaders(status, body.length);
                    exchange.getResponseBody().write(body);
                } catch (IOException closedAfterTimeout) {
                    // 客户端总超时主动关闭连接；服务器工作线程仍按生命周期退出。
                }
            });
            SERVER.start();
        } catch (IOException failure) {
            throw new ExceptionInInitializerError(failure);
        }
    }

    @DynamicPropertySource
    static void httpProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.cloud.discovery.client.simple.instances.order-http[0].uri", GatewayHttpTransportTest::origin);
        registry.add("open-platform.gateway.http.max-concurrent-requests", () -> 1);
        registry.add("open-platform.gateway.http.max-response-bytes", () -> 1024);
        // 非超时检查留出首次Netty初始化余量；slow明确超过总期限，避免全量运行时400ms冷启动误判。
        registry.add("open-platform.gateway.http.total-timeout", () -> "2s");
    }

    @Autowired
    private HttpApiInvoker invoker;

    @Test
    void serviceDiscoveryUsesHostBalancerAndPreservesEncodedProofTarget() {
        ApiBinding binding = new ApiBinding(ApiProtocol.HTTP, 3000,
                new ApiBinding.Http("http://not-used.invalid", "POST", ApiBinding.HttpTargetMode.SERVICE_NAME,
                        "order-http", "/orders/{id}", "com.example.OrderFeignClient", "lookup"), null);
        assertThat(invoker.invoke(binding, new HttpParameters(Map.of("id", "中文 +%"), Map.of("id", "query"), Map.of("id", "body")), CONTEXT, "service-proof"))
                .isEqualTo(Map.of("ok", true));
        assertThat(RAW_PATH.get()).isEqualTo("/orders/%E4%B8%AD%E6%96%87%20%2B%25");
        assertThat(QUERY.get()).isEqualTo("id=query");
        assertThat(BODY.get()).isEqualTo("{\"id\":\"body\"}");
        assertThat(AUTH.get()).isEqualTo("tenant101");
    }

    @Test
    void missingServiceIsNotSentAndContractMetadataCannotChangeRouting() {
        ApiBinding binding = new ApiBinding(ApiProtocol.HTTP, 3000,
                new ApiBinding.Http(null, "GET", ApiBinding.HttpTargetMode.SERVICE_NAME, "missing-service", "/orders", null, null), null);
        assertThatThrownBy(() -> invoker.invoke(binding, new HttpParameters(Map.of(), Map.of(), Map.of()), CONTEXT, "missing-service"))
                .isInstanceOf(io.github.chenyilei2016.openplatform.domain.runtime.ProviderCallFailure.class)
                .satisfies(failure -> {
                    io.github.chenyilei2016.openplatform.domain.runtime.ProviderCallFailure rejected = (io.github.chenyilei2016.openplatform.domain.runtime.ProviderCallFailure) failure;
                    assertThat(rejected.getErrorCode()).isEqualTo(ErrorCode.DEPENDENCY_UNAVAILABLE);
                    assertThat(rejected.dispatch()).isEqualTo(io.github.chenyilei2016.openplatform.domain.runtime.InvocationDiagnostics.Dispatch.NOT_SENT);
                });
        assertThat(invoker.invoke(new ApiBinding(ApiProtocol.HTTP, 3000, new ApiBinding.Http(origin() + "/", "GET",
                ApiBinding.HttpTargetMode.URL, "missing-service", "/unused", null, null), null), new HttpParameters(Map.of(), Map.of(), Map.of()), CONTEXT, "url-unchanged"))
                .isEqualTo(Map.of("ok", true));
    }

    @AfterAll
    static void closeServer() {
        SERVER.stop(0);
        SERVER_THREADS.shutdownNow();
    }

    @Test
    void propagatesW3cContextToTheRealHttpProvider() {
        io.opentelemetry.context.Context trace = io.opentelemetry.context.Context.root().with(io.opentelemetry.api.trace.Span.wrap(
                io.opentelemetry.api.trace.SpanContext.create("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "0123456789abcdef", io.opentelemetry.api.trace.TraceFlags.getSampled(),
                        io.opentelemetry.api.trace.TraceState.builder().put("arms", "regression").build())));
        try (io.opentelemetry.context.Scope ignored = trace.makeCurrent()) { call("/"); }
        assertThat(TRACE_PARENT.get()).isEqualTo("00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-0123456789abcdef-01");
        assertThat(TRACE_STATE.get()).isEqualTo("arms=regression");
    }

    @Test
    void encodesQueryOnceAndSendsEnvironmentProof() {
        Object result = legacyCall(binding("/?fixed=a%20b", "GET"), Map.of("name", "a+b %中&"));
        assertThat(result).isEqualTo(Map.of("ok", true));
        assertThat(QUERY.get()).isEqualTo("fixed=a%20b&name=a%2Bb%20%25%E4%B8%AD%26");
        assertThat(AUTH.get()).isEqualTo("tenant101");
        assertFailure(ErrorCode.DOWNSTREAM_FAILED, () -> legacyCall(
                binding("/?%6Eame=fixed", "GET"), Map.of("name", "value")));
    }

    @Test
    void keepsFixedQuerySeparateFromJsonBodyForPostPutAndPatch() {
        for (String method : List.of("POST", "PUT", "PATCH")) {
            assertThat(legacyCall(binding("/?name=fixed", method), Map.of("name", "body-value")))
                    .isEqualTo(Map.of("ok", true));
            assertThat(QUERY.get()).isEqualTo("name=fixed");
            assertThat(BODY.get()).isEqualTo("{\"name\":\"body-value\"}");
            assertThat(AUTH.get()).isEqualTo("tenant101");
        }
    }

    @Test
    void stillRejectsCollisionsWithinQueryForGetAndDelete() {
        for (String method : List.of("GET", "DELETE")) {
            assertFailure(ErrorCode.DOWNSTREAM_FAILED, () -> legacyCall(
                    binding("/?%6Eame=fixed", method), Map.of("name", "dynamic")));
        }
    }

    @Test
    void supportsPlainPathTemplatesAndPreservesEncodedLiteralPaths() {
        binding("/orders/{id}", "GET").validate();
        legacyCall(binding("/orders/%7Bid%7D", "GET"), Map.of("id", "a+b %中&"));
        assertThat(RAW_PATH.get()).isEqualTo("/orders/%7Bid%7D");
        assertThat(QUERY.get()).isEqualTo("id=a%2Bb%20%25%E4%B8%AD%26");
        assertThat(AUTH.get()).isEqualTo("tenant101");
    }

    @Test
    void resolvesRepeatedPathVariablesBeforeProofAndKeepsSameNameInAllThreeLocations() {
        String id = "中文 a+b %~";
        for (String method : List.of("POST", "PUT", "PATCH")) {
            HttpParameters parameters = new HttpParameters(Map.of("id", id), Map.of("id", "query+%中"), Map.of("id", "body-value"));
            assertThat(invoker.invoke(binding("/orders/{id}/copies/{id}?fixed=a%20b", method), parameters, CONTEXT, "request-path"))
                    .isEqualTo(Map.of("ok", true));
            String segment = "%E4%B8%AD%E6%96%87%20a%2Bb%20%25~";
            assertThat(RAW_PATH.get()).isEqualTo("/orders/" + segment + "/copies/" + segment);
            assertThat(QUERY.get()).isEqualTo("fixed=a%20b&id=query%2B%25%E4%B8%AD");
            assertThat(BODY.get()).isEqualTo("{\"id\":\"body-value\"}");
            assertThat(AUTH.get()).isEqualTo("tenant101");
        }
        invoker.invoke(binding("/orders/{id}", "GET"), new HttpParameters(Map.of("id", id), Map.of("id", "query"), Map.of()), CONTEXT, "request-path-get");
        assertThat(BODY.get()).isEmpty();
        assertThat(AUTH.get()).isEqualTo("tenant101");
    }

    @Test
    void rejectsUnsafeOrMissingPathValuesAndUnsupportedTemplateLocationsBeforeSending() {
        for (String value : List.of("", ".", "..", "a/b", "a\\b"))
            assertFailure(ErrorCode.INVALID_REQUEST, () -> invoker.invoke(binding("/orders/{id}", "GET"),
                    new HttpParameters(Map.of("id", value), Map.of(), Map.of()), CONTEXT, "request-path-invalid"));
        assertFailure(ErrorCode.INVALID_REQUEST, () -> invoker.invoke(binding("/orders/{id}", "GET"),
                new HttpParameters(Map.of(), Map.of(), Map.of()), CONTEXT, "request-path-missing"));
        for (String path : List.of("/orders/{id:[0-9]+}", "/orders/{+id}", "/orders?value={id}"))
            assertFailure(ErrorCode.INVALID_REQUEST, () -> binding(path, "GET").validate());
        ApiBinding host = new ApiBinding(ApiProtocol.HTTP, 1000, new ApiBinding.Http("http://{host}/orders", "GET"), null);
        assertFailure(ErrorCode.INVALID_REQUEST, host::validate);
        assertFailure(ErrorCode.INVALID_REQUEST, () -> invoker.invoke(binding("/orders", "GET"),
                new HttpParameters(Map.of(), Map.of(), Map.of("id", "body")), CONTEXT, "request-get-body"));
    }

    @Test
    void preparesSameNameIndependentlyAndLocatesMissingPathBeforeHttp() {
        List<ParameterMapping> mappings = List.of(
                new ParameterMapping("id", ParameterMapping.Source.REQUEST, "pathId", null, ParameterMapping.Location.PATH),
                new ParameterMapping("id", ParameterMapping.Source.REQUEST, "queryId", null, ParameterMapping.Location.QUERY),
                new ParameterMapping("id", ParameterMapping.Source.REQUEST, "bodyId", null, ParameterMapping.Location.BODY));
        ApiDefinition definition = httpDefinition("POST", mappings);
        definition.validate();
        HttpParameters prepared = RequestPreparation.prepare(definition, CONTEXT,
                Map.of("pathId", "path", "queryId", "query", "bodyId", "body")).httpParameters();
        assertThat(prepared.path()).containsEntry("id", "path");
        assertThat(prepared.query()).containsEntry("id", "query");
        assertThat(prepared.body()).containsEntry("id", "body");
        assertThatThrownBy(() -> RequestPreparation.prepare(definition, CONTEXT, Map.of("queryId", "query", "bodyId", "body")))
                .isInstanceOfSatisfying(RequestPreparation.InvalidInput.class,
                        failure -> assertThat(failure.issues().getFirst().path()).isEqualTo("/mappings/0/path"));
        assertFailure(ErrorCode.INVALID_REQUEST, () -> httpDefinition("GET", mappings).validate());
        List<ParameterMapping> duplicate = new java.util.ArrayList<>(mappings);
        duplicate.add(new ParameterMapping("id", ParameterMapping.Source.FIXED, null, "another", ParameterMapping.Location.QUERY));
        assertFailure(ErrorCode.INVALID_REQUEST, () -> httpDefinition("POST", duplicate).validate());
    }

    @Test
    void rejectsMismatchedBindingAndOversizedEncodedPathBeforeProofOrSend() {
        ApiDefinition http = httpDefinition("POST", List.of(new ParameterMapping("id", ParameterMapping.Source.REQUEST, "pathId", null, ParameterMapping.Location.PATH)));
        assertFailure(ErrorCode.INVALID_REQUEST, () -> RequestPreparation.prepare(http, CONTEXT, Map.of("pathId", "中".repeat(1000))));
        ApiBinding dubbo = new ApiBinding(ApiProtocol.DUBBO, 1000, null,
                new ApiBinding.Dubbo("com.example.Service", "method", null, null, List.of(), null, null, null));
        ApiDefinition mismatch = new ApiDefinition(http.id(), http.service(), http.version(), http.method(), http.name(), http.category(), http.owner(), ApiProtocol.HTTP,
                1, List.of(), http.requestSchema(), http.responseSchema(), List.of(), dubbo, List.of(), ApiLifecycle.DEFAULT, null, false, null, null, null, null);
        assertFailure(ErrorCode.INVALID_REQUEST, mismatch::validate);
    }

    private ApiDefinition httpDefinition(String method, List<ParameterMapping> mappings) {
        SchemaNode scalar = new SchemaNode(SchemaType.STRING, null, false, null, null, null, null, null, false);
        SchemaNode input = new SchemaNode(SchemaType.OBJECT, null, true, Map.of("pathId", scalar, "queryId", scalar, "bodyId", scalar), null, null, null, null, false);
        return new ApiDefinition("api-http-path", "orders", "v1", "lookup", "路径查询", "订单", "维护者", ApiProtocol.HTTP,
                1, List.of(), input, scalar, List.of(), binding("/orders/{id}", method), mappings, ApiLifecycle.DEFAULT, null, false, null, null, null, null);
    }

    @Test
    void rejectsUnavailableTargetsRedirectsOversizedAndInvalidJsonWithoutLeakingBody() {
        ApiBinding denied = new ApiBinding(ApiProtocol.HTTP, 1000, new ApiBinding.Http("http://127.0.0.1:1/", "POST"), null);
        assertFailure(ErrorCode.DOWNSTREAM_FAILED, () -> legacyCall(denied, Map.of()));
        for (String path : List.of("/redirect", "/large", "/invalid", "/trailing")) {
            assertFailure(ErrorCode.DOWNSTREAM_FAILED, () -> call(path));
        }
        assertThatThrownBy(() -> call("/large"))
                .isInstanceOfSatisfying(io.github.chenyilei2016.openplatform.domain.runtime.ResponseAdaptation.Failure.class,
                        failure -> assertThat(failure.issue().reason()).isEqualTo(io.github.chenyilei2016.openplatform.domain.runtime.ResponseAdaptation.Reason.LIMIT_EXCEEDED));
        assertThat(REDIRECT_HITS.get()).isZero();
        assertThat(call("/")).isEqualTo(Map.of("ok", true));
        assertThat(call("/null")).isNull();
    }

    @Test
    void translatesProviderStatusesWithoutResponseDetails() {
        Map<Integer, ErrorCode> expected = Map.of(403, ErrorCode.FORBIDDEN, 404, ErrorCode.NOT_FOUND,
                429, ErrorCode.RATE_LIMITED, 408, ErrorCode.DOWNSTREAM_TIMEOUT,
                504, ErrorCode.DOWNSTREAM_TIMEOUT, 500, ErrorCode.DOWNSTREAM_FAILED);
        expected.forEach((status, error) -> assertFailure(error, () -> call("/status/" + status)));
    }

    @Test
    void limitsConcurrentCallsAndReleasesPermitAfterTotalTimeout() throws Exception {
        try (var clientThread = Executors.newSingleThreadExecutor()) {
            var slow = clientThread.submit(() -> {
                assertFailure(ErrorCode.DOWNSTREAM_TIMEOUT, () -> call("/slow"));
            });
            assertThat(SLOW_STARTED.await(2, TimeUnit.SECONDS)).isTrue();
            assertFailure(ErrorCode.RATE_LIMITED, () -> call("/"));
            slow.get(4, TimeUnit.SECONDS);
            assertThat(call("/")).isEqualTo(Map.of("ok", true));
        }
    }

    @Test
    void defaultsOnlyMissingFieldsAndLeavesSnapshotUnmodified() {
        SchemaNode label = new SchemaNode(SchemaType.STRING, null, false, null, null, null, "default", null, false);
        SchemaNode nested = new SchemaNode(SchemaType.OBJECT, null, false, Map.of("label", label), null, null, null, null, false);
        SchemaNode schema = new SchemaNode(SchemaType.OBJECT, null, true,
                Map.of("label", label, "nested", nested), null, null, null, null, false);
        assertThat(schema.applyDefaults(Map.of())).isEqualTo(Map.of("label", "default"));
        assertThat(schema.applyDefaults(Map.of("nested", Map.of())))
                .isEqualTo(Map.of("label", "default", "nested", Map.of("label", "default")));
        Map<String, Object> explicitNull = new LinkedHashMap<>();
        explicitNull.put("label", null);
        Object normalized = schema.applyDefaults(explicitNull);
        assertThat(normalized).isEqualTo(explicitNull);
        assertFailure(ErrorCode.INVALID_REQUEST, () -> schema.validateValue(normalized, true));
        assertThat(label.defaultValue()).isEqualTo("default");
    }

    @Test
    void boundsMappedJsonDuringSerializationAndReleasesTheConcurrencyPermit() {
        Map<String, Object> mapped = new LinkedHashMap<>();
        String sharedDefault = "x".repeat(10_000);
        for (int index = 0; index < 100; index++) {
            mapped.put("value" + index, sharedDefault);
        }
        for (String method : List.of("POST", "GET")) {
            assertThatThrownBy(() -> legacyCall(binding("/", method), mapped))
                    .isInstanceOfSatisfying(io.github.chenyilei2016.openplatform.domain.runtime.ProviderCallFailure.class, failure -> {
                        assertThat(failure.getErrorCode()).isEqualTo(ErrorCode.REQUEST_TOO_LARGE);
                        assertThat(failure.dispatch()).isEqualTo(io.github.chenyilei2016.openplatform.domain.runtime.InvocationDiagnostics.Dispatch.NOT_SENT);
                    });
            assertThat(call("/")).isEqualTo(Map.of("ok", true));
        }
    }

    private Object legacyCall(ApiBinding binding, Map<String, Object> parameters) {
        HttpParameters prepared = binding.http().hasJsonBody()
                ? new HttpParameters(Map.of(), Map.of(), parameters) : new HttpParameters(Map.of(), parameters, Map.of());
        return invoker.invoke(binding, prepared, CONTEXT, "request-test");
    }

    private Object call(String path) {
        return legacyCall(binding(path, "POST"), Map.of());
    }

    private static ApiBinding binding(String path, String method) {
        return new ApiBinding(ApiProtocol.HTTP, 3000, new ApiBinding.Http(origin() + path, method), null);
    }

    private static String origin() {
        return "http://127.0.0.1:" + SERVER.getAddress().getPort();
    }

    private static void assertFailure(ErrorCode expected, org.assertj.core.api.ThrowableAssert.ThrowingCallable action) {
        assertThatThrownBy(action).isInstanceOfSatisfying(PlatformException.class, failure -> {
            assertThat(failure.getErrorCode()).isEqualTo(expected);
            assertThat(failure.getMessage()).doesNotContain("secret", "http://", "127.0.0.1");
        });
    }
}
