package io.github.chenyilei2016.openplatform.logging;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import io.github.chenyilei2016.openplatform.application.observability.ObservationService;
import io.github.chenyilei2016.openplatform.common.ApiResponse;
import io.github.chenyilei2016.openplatform.infrastructure.properties.observability.ObservationProperties;
import io.github.chenyilei2016.openplatform.web.shared.observability.DiagnosticContent;
import io.github.chenyilei2016.openplatform.web.shared.observability.CallObservation;
import io.github.chenyilei2016.openplatform.web.shared.observability.CallObservationFilter;
import io.github.chenyilei2016.openplatform.web.shared.observability.InvocationResponseLogging;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.http.MediaType;
import org.springframework.http.server.ServletServerHttpRequest;
import org.springframework.http.server.ServletServerHttpResponse;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import tools.jackson.databind.json.JsonMapper;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

class InvocationResponseLoggingTest {
    @Test void logsBoundedRedactedOutcomesWithoutChangingTheResponse() throws Exception {
        ObservationProperties settings = new ObservationProperties(); settings.setResponseLogMaxBytes(256);
        InvocationResponseLogging advice = new InvocationResponseLogging(settings, new DiagnosticContent(JsonMapper.builder().build()));
        Logger logger = (Logger) LoggerFactory.getLogger(InvocationResponseLogging.class);
        ListAppender<ILoggingEvent> events = new ListAppender<>(); events.start(); logger.addAppender(events);
        try (MDC.MDCCloseable requestId = MDC.putCloseable("requestId", "log-request"); MDC.MDCCloseable traceId = MDC.putCloseable("traceId", "log-trace")) {
            for (int code : new int[]{200, 50200001}) {
                MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/oauth/orders/v1/query");
                MockHttpServletResponse response = new MockHttpServletResponse();
                if (code != 200) request.setAttribute(CallObservation.PROVIDER_RESPONSE, Map.of("reason", "wrong-type", "accessToken", "provider-private", "message", "上游返回 {\"access_token\":\"embedded-private\",\"authorization\":\"Basic complete-private\"}"));
                ApiResponse<Object> body = new ApiResponse<>(code, "结果", Map.of("appSecret", "client-private", "description", "中文".repeat(500)), "log-request");
                new CallObservationFilter(mock(ObservationService.class)).doFilter(request, response, (req, res) -> {
                    Object written = advice.beforeBodyWrite(body, null, MediaType.APPLICATION_JSON, null,
                            new ServletServerHttpRequest(request), new ServletServerHttpResponse(response));
                    assertThat(written).isSameAs(body);
                });
            }
            assertThat(events.list).hasSize(2);
            assertThat(events.list.get(0).getFormattedMessage()).contains("outcome=SUCCESS", "responseTruncated=true", "traceId=log-trace");
            assertThat(events.list.get(1).getFormattedMessage()).contains("outcome=FAILURE", "wrong-type", "providerTruncated=false");
            for (ILoggingEvent event : events.list) assertThat(event.getFormattedMessage()).doesNotContain("client-private", "provider-private", "embedded-private", "complete-private", "�");
        } finally { logger.detachAppender(events); events.stop(); }
    }
}
