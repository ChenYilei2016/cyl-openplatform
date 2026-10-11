package io.github.chenyilei2016.openplatform.logging;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.LoggerContext;
import ch.qos.logback.classic.PatternLayout;
import ch.qos.logback.classic.spi.LoggingEvent;
import io.github.chenyilei2016.openplatform.application.observability.ObservationService;
import io.github.chenyilei2016.openplatform.domain.observability.CallRecord;
import io.github.chenyilei2016.openplatform.domain.observability.CallRecordRepository;
import io.github.chenyilei2016.openplatform.domain.observability.ManagementAuditRepository;
import io.github.chenyilei2016.openplatform.common.ApiResponse;
import java.io.InputStream;
import java.sql.SQLException;
import java.util.Map;
import javax.xml.parsers.DocumentBuilderFactory;
import org.springframework.http.ResponseEntity;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import io.github.chenyilei2016.openplatform.common.PlatformExceptionHandler;
import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;

class DiagnosticLoggingTest {
    @Test
    void platformFailureIncludesCauseAndRequestContext() {
        Logger logger = (Logger) LoggerFactory.getLogger(PlatformExceptionHandler.class);
        ListAppender<ILoggingEvent> events = new ListAppender<>() {
            @Override protected void append(ILoggingEvent event) {
                event.prepareForDeferredProcessing();
                super.append(event);
            }
        };
        events.start();
        logger.addAppender(events);
        boolean additive = logger.isAdditive();
        logger.setAdditive(false);
        try (MDC.MDCCloseable request = MDC.putCloseable("requestId", "request-diagnostic");
             MDC.MDCCloseable trace = MDC.putCloseable("traceId", "trace-diagnostic")) {
            RuntimeException external = new IllegalStateException("credential-must-not-appear");
            PlatformException failure = new PlatformException(ErrorCode.DEPENDENCY_UNAVAILABLE, "身份服务暂不可用");
            failure.initCause(external);
            ResponseEntity<ApiResponse<Void>> response = new PlatformExceptionHandler().handlePlatform(failure, new org.springframework.mock.web.MockHttpServletRequest());
            assertThat(response.getStatusCode().value()).isEqualTo(503);
            assertThat(events.list).hasSize(1);
            ILoggingEvent event = events.list.getFirst();
            assertThat(event.getThrowableProxy().getCause().getClassName()).isEqualTo(IllegalStateException.class.getName());
            assertThat(event.getMDCPropertyMap()).containsEntry("requestId", "request-diagnostic").containsEntry("traceId", "trace-diagnostic");
            assertThat(response.getBody().resultMsg()).isEqualTo("身份服务暂不可用");
        } finally {
            logger.setAdditive(additive);
            logger.detachAppender(events);
            events.stop();
        }
    }

    @Test
    void configuredPatternKeepsStacksCausesAndSuppressedWithoutExternalMessages() throws Exception {
        Document configuration;
        try (InputStream resource = getClass().getResourceAsStream("/logback-spring.xml")) {
            configuration = DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(resource);
        }
        LoggerContext context = new LoggerContext();
        try {
            PatternLayout layout = new PatternLayout();
            layout.setContext(context);
            NodeList rules = configuration.getElementsByTagName("conversionRule");
            for (int index = 0; index < rules.getLength(); index++) {
                Element rule = (Element) rules.item(index);
                layout.getInstanceConverterMap().put(rule.getAttribute("conversionWord"), () -> {
                    try {
                        return (ch.qos.logback.core.pattern.DynamicConverter<?>) Class.forName(rule.getAttribute("class"))
                                .getConstructor().newInstance();
                    } catch (ReflectiveOperationException failure) {
                        throw new IllegalStateException(failure);
                    }
                });
            }
            NodeList properties = configuration.getElementsByTagName("property");
            for (int index = 0; index < properties.getLength(); index++) {
                Element property = (Element) properties.item(index);
                if ("PLATFORM_LOG_PATTERN".equals(property.getAttribute("name"))) {
                    layout.setPattern(property.getAttribute("value"));
                }
            }
            layout.start();
            SQLException sqlFailure = new SQLException("sql-parameter-secret", "42S02", 1146);
            IllegalStateException cause = new IllegalStateException("external-secret", sqlFailure);
            RuntimeException failure = new RuntimeException("http-response-body-secret", cause);
            failure.addSuppressed(new IllegalArgumentException("full-token-secret"));
            sqlFailure.initCause(failure);
            LoggingEvent event = new LoggingEvent(getClass().getName(), context.getLogger("diagnostic-check"),
                    Level.ERROR, "依赖调用失败", failure, null);
            event.setMDCPropertyMap(Map.of("requestId", "request-diagnostic", "traceId", "trace-diagnostic"));
            String output = layout.doLayout(event);
            assertThat(output).contains("requestId=request-diagnostic", "traceId=trace-diagnostic",
                    "java.lang.RuntimeException", "Caused by: java.lang.IllegalStateException",
                    "Suppressed: java.lang.IllegalArgumentException", "DiagnosticLoggingTest.java:", "CIRCULAR REFERENCE", "sqlState=42S02", "vendorErrorCode=1146")
                    .doesNotContain("sql-parameter-secret", "http-response-body-secret", "full-token-secret", "external-secret", "PARSER_ERROR");
            layout.stop();
        } finally {
            context.stop();
        }
    }

    @Test
    void recordStorageFailureLogsItsStackWithoutChangingTheCompletedCall() {
        Logger logger = (Logger) LoggerFactory.getLogger(ObservationService.class);
        ListAppender<ILoggingEvent> events = new ListAppender<>();
        events.start();
        logger.addAppender(events);
        boolean additive = logger.isAdditive();
        logger.setAdditive(false);
        try {
            CallRecordRepository repository = mock(CallRecordRepository.class);
            CallRecord record = CallRecord.builder().requestId("request-record").build();
            RuntimeException failure = new IllegalStateException("sql-parameter-secret");
            doThrow(failure).when(repository).append(record);
            new ObservationService(repository, mock(ManagementAuditRepository.class),
                    mock(io.github.chenyilei2016.openplatform.domain.access.EmployeeProfileRepository.class),
                    mock(io.github.chenyilei2016.openplatform.application.administration.OperatorNames.class)).record(record);
            assertThat(events.list).hasSize(1);
            assertThat(events.list.getFirst().getFormattedMessage()).contains("request-record");
            assertThat(events.list.getFirst().getThrowableProxy().getClassName()).isEqualTo(IllegalStateException.class.getName());
        } finally {
            logger.setAdditive(additive);
            logger.detachAppender(events);
            events.stop();
        }
    }
}
