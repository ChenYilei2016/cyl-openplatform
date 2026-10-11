package io.github.chenyilei2016.openplatform.web.shared.observability;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import io.github.chenyilei2016.openplatform.application.common.SensitiveValues;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import tools.jackson.databind.json.JsonMapper;

/** 管理诊断与调用日志的短期展示值：脱敏并保留合法JSON，超限时返回摘要而非截断原文。 */
@Component
@RequiredArgsConstructor
public class DiagnosticContent {
    private static final int MAX_BYTES = 32 * 1024;
    private final JsonMapper json;
    public record Content(boolean available, boolean truncated, boolean redacted, Object value, String unavailableReason) {
        public static Content unavailable(String reason) { return new Content(false, false, false, null, reason); }
    }
    public record Message(String value, boolean truncated) {}

    public Content view(Object value) { return boundedView(value, MAX_BYTES); }
    /** 四份诊断内容各24KiB，为状态、身份和字段问题留出整体128KiB预算。 */
    public Content debugView(io.github.chenyilei2016.openplatform.domain.runtime.InvocationDiagnostics.Capture capture) {
        return capture.available() ? boundedView(capture.value(), 24 * 1024) : Content.unavailable("尚未产生此内容，或提供方没有返回可读取的JSON");
    }
    private Content boundedView(Object value, int limit) {
        boolean[] redacted = {false};
        // 先统一record/Bean与Map的JSON形态，避免公开响应包装绕过递归脱敏。
        Object safe = clean(json.convertValue(value, Object.class), redacted);
        byte[] bytes = json.writeValueAsBytes(safe);
        if (bytes.length > limit) return new Content(true, true, redacted[0], Map.of("summary", "内容超过展示预算，请缩小样例后查看", "bytes", bytes.length), null);
        return new Content(true, false, redacted[0], safe, null);
    }
    /** 运行日志保留有界JSON文本前缀；与页面共用脱敏，截断不切开UTF-8字符。 */
    public Message logSummary(Object value, int maxBytes) {
        Object safe = clean(json.convertValue(value, Object.class), new boolean[]{false});
        byte[] bytes = json.writeValueAsBytes(safe);
        int end = Math.min(bytes.length, maxBytes);
        while (end < bytes.length && end > 0 && (bytes[end] & 0xC0) == 0x80) end--;
        return new Message(new String(bytes, 0, end, java.nio.charset.StandardCharsets.UTF_8), end < bytes.length);
    }
    public Message message(String value) {
        if (value == null) return null;
        String safe = SensitiveValues.redactText(value);
        return new Message(safe.substring(0, Math.min(safe.length(), 500)), safe.length() > 500);
    }
    private Object clean(Object value, boolean[] redacted) {
        if (value instanceof Map<?, ?> object) {
            Map<String, Object> result = new LinkedHashMap<>();
            object.forEach((key, item) -> {
                String name = key.toString();
                if (SensitiveValues.sensitiveName(name)) {
                    result.put(name, "[已脱敏]"); redacted[0] = true;
                } else result.put(name, clean(item, redacted));
            });
            return result;
        }
        if (value instanceof List<?> list) return list.stream().map(item -> clean(item, redacted)).toList();
        if (value instanceof String text) {
            String safe = SensitiveValues.redactText(text);
            redacted[0] |= !text.equals(safe);
            return safe;
        }
        return value;
    }
}
