package io.github.chenyilei2016.openplatform.runtime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import io.github.chenyilei2016.openplatform.domain.catalog.ApiBinding;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiProtocol;
import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.github.chenyilei2016.openplatform.domain.runtime.InvocationContext;
import io.github.chenyilei2016.openplatform.infrastructure.properties.gateway.GatewayDubboProperties;
import io.github.chenyilei2016.openplatform.infrastructure.runtime.GenericDubboApiInvoker;
import java.io.Serializable;
import java.math.BigDecimal;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.apache.dubbo.config.ApplicationConfig;
import org.apache.dubbo.config.ProtocolConfig;
import org.apache.dubbo.config.RegistryConfig;
import org.apache.dubbo.config.ServiceConfig;
import org.apache.dubbo.config.bootstrap.DubboBootstrap;
import org.apache.dubbo.rpc.RpcContext;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.json.JsonMapper;

/** 使用测试专用真实TCP服务验证故障和资源边界；跨进程订单由IT覆盖。 */
class GatewayDubboTransportTest {
    private static final InvocationContext CONTEXT = new InvocationContext("application", "app-key", "101",
            null, null, null, List.of("orders"));
    private static final CountDownLatch SLOW_STARTED = new CountDownLatch(1);

    public interface TransportService {
        Map<String, Object> echo(Map<String, Object> value);
        Payload complex(Payload value);
        long number(long value);
        Map<String, Object> slow(Map<String, Object> value);
        Map<String, Object> large(Map<String, Object> value);
        Map<String, Object> status(Map<String, Object> value);
    }

    public static class Payload implements Serializable {
        private String name;
        private List<Map<String, Object>> items;
        public String getName() { return name; }
        public void setName(String name) { this.name = name; }
        public List<Map<String, Object>> getItems() { return items; }
        public void setItems(List<Map<String, Object>> items) { this.items = items; }
    }

    private static final java.util.concurrent.atomic.AtomicReference<String> TRACE_PARENT = new java.util.concurrent.atomic.AtomicReference<>();
    private static final java.util.concurrent.atomic.AtomicReference<String> TRACE_STATE = new java.util.concurrent.atomic.AtomicReference<>();

    public static class TransportServiceImpl implements TransportService {
        @Override public Map<String, Object> echo(Map<String, Object> value) {
            TRACE_PARENT.set(RpcContext.getServerAttachment().getAttachment("traceparent"));
            TRACE_STATE.set(RpcContext.getServerAttachment().getAttachment("tracestate"));
            return Map.of("input", value, "tenant", RpcContext.getServerAttachment().getAttachment("x-open-platform-tenant-id"),
                    "leaked", java.util.Objects.requireNonNullElse(RpcContext.getServerAttachment().getAttachment("untrusted"), "absent"));
        }
        @Override public Payload complex(Payload value) { return value; }
        @Override public long number(long value) { return value; }
        @Override public Map<String, Object> slow(Map<String, Object> value) {
            SLOW_STARTED.countDown();
            try { Thread.sleep(800); } catch (InterruptedException exception) { Thread.currentThread().interrupt(); }
            return value;
        }
        @Override public Map<String, Object> large(Map<String, Object> value) { return Map.of("text", "x".repeat(2048)); }
        @Override public Map<String, Object> status(Map<String, Object> value) {
            RpcContext.getServerResponseContext().setAttachment("x-open-platform-status", value.get("status").toString());
            if (Boolean.TRUE.equals(value.get("throw"))) throw new IllegalStateException("secret provider detail");
            return null;
        }
    }

    @Test
    void validatesResourceLimitsWithoutConfiguredTargetLists() {
        GatewayDubboProperties properties = new GatewayDubboProperties();
        properties.afterPropertiesSet();
        properties.setMaxConcurrentRequests(0);
        assertThatThrownBy(properties::afterPropertiesSet).isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void invokesTypedDataAndEnforcesTrustTimeoutSizeConcurrencyAndLifecycle() throws Exception {
        DubboBootstrap provider = DubboBootstrap.newInstance();
        ApplicationConfig application = new ApplicationConfig("gateway-dubbo-transport-test");
        application.setQosEnable(false);
        ProtocolConfig protocol = new ProtocolConfig("dubbo", -1);
        protocol.setHost("::1");
        protocol.setSerialization("hessian2");
        protocol.setThreads(4);
        ServiceConfig<TransportService> service = new ServiceConfig<>();
        service.setInterface(TransportService.class);
        service.setRef(new TransportServiceImpl());
        service.setVersion("1.0.0");
        service.setGroup("transport-test");
        provider.application(application).registry(new RegistryConfig("N/A")).protocol(protocol).service(service).start();
        GatewayDubboProperties properties = new GatewayDubboProperties();
        properties.setMaxConcurrentRequests(1);
        properties.setTotalTimeout(Duration.ofMillis(400));
        properties.setMaxRequestBytes(1024);
        properties.setMaxResponseBytes(1024);
        properties.afterPropertiesSet();
        JsonMapper mapper = JsonMapper.builder().enable(DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS).build();
        io.github.chenyilei2016.openplatform.infrastructure.connection.runtime.ManagedDubboConnectionRuntime runtime = org.mockito.Mockito.mock(io.github.chenyilei2016.openplatform.infrastructure.connection.runtime.ManagedDubboConnectionRuntime.class);
        io.github.chenyilei2016.openplatform.testing.DirectDubboTestConnection connection = new io.github.chenyilei2016.openplatform.testing.DirectDubboTestConnection(
                TransportService.class.getName(), "1.0.0", "transport-test", "dubbo://[::1]:" + service.getExportedUrls().getFirst().getPort(), 400);
        connection.install(runtime);
        GenericDubboApiInvoker invoker = null;
        try {
            invoker = new GenericDubboApiInvoker(properties, mapper, runtime, io.github.chenyilei2016.openplatform.testing.ProviderProofTestSupport.gateway());
            GenericDubboApiInvoker client = invoker;
            RpcContext.getServerAttachment().setAttachment("untrusted", "must-not-forward");
            RpcContext.getClientAttachment().setAttachment("caller", "restore-me");
            Map<String, Object> payload = Map.of("items", List.of(Map.of("amount", new BigDecimal("101.25"))));
            assertThat(client.invoke(binding("echo", "java.util.Map"), Map.of("arg0", payload), CONTEXT, "request"))
                    .isEqualTo(Map.of("input", payload, "tenant", "101", "leaked", "absent"));
            assertThat(RpcContext.getClientAttachment().getAttachment("caller")).isEqualTo("restore-me");
            assertThat(RpcContext.getServerAttachment().getAttachment("untrusted")).isEqualTo("must-not-forward");
            Map<String, Object> dto = Map.of("name", "order", "items", List.of(Map.of("amount", new BigDecimal("101.25"))));
            assertThat(client.invoke(binding("complex", Payload.class.getName()), Map.of("arg0", dto), CONTEXT, "request")).isEqualTo(dto);
            assertThat(client.invoke(binding("number", "long"), Map.of("arg0", new BigDecimal("9223372036854775807")), CONTEXT, "request")).isEqualTo(Long.MAX_VALUE);
            failure(ErrorCode.INVALID_REQUEST, () -> client.invoke(binding("number", "long"), Map.of("arg0", new BigDecimal("9223372036854775808")), CONTEXT, "request"));
            failure(ErrorCode.INVALID_REQUEST, () -> client.invoke(binding("number", "long"), Map.of("arg0", new BigDecimal("1.1")), CONTEXT, "request"));
            failure(ErrorCode.INVALID_REQUEST, () -> client.invoke(binding("number", "long"), Map.of(), CONTEXT, "request"));
            failure(ErrorCode.INVALID_REQUEST, () -> call(client, "echo", Map.of("nested", List.of(Map.of("class", "java.lang.Runtime")))));
            assertThatThrownBy(() -> call(client, "echo", Map.of("text", "x".repeat(2048))))
                    .isInstanceOfSatisfying(io.github.chenyilei2016.openplatform.domain.runtime.ProviderCallFailure.class, failure -> {
                        assertThat(failure.getErrorCode()).isEqualTo(ErrorCode.REQUEST_TOO_LARGE);
                        assertThat(failure.dispatch()).isEqualTo(io.github.chenyilei2016.openplatform.domain.runtime.InvocationDiagnostics.Dispatch.NOT_SENT);
                    });
            assertThatThrownBy(() -> call(client, "large", Map.of()))
                    .isInstanceOfSatisfying(io.github.chenyilei2016.openplatform.domain.runtime.ResponseAdaptation.Failure.class,
                            failure -> assertThat(failure.issue().reason()).isEqualTo(io.github.chenyilei2016.openplatform.domain.runtime.ResponseAdaptation.Reason.LIMIT_EXCEEDED));
            Map<String, ErrorCode> errors = Map.of("403", ErrorCode.FORBIDDEN, "404", ErrorCode.NOT_FOUND,
                    "429", ErrorCode.RATE_LIMITED, "504", ErrorCode.DOWNSTREAM_TIMEOUT, "500", ErrorCode.DOWNSTREAM_FAILED);
            errors.forEach((status, error) -> {
                failure(error, () -> call(client, "status", Map.of("status", status)));
                failure(error, () -> call(client, "status", Map.of("status", status, "throw", true)));
            });
            try (var executor = Executors.newSingleThreadExecutor()) {
                var slow = executor.submit(() -> failure(ErrorCode.DOWNSTREAM_TIMEOUT, () -> call(client, "slow", Map.of())));
                assertThat(SLOW_STARTED.await(2, TimeUnit.SECONDS)).isTrue();
                failure(ErrorCode.RATE_LIMITED, () -> call(client, "echo", Map.of()));
                slow.get(2, TimeUnit.SECONDS);
            }
            assertThat(call(client, "echo", Map.of())).isEqualTo(Map.of("input", Map.of(), "tenant", "101", "leaked", "absent"));
            io.opentelemetry.context.Context trace = io.opentelemetry.context.Context.root().with(io.opentelemetry.api.trace.Span.wrap(
                    io.opentelemetry.api.trace.SpanContext.create("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "0123456789abcdef", io.opentelemetry.api.trace.TraceFlags.getSampled(),
                            io.opentelemetry.api.trace.TraceState.builder().put("arms", "regression").build())));
            try (io.opentelemetry.context.Scope ignored = trace.makeCurrent()) { call(client, "echo", Map.of()); }
            assertThat(TRACE_PARENT.get()).isEqualTo("00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-0123456789abcdef-01");
            assertThat(TRACE_STATE.get()).isEqualTo("arms=regression");
            client.destroy();
            failure(ErrorCode.DOWNSTREAM_FAILED, () -> call(client, "echo", Map.of()));
        } finally {
            RpcContext.removeContext();
            if (invoker != null) invoker.destroy();
            connection.close();
            provider.destroy();
        }
    }

    private static Object call(GenericDubboApiInvoker client, String method, Map<String, Object> value) {
        return client.invoke(binding(method, "java.util.Map"), Map.of("arg0", value), CONTEXT, "request");
    }

    private static ApiBinding binding(String method, String type) {
        return new ApiBinding(ApiProtocol.DUBBO, 2000, null,
                new ApiBinding.Dubbo(TransportService.class.getName(), method, "1.0.0", "transport-test", List.of(type), "test-connection", 1L, null));
    }

    private static void failure(ErrorCode error, Runnable action) {
        assertThatThrownBy(action::run).isInstanceOfSatisfying(PlatformException.class, exception -> {
            assertThat(exception.getErrorCode()).isEqualTo(error);
            assertThat(exception.getMessage()).doesNotContain("secret provider detail");
        });
    }
}
