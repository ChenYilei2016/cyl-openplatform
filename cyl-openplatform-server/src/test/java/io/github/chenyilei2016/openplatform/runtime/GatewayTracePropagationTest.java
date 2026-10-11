package io.github.chenyilei2016.openplatform.runtime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import io.github.chenyilei2016.openplatform.domain.catalog.ApiBinding;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiProtocol;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.github.chenyilei2016.openplatform.domain.runtime.InvocationContext;
import io.github.chenyilei2016.openplatform.infrastructure.connection.runtime.ManagedDubboConnectionRuntime;
import io.github.chenyilei2016.openplatform.infrastructure.properties.gateway.GatewayDubboProperties;
import io.github.chenyilei2016.openplatform.infrastructure.properties.gateway.GatewayHttpProperties;
import io.github.chenyilei2016.openplatform.infrastructure.runtime.GenericDubboApiInvoker;
import io.github.chenyilei2016.openplatform.infrastructure.runtime.WebClientHttpApiInvoker;
import io.opentelemetry.api.trace.Span;
import io.opentelemetry.api.trace.SpanContext;
import io.opentelemetry.api.trace.TraceFlags;
import io.opentelemetry.api.trace.TraceState;
import io.opentelemetry.context.Context;
import io.opentelemetry.context.Scope;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;
import org.apache.dubbo.rpc.RpcContext;
import org.apache.dubbo.rpc.service.GenericService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.client.reactive.ClientHttpConnector;
import org.springframework.http.client.reactive.ClientHttpResponse;
import org.springframework.mock.http.client.reactive.MockClientHttpRequest;
import org.springframework.mock.http.client.reactive.MockClientHttpResponse;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;
import tools.jackson.databind.json.JsonMapper;

/** 只验证出站客户端的上下文边界；不启动 Spring、HTTP 或 Dubbo 服务。 */
class GatewayTracePropagationTest {
    private static final String TRACE_ID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    private static final String SPAN_ID = "0123456789abcdef";
    private static final String TRACE_PARENT = "00-" + TRACE_ID + "-" + SPAN_ID + "-01";
    private static final Context TRACE_CONTEXT = Context.root().with(Span.wrap(SpanContext.create(
            TRACE_ID, SPAN_ID, TraceFlags.getSampled(), TraceState.builder().put("vendor", "state").build())));
    private static final InvocationContext IDENTITY = new InvocationContext("application", "app-key", "tenant",
            null, null, null, List.of());

    @ParameterizedTest
    @ValueSource(strings = {"", "invalid", "00-11111111111111111111111111111111-2222222222222222-00"})
    void httpPropagatesCapturedContextAcrossThreadsAndPreservesAgentHeaders(String existingParent) {
        AtomicReference<HttpHeaders> sent = new AtomicReference<>();
        ClientHttpConnector connector = (method, uri, callback) -> Mono.defer(() -> {
            assertThat(Span.current().getSpanContext().isValid()).isFalse();
            MockClientHttpRequest request = new MockClientHttpRequest(method, uri);
            MockClientHttpResponse response = new MockClientHttpResponse(HttpStatus.OK);
            response.getHeaders().setContentType(MediaType.APPLICATION_JSON);
            response.setBody("{}");
            return callback.apply(request).then(Mono.<ClientHttpResponse>fromSupplier(() -> {
                sent.set(request.getHeaders());
                return response;
            }));
        }).subscribeOn(Schedulers.boundedElastic());
        WebClient.Builder builder = WebClient.builder().clientConnector(connector)
                .defaultHeader("tracestate", "agent=existing");
        if (!existingParent.isEmpty()) builder.defaultHeader("traceparent", existingParent);
        GatewayHttpProperties properties = new GatewayHttpProperties();
        WebClientHttpApiInvoker invoker = new WebClientHttpApiInvoker(builder.build(), JsonMapper.builder().build(), properties, io.github.chenyilei2016.openplatform.testing.ProviderProofTestSupport.gateway(), org.mockito.Mockito.mock(io.github.chenyilei2016.openplatform.domain.runtime.HttpServiceDiscovery.class));
        ApiBinding binding = new ApiBinding(ApiProtocol.HTTP, 2000, new ApiBinding.Http("http://provider.test/call", "POST"), null);

        try (Scope ignored = TRACE_CONTEXT.makeCurrent()) {
            assertThat(invoker.invoke(binding, new io.github.chenyilei2016.openplatform.domain.runtime.HttpParameters(Map.of(), Map.of(), Map.of()), IDENTITY, "request-id")).isEqualTo(Map.of());
        }
        boolean agentInjected = existingParent.startsWith("00-");
        assertThat(sent.get().getFirst("traceparent")).isEqualTo(agentInjected ? existingParent : TRACE_PARENT);
        assertThat(sent.get().getFirst("tracestate")).isEqualTo(agentInjected ? "agent=existing" : "vendor=state");
        assertThat(sent.get().getFirst("X-Request-Id")).isEqualTo("request-id");
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void dubboPropagatesOnlyCurrentContextAndRestoresAttachmentsOnSuccessAndFailure(boolean fail) {
        ManagedDubboConnectionRuntime connections = mock(ManagedDubboConnectionRuntime.class);
        ManagedDubboConnectionRuntime.ReferenceLease lease = mock(ManagedDubboConnectionRuntime.ReferenceLease.class);
        GenericService service = mock(GenericService.class);
        when(connections.acquire("connection", 1L, new io.github.chenyilei2016.openplatform.domain.connection.DubboServiceIdentity("example.Provider", "", "", null))).thenReturn(lease);
        when(lease.service()).thenReturn(service);
        when(service.$invoke(eq("call"), any(String[].class), any(Object[].class))).thenAnswer(invocation -> {
            assertThat(RpcContext.getClientAttachment().getAttachment("traceparent")).isEqualTo(TRACE_PARENT);
            assertThat(RpcContext.getClientAttachment().getAttachment("tracestate")).isEqualTo("vendor=state");
            assertThat(RpcContext.getClientAttachment().getAttachment("authorization")).isNull();
            assertThat(RpcContext.getServerAttachment().getAttachment("untrusted")).isNull();
            if (fail) throw new IllegalStateException("provider failure");
            return Map.of();
        });
        GenericDubboApiInvoker invoker = new GenericDubboApiInvoker(new GatewayDubboProperties(), JsonMapper.builder().build(), connections, io.github.chenyilei2016.openplatform.testing.ProviderProofTestSupport.gateway());
        ApiBinding binding = new ApiBinding(ApiProtocol.DUBBO, 2000, null,
                new ApiBinding.Dubbo("example.Provider", "call", "", "", List.of(), "connection", 1L, null));
        RpcContext.getClientAttachment().setAttachment("authorization", "caller-secret");
        RpcContext.getClientAttachment().setAttachment("traceparent", "old-trace");
        RpcContext.getClientAttachment().setAttachment("tracestate", "old=state");
        RpcContext.getServerAttachment().setAttachment("untrusted", "caller-input");
        try (Scope ignored = TRACE_CONTEXT.makeCurrent()) {
            if (fail) {
                assertThatThrownBy(() -> invoker.invoke(binding, Map.of(), IDENTITY, "request-id"))
                        .isInstanceOf(PlatformException.class);
            } else {
                assertThat(invoker.invoke(binding, Map.of(), IDENTITY, "request-id")).isEqualTo(Map.of());
            }
            assertThat(RpcContext.getClientAttachment().getAttachment("authorization")).isEqualTo("caller-secret");
            assertThat(RpcContext.getClientAttachment().getAttachment("traceparent")).isEqualTo("old-trace");
            assertThat(RpcContext.getClientAttachment().getAttachment("tracestate")).isEqualTo("old=state");
            assertThat(RpcContext.getClientAttachment().getAttachment("x-open-platform-credential")).isNull();
            assertThat(RpcContext.getServerAttachment().getAttachment("untrusted")).isEqualTo("caller-input");
            verify(lease).close();
        } finally {
            RpcContext.removeContext();
            invoker.destroy();
        }
    }
}
