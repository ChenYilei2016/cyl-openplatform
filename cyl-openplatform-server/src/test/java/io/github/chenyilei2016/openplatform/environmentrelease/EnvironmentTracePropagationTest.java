package io.github.chenyilei2016.openplatform.environmentrelease;

import static org.assertj.core.api.Assertions.assertThat;

import io.github.chenyilei2016.openplatform.domain.environmentrelease.EnvironmentReleaseModels.NodeObservation;
import io.github.chenyilei2016.openplatform.infrastructure.environmentrelease.EnvironmentReleaseSettings.Node;
import io.github.chenyilei2016.openplatform.infrastructure.environmentrelease.EnvironmentReleaseSettings.RemoteTarget;
import io.github.chenyilei2016.openplatform.infrastructure.environmentrelease.WebClientEnvironmentReleaseClient;
import io.github.chenyilei2016.openplatform.infrastructure.properties.environmentrelease.EnvironmentReleaseProperties;
import io.opentelemetry.api.trace.Span;
import io.opentelemetry.api.trace.SpanContext;
import io.opentelemetry.api.trace.TraceFlags;
import io.opentelemetry.api.trace.TraceState;
import io.opentelemetry.context.Context;
import io.opentelemetry.context.Scope;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.IntStream;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.client.reactive.ClientHttpConnector;
import org.springframework.http.client.reactive.ClientHttpResponse;
import org.springframework.mock.http.client.reactive.MockClientHttpRequest;
import org.springframework.mock.http.client.reactive.MockClientHttpResponse;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;
import reactor.core.publisher.Sinks;
import reactor.core.scheduler.Schedulers;
import tools.jackson.databind.json.JsonMapper;

/** 模拟异步传输完成后继续订阅下一批节点，不启动 Spring 或网络服务。 */
class EnvironmentTracePropagationTest {
    @Test
    void observeKeepsTraceContextWhenLaterNodesStartOnResponseThreads() {
        String traceId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        String spanId = "0123456789abcdef";
        Context traceContext = Context.root().with(Span.wrap(SpanContext.create(traceId, spanId,
                TraceFlags.getSampled(), TraceState.builder().put("vendor", "state").build())));
        List<Node> nodes = IntStream.range(0, 6)
                .mapToObj(index -> new Node("node-" + index, "https://node-" + index + ".test")).toList();
        EnvironmentReleaseProperties properties = new EnvironmentReleaseProperties();
        properties.setTargets(List.of(new RemoteTarget("target", "目标环境", "test-only-credential-at-least-32-characters", nodes)));
        properties.afterPropertiesSet();

        Map<String, HttpHeaders> sent = new ConcurrentHashMap<>();
        AtomicInteger started = new AtomicInteger();
        Sinks.One<Void> firstBatchStarted = Sinks.one();
        Thread caller = Thread.currentThread();
        ClientHttpConnector connector = (method, uri, callback) -> Mono.defer(() -> {
            assertThat(Thread.currentThread()).isNotSameAs(caller);
            assertThat(Span.current().getSpanContext().isValid()).isFalse();
            MockClientHttpRequest request = new MockClientHttpRequest(method, uri);
            MockClientHttpResponse response = new MockClientHttpResponse(HttpStatus.BAD_REQUEST);
            response.getHeaders().setContentType(MediaType.APPLICATION_JSON);
            response.setBody("""
                    {"code":40000001,"resultMsg":"rejected","requestId":"demo","data":null}
                    """);
            return callback.apply(request).then(Mono.defer(() -> {
                sent.put(uri.getHost(), request.getHeaders());
                // 首批四个全部订阅后才返回响应，确保第 5、6 个由响应线程触发。
                if (started.incrementAndGet() == 4) firstBatchStarted.tryEmitEmpty();
                return firstBatchStarted.asMono().thenReturn((ClientHttpResponse) response);
            }));
        }).subscribeOn(Schedulers.boundedElastic());
        WebClientEnvironmentReleaseClient client = new WebClientEnvironmentReleaseClient(
                WebClient.builder().clientConnector(connector).build(), JsonMapper.builder().build(), properties);

        List<NodeObservation> observations;
        try (Scope ignored = traceContext.makeCurrent()) {
            observations = client.observe("target", "01234567-89ab-cdef-0123-456789abcdef");
        }

        assertThat(observations).extracting(NodeObservation::nodeId).containsExactlyElementsOf(nodes.stream().map(Node::id).toList());
        assertThat(observations).allSatisfy(observation -> {
            assertThat(observation.receipt()).isNull();
            assertThat(observation.error()).contains("拒绝查询回执", "目标 HTTP 400", "目标请求号：demo");
        });
        assertThat(started.get()).isEqualTo(nodes.size());
        assertThat(sent.keySet()).containsExactlyInAnyOrderElementsOf(nodes.stream().map(node -> node.id() + ".test").toList());
        assertThat(sent.values()).allSatisfy(headers -> {
            assertThat(headers.getFirst("traceparent")).isEqualTo("00-" + traceId + "-" + spanId + "-01");
            assertThat(headers.getFirst("tracestate")).isEqualTo("vendor=state");
        });
    }
}
