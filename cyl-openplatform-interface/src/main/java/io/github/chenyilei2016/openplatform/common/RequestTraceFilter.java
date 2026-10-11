package io.github.chenyilei2016.openplatform.common;

import io.github.chenyilei2016.openplatform.domain.common.UuidV7;
import io.opentelemetry.api.trace.Span;
import io.opentelemetry.api.trace.propagation.W3CTraceContextPropagator;
import io.opentelemetry.context.Context;
import io.opentelemetry.context.Scope;
import io.opentelemetry.context.propagation.TextMapGetter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.MDC;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.Collections;

@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class RequestTraceFilter extends OncePerRequestFilter {
    private static final TextMapGetter<HttpServletRequest> TRACE_HEADERS = new TextMapGetter<>() {
        @Override
        public Iterable<String> keys(HttpServletRequest request) {
            return request == null || request.getHeaderNames() == null
                    ? Collections.emptyList() : Collections.list(request.getHeaderNames());
        }

        @Override
        public String get(HttpServletRequest request, String key) {
            return request == null ? null : request.getHeader(key);
        }
    };

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    FilterChain chain) throws ServletException, IOException {
        Context current = Context.current();
        // Agent 已建立服务端 Span 时保留它，不能用入站父 Span 覆盖当前 Span。
        Context traceContext = Span.fromContext(current).getSpanContext().isValid() ? current
                : W3CTraceContextPropagator.getInstance().extract(current, request, TRACE_HEADERS);
        String traceId = Span.fromContext(traceContext).getSpanContext().isValid()
                ? Span.fromContext(traceContext).getSpanContext().getTraceId() : null;
        if (traceId != null && !traceId.matches("[a-zA-Z0-9._-]{1,64}")) traceId = null;
        // 无链路上下文时用 UUIDv7：按时间有序，便于在日志中按请求号排序与定位；请求号不承担保密用途。
        String requestId = traceId == null ? UuidV7.nextId() : traceId;
        String previousRequestId = MDC.get("requestId");
        String previousTraceId = MDC.get("traceId");
        response.setHeader("X-Request-Id", requestId);
        response.setHeader("X-Content-Type-Options", "nosniff");
        MDC.put("requestId", requestId);
        if (traceId == null) MDC.remove("traceId"); else MDC.put("traceId", traceId);
        try (Scope ignored = traceContext.makeCurrent()) {
            chain.doFilter(request, response);
        } finally {
            if (previousRequestId == null) MDC.remove("requestId"); else MDC.put("requestId", previousRequestId);
            if (previousTraceId == null) MDC.remove("traceId"); else MDC.put("traceId", previousTraceId);
        }
    }
}
