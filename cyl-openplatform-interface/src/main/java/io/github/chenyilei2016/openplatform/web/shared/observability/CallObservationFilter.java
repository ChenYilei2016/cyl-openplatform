package io.github.chenyilei2016.openplatform.web.shared.observability;

import io.github.chenyilei2016.openplatform.domain.common.ObjectIdType;
import io.github.chenyilei2016.openplatform.application.observability.ObservationService;
import io.github.chenyilei2016.openplatform.domain.observability.CallMode;
import io.github.chenyilei2016.openplatform.domain.observability.CallRecord;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.net.InetAddress;
import java.time.Instant;
import lombok.RequiredArgsConstructor;
import org.slf4j.MDC;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 1)
@RequiredArgsConstructor
public class CallObservationFilter extends OncePerRequestFilter {
    private final ObservationService observations;

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        String path = request.getServletPath();
        if (path.isEmpty()) path = request.getRequestURI().substring(request.getContextPath().length());
        return !path.startsWith("/api/oauth/") && !path.startsWith("/api/sign/") && !(request.getMethod().equals("POST")
                && path.matches("/admin-api/apis/[^/]+/debug"));
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        long started = System.nanoTime();
        CallRecord.CallRecordBuilder record = CallRecord.builder().id(ObjectIdType.CALL_RECORD.nextId()).requestId(MDC.get("requestId"))
                .mode(!request.getRequestURI().startsWith(request.getContextPath() + "/admin-api/")
                        ? CallMode.PRODUCTION : CallMode.DRAFT_DEBUG)
                .clientIp(InetAddress.ofLiteral(request.getRemoteAddr()).getHostAddress()).occurredAt(Instant.now());
        request.setAttribute(CallObservation.ATTRIBUTE, record);
        boolean completed = false;
        try {
            chain.doFilter(request, response);
            completed = true;
        } finally {
            int status = completed ? response.getStatus() : 500;
            observations.record(record.httpStatus(status).outcome(status >= 200 && status < 300 && record.build().errorCode() == null ? "SUCCESS" : "FAILURE")
                    .durationMillis((System.nanoTime() - started) / 1_000_000).build());
            request.removeAttribute(CallObservation.ATTRIBUTE);
        }
    }
}
