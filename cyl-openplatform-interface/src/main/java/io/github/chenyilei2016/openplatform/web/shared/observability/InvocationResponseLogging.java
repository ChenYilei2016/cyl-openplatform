package io.github.chenyilei2016.openplatform.web.shared.observability;

import io.github.chenyilei2016.openplatform.application.observability.ObservationSettings;
import io.github.chenyilei2016.openplatform.common.ApiResponse;
import io.github.chenyilei2016.openplatform.domain.observability.CallRecord;
import io.github.chenyilei2016.openplatform.domain.runtime.InvocationDiagnostics;
import io.github.chenyilei2016.openplatform.web.shared.observability.DiagnosticContent;
import io.github.chenyilei2016.openplatform.web.admin.debug.DraftDebugController;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.core.MethodParameter;
import org.springframework.http.MediaType;
import org.springframework.http.converter.HttpMessageConverter;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.http.server.ServletServerHttpRequest;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.servlet.mvc.method.annotation.ResponseBodyAdvice;

/** 仅调用链运行日志，数据库调用记录仍只存元数据；日志失败不改变业务响应。 */
@Slf4j
@RestControllerAdvice
@RequiredArgsConstructor
public class InvocationResponseLogging implements ResponseBodyAdvice<Object> {
    private final ObservationSettings settings;
    private final DiagnosticContent content;
    @Override public boolean supports(MethodParameter type, Class<? extends HttpMessageConverter<?>> converter) { return true; }
    @Override public Object beforeBodyWrite(Object body, MethodParameter type, MediaType mediaType,
            Class<? extends HttpMessageConverter<?>> converter, ServerHttpRequest request, ServerHttpResponse response) {
        if (!settings.isResponseLogEnabled() || !(body instanceof ApiResponse<?> envelope)
                || !(request instanceof ServletServerHttpRequest servlet)
                || !(servlet.getServletRequest().getAttribute(CallObservation.ATTRIBUTE) instanceof CallRecord.CallRecordBuilder observation)) return body;
        try {
            Object publicResult = envelope;
            Object provider = servlet.getServletRequest().getAttribute(CallObservation.PROVIDER_RESPONSE);
            boolean succeeded = envelope.code() == 200;
            if (envelope.data() instanceof DraftDebugController.DebugView debug) {
                publicResult = debug.publicResponse().value();
                succeeded = debug.outcome() == InvocationDiagnostics.Outcome.SUCCEEDED;
                if (!succeeded && debug.providerResponse().available()) provider = debug.providerResponse().value();
            }
            DiagnosticContent.Message summary = content.logSummary(publicResult, settings.getResponseLogMaxBytes());
            DiagnosticContent.Message original = provider == null ? null : content.logSummary(provider, settings.getResponseLogMaxBytes());
            CallRecord record = observation.build();
            String format = "API调用结果 requestId={} traceId={} apiId={} outcome={} responseSummary={} responseTruncated={} providerSummary={} providerTruncated={}";
            Object[] values = {record.requestId(), org.slf4j.MDC.get("traceId"), record.apiId(), succeeded ? "SUCCESS" : "FAILURE", summary.value(), summary.truncated(), original == null ? null : original.value(), original != null && original.truncated()};
            if (succeeded) log.info(format, values); else log.warn(format, values);
        } catch (RuntimeException ignored) {
            log.warn("响应摘要生成失败 requestId={}", org.slf4j.MDC.get("requestId"));
        }
        return body;
    }
}
