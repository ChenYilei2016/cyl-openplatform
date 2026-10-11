package io.github.chenyilei2016.openplatform.web.shared.common;

import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.json.JsonMapper;

/** 在完整读取之前限制请求字节数，并复用全局JSON结构约束。 */
@Component
@RequiredArgsConstructor
public class JsonRequestReader {
    private final JsonMapper json;

    public Map<String, Object> readObject(HttpServletRequest request, int maxBytes) throws IOException {
        return parseObject(readBytes(request, maxBytes));
    }

    public byte[] readBytes(HttpServletRequest request, int maxBytes) throws IOException {
        if (request.getContentLengthLong() > maxBytes) {
            throw new PlatformException(ErrorCode.REQUEST_TOO_LARGE, ErrorCode.REQUEST_TOO_LARGE.getMessage());
        }
        byte[] bytes = request.getInputStream().readNBytes(maxBytes + 1);
        if (bytes.length > maxBytes) {
            throw new PlatformException(ErrorCode.REQUEST_TOO_LARGE, ErrorCode.REQUEST_TOO_LARGE.getMessage());
        }
        return bytes;
    }

    public Map<String, Object> parseObject(byte[] bytes) {
        Object body;
        try {
            body = json.readerFor(Object.class).with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS).readValue(bytes);
        } catch (RuntimeException exception) {
            throw new PlatformException(ErrorCode.INVALID_REQUEST, "请求必须是合法JSON对象");
        }
        if (!(body instanceof Map<?, ?>)) {
            throw new PlatformException(ErrorCode.INVALID_REQUEST, "请求必须是JSON对象");
        }
        @SuppressWarnings("unchecked")
        Map<String, Object> input = (Map<String, Object>) body;
        return input;
    }
}
