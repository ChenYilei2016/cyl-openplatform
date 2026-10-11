package io.github.chenyilei2016.openplatform.common;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import org.slf4j.MDC;
import java.io.IOException;

import io.opentelemetry.api.trace.Span;
import io.opentelemetry.api.trace.SpanContext;
import io.opentelemetry.api.trace.TraceFlags;
import io.opentelemetry.api.trace.TraceState;
import io.opentelemetry.api.trace.propagation.W3CTraceContextPropagator;
import io.opentelemetry.context.Context;
import io.opentelemetry.context.Scope;
import jakarta.servlet.FilterChain;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

class RequestTraceFilterTest {
    private static final String TRACE_ID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    private static final String SPAN_ID = "0123456789abcdef";
    private static final Context REMOTE_CONTEXT = Context.root().with(Span.wrap(SpanContext.create(
            TRACE_ID, SPAN_ID, TraceFlags.getSampled(), TraceState.getDefault())));

    @Test
    void extractsW3cContextWhenNoAgentSpanIsActive() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest();
        W3CTraceContextPropagator.getInstance().inject(REMOTE_CONTEXT, request,
                (carrier, key, value) -> carrier.addHeader(key, value));
        AtomicReference<String> traceId = new AtomicReference<>();
        FilterChain chain = (ignoredRequest, ignoredResponse) -> traceId.set(Span.current().getSpanContext().getTraceId());

        MockHttpServletResponse response = new MockHttpServletResponse();
        new RequestTraceFilter().doFilter(request, response, chain);

        assertThat(traceId).hasValue(TRACE_ID);
        assertThat(response.getHeader("X-Request-Id")).isEqualTo(TRACE_ID);
        assertThat(Span.current().getSpanContext().isValid()).isFalse();
    }

    @Test
    void keepsAgentCreatedServerSpanOverIncomingParent() throws Exception {
        Context agentContext = Context.root().with(Span.wrap(SpanContext.create(
                "fedcba9876543210fedcba9876543210", "fedcba9876543210", TraceFlags.getSampled(), TraceState.getDefault())));
        AtomicReference<String> traceId = new AtomicReference<>();
        FilterChain chain = (ignoredRequest, ignoredResponse) -> traceId.set(Span.current().getSpanContext().getTraceId());

        MockHttpServletRequest request = new MockHttpServletRequest();
        W3CTraceContextPropagator.getInstance().inject(REMOTE_CONTEXT, request,
                (carrier, key, value) -> carrier.addHeader(key, value));
        MockHttpServletResponse response = new MockHttpServletResponse();
        try (Scope ignored = agentContext.makeCurrent()) {
            new RequestTraceFilter().doFilter(request, response, chain);
        }
        assertThat(response.getHeader("X-Request-Id")).isEqualTo("fedcba9876543210fedcba9876543210");
        assertThat(traceId).hasValue("fedcba9876543210fedcba9876543210");
    }

    @Test
    void invalidOrMissingHeadersDoNotBreakRequestAndMdcIsCleared() throws Exception {
        MockHttpServletResponse response = new MockHttpServletResponse();

        MockHttpServletRequest incoming = new MockHttpServletRequest();
        incoming.addHeader("traceparent", "invalid");
        incoming.addHeader("X-Request-Id", "untrusted-request-id");
        assertDoesNotThrow(() -> new RequestTraceFilter().doFilter(
                incoming, response, (request, ignoredResponse) ->
                        assertThat(org.slf4j.MDC.get("requestId")).isNotBlank()));

        assertThat(response.getHeader("X-Request-Id")).isNotNull().isNotEqualTo("untrusted-request-id");
        assertThat(java.util.UUID.fromString(response.getHeader("X-Request-Id")).version()).isEqualTo(7);
        assertThat(org.slf4j.MDC.get("requestId")).isNull();
    }
    @Test
    void exceptionRestoresCallerMdcAndScope() {
        MDC.put("requestId", "previous-request");
        MDC.put("traceId", "previous-trace");
        MockHttpServletRequest request = new MockHttpServletRequest();
        W3CTraceContextPropagator.getInstance().inject(REMOTE_CONTEXT, request,
                (carrier, key, value) -> carrier.addHeader(key, value));
        try {
            assertThatThrownBy(() -> new RequestTraceFilter().doFilter(request, new MockHttpServletResponse(),
                    (req, res) -> {
                        assertThat(MDC.get("requestId")).isEqualTo(TRACE_ID);
                        assertThat(MDC.get("traceId")).isEqualTo(TRACE_ID);
                        throw new IOException("test failure");
                    })).isInstanceOf(IOException.class);
            assertThat(MDC.get("requestId")).isEqualTo("previous-request");
            assertThat(MDC.get("traceId")).isEqualTo("previous-trace");
            assertThat(Span.current().getSpanContext().isValid()).isFalse();
        } finally {
            MDC.clear();
        }
    }

}
