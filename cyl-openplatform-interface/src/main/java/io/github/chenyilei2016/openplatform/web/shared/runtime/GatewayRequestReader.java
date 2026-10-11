package io.github.chenyilei2016.openplatform.web.shared.runtime;

import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.github.chenyilei2016.openplatform.domain.runtime.GatewayRequestLimits;
import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.util.Collections;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import io.github.chenyilei2016.openplatform.web.shared.common.JsonRequestReader;

/** 正式/调试HTTP入口共享的原始请求边界；限额先于完整读取和JSON解析。 */
@Component
@RequiredArgsConstructor
public class GatewayRequestReader {
    private static final Set<String> IDENTITY_HEADERS = Set.of(
            "x-tenant-id", "x-user-id", "x-employee-id", "x-employee-no", "x-application-id", "x-app-key");
    private final GatewayRequestLimits limits;
    private final JsonRequestReader json;

    public Map<String, Object> readObject(HttpServletRequest request) throws IOException {
        for (String header : Collections.list(request.getHeaderNames())) {
            if (header.toLowerCase(Locale.ROOT).startsWith("x-sz-")) {
                throw new PlatformException(ErrorCode.INVALID_REQUEST, "此入口不接受签名认证Header");
            }
        }
        return parseObject(readBody(request));
    }

    public byte[] readBody(HttpServletRequest request) throws IOException {
        if (request.getQueryString() != null) {
            throw new PlatformException(ErrorCode.INVALID_REQUEST, "业务参数只能通过JSON请求体传入");
        }
        for (String header : Collections.list(request.getHeaderNames())) {
            String lower = header.toLowerCase(Locale.ROOT);
            if (lower.startsWith("x-open-platform-") || IDENTITY_HEADERS.contains(lower)) {
                throw new PlatformException(ErrorCode.INVALID_REQUEST, "请求不能指定可信身份Header");
            }
        }
        return json.readBytes(request, limits.maxRequestBytes());
    }
    public Map<String, Object> parseObject(byte[] bytes) { return json.parseObject(bytes); }
}
