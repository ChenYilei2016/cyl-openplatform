package io.github.chenyilei2016.openplatform.infrastructure.common;

import io.opentelemetry.api.trace.Span;
import io.opentelemetry.api.trace.propagation.W3CTraceContextPropagator;
import io.opentelemetry.context.Context;
import io.opentelemetry.context.propagation.TextMapGetter;
import org.springframework.http.HttpHeaders;

/** 自建 WebClient 的传播补充；不覆盖 Agent 已注入的有效客户端 Span。 */
public final class HttpTracePropagation {
    private static final TextMapGetter<HttpHeaders> GETTER = new TextMapGetter<>() {
        @Override
        public Iterable<String> keys(HttpHeaders headers) { return headers.headerNames(); }

        @Override
        public String get(HttpHeaders headers, String key) { return headers == null ? null : headers.getFirst(key); }
    };

    private HttpTracePropagation() {}

    public static void injectIfAbsent(Context context, HttpHeaders headers) {
        W3CTraceContextPropagator propagator = W3CTraceContextPropagator.getInstance();
        Context injected = propagator.extract(Context.root(), headers, GETTER);
        if (!Span.fromContext(injected).getSpanContext().isValid()
                && Span.fromContext(context).getSpanContext().isValid()) {
            headers.remove("tracestate");
            propagator.inject(context, headers, HttpHeaders::set);
        }
    }
}
