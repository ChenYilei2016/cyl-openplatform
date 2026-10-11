package io.github.chenyilei2016.openplatform.web.openapi.signature;

import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.github.chenyilei2016.openplatform.domain.signature.SignedRequest;
import io.github.chenyilei2016.openplatform.web.shared.runtime.GatewayRequestReader;
import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.Locale;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;

/** 签名入口严格单值头与原始路径/UTF8正文；不放宽其他入口的可信身份限制。 */
@Component
@RequiredArgsConstructor
public class SignatureRequestReader {
    private static final Set<String> HEADERS = Set.of("x-sz-tenant", "x-sz-employee", "x-sz-timestamp", "x-sz-nonce");
    private static final String SUBJECT = "[\\x21-\\x2B\\x2D-\\x7E]{1,64}";
    private final GatewayRequestReader requests;

    public SignedRequest read(HttpServletRequest request, String service, String version, String method) throws IOException {
        String path = request.getRequestURI();
        if (!service.matches("[A-Za-z0-9][A-Za-z0-9_.-]{0,63}") || !version.matches("[A-Za-z0-9][A-Za-z0-9_.-]{0,31}")
                || !method.matches("[A-Za-z0-9][A-Za-z0-9_.-]{0,63}")
                || !path.equals(request.getContextPath() + "/api/sign/" + service + "/" + version + "/" + method)
                || path.contains("%") || path.contains(";") || path.contains("//")
                || path.matches(".*(?:^|/)\\.\\.?(?:/|$).*")) throw malformed();
        String contentType = single(request, "Content-Type", true);
        try {
            MediaType media = MediaType.parseMediaType(contentType);
            if (!media.getType().equalsIgnoreCase("application") || !media.getSubtype().equalsIgnoreCase("json")
                    || (media.getCharset() != null && !media.getCharset().equals(StandardCharsets.UTF_8))
                    || media.getParameters().keySet().stream().anyMatch(key -> !key.equalsIgnoreCase("charset"))) throw malformed();
        } catch (IllegalArgumentException failure) { throw malformed(); }
        if (request.getHeader("Content-Encoding") != null) throw malformed();
        for (String header : Collections.list(request.getHeaderNames())) {
            String lower = header.toLowerCase(Locale.ROOT);
            if (lower.startsWith("x-sz-") && !HEADERS.contains(lower)) throw malformed();
        }
        String authorization = single(request, "Authorization", true);
        if (authorization.startsWith("Bearer ")) throw malformed();
        if (!authorization.matches("SZ-HMAC-SHA256 [a-f0-9]{32}:[a-f0-9]{64}")) {
            throw new PlatformException(ErrorCode.INVALID_SIGNATURE, "签名认证格式无效");
        }
        String tenant = single(request, "X-SZ-Tenant", true);
        String employee = single(request, "X-SZ-Employee", false);
        String timestamp = single(request, "X-SZ-Timestamp", true);
        String nonce = single(request, "X-SZ-Nonce", true);
        if (!tenant.matches(SUBJECT) || (employee != null && !employee.matches(SUBJECT))
                || !timestamp.matches("[1-9][0-9]{0,10}") || !nonce.matches("[0-9a-f]{32}")) throw malformed();
        byte[] bytes = requests.readBody(request);
        try { StandardCharsets.UTF_8.newDecoder().decode(ByteBuffer.wrap(bytes)); }
        catch (CharacterCodingException failure) { throw malformed(); }
        String credential = authorization.substring("SZ-HMAC-SHA256 ".length());
        return new SignedRequest(path, credential.substring(0, 32), tenant, employee,
                Long.parseLong(timestamp), nonce, credential.substring(33), bytes);
    }

    private String single(HttpServletRequest request, String name, boolean required) {
        var values = Collections.list(request.getHeaders(name));
        if (values.isEmpty()) {
            if (!required) return null;
            throw new PlatformException(ErrorCode.INVALID_SIGNATURE, "缺少签名认证信息");
        }
        if (values.size() != 1 || values.getFirst().isEmpty() || values.getFirst().contains(",")) throw malformed();
        return values.getFirst();
    }

    private PlatformException malformed() { return new PlatformException(ErrorCode.INVALID_REQUEST, "签名请求格式不合法"); }
}
