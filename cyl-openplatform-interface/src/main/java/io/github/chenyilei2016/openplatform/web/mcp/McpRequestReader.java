package io.github.chenyilei2016.openplatform.web.mcp;

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

/**
 * MCP 入口（117 第 7 节）的严格报文读取：只接受网关凭据的 SZ-HMAC 签名，身份只来自签名覆盖的 X-SZ 头。
 * 目录类请求可以不带租户（待签字符串中租户为空串）；是否必须带租户由方法决定，这里只校验格式。
 * 不放宽普通 /api/sign 的读取规则，也不接受旧的 X-MCP-User-* 身份头。
 */
@Component
@RequiredArgsConstructor
public class McpRequestReader {
    private static final Set<String> HEADERS = Set.of("x-sz-tenant", "x-sz-employee", "x-sz-timestamp", "x-sz-nonce");
    private static final String SUBJECT = "[\\x21-\\x2B\\x2D-\\x7E]{1,64}";
    private static final String SET_CODE = "[a-z][a-z0-9_-]{0,63}";
    private final GatewayRequestReader requests;

    /** setCode 为空表示总地址 /mcp/v1。 */
    public SignedRequest read(HttpServletRequest request, String setCode) throws IOException {
        String path = request.getRequestURI();
        String expected = request.getContextPath() + "/mcp/v1" + (setCode == null ? "" : "/sets/" + setCode);
        if ((setCode != null && !setCode.matches(SET_CODE)) || !path.equals(expected)
                || path.contains("%") || path.contains(";") || path.contains("//")) throw malformed();
        String contentType = single(request, "Content-Type", true);
        try {
            MediaType media = MediaType.parseMediaType(contentType);
            if (!media.getType().equalsIgnoreCase("application") || !media.getSubtype().equalsIgnoreCase("json")
                    || (media.getCharset() != null && !media.getCharset().equals(StandardCharsets.UTF_8))
                    || media.getParameters().keySet().stream().anyMatch(key -> !key.equalsIgnoreCase("charset"))) throw malformed();
        } catch (IllegalArgumentException failure) { throw malformed(); }
        if (request.getHeader("Content-Encoding") != null) throw malformed();
        // 本入口只供服务端网关使用；浏览器Origin不在接入范围内。
        if (request.getHeader("Origin") != null) throw new PlatformException(ErrorCode.FORBIDDEN, "MCP入口不接受浏览器来源请求");
        String protocol = single(request, "MCP-Protocol-Version", false);
        if (protocol != null && !protocol.equals("2025-06-18")) throw malformed();
        for (String header : Collections.list(request.getHeaderNames())) {
            String lower = header.toLowerCase(Locale.ROOT);
            if ((lower.startsWith("x-sz-") && !HEADERS.contains(lower)) || lower.startsWith("x-mcp-user-")) throw malformed();
        }
        String authorization = single(request, "Authorization", true);
        if (!authorization.matches("SZ-HMAC-SHA256 [a-f0-9]{32}:[a-f0-9]{64}"))
            throw new PlatformException(ErrorCode.INVALID_SIGNATURE, "签名认证格式无效");
        String tenant = single(request, "X-SZ-Tenant", false);
        String employee = single(request, "X-SZ-Employee", false);
        String timestamp = single(request, "X-SZ-Timestamp", true);
        String nonce = single(request, "X-SZ-Nonce", true);
        if ((tenant != null && !tenant.matches(SUBJECT)) || (employee != null && !employee.matches(SUBJECT))
                || (employee != null && tenant == null)
                || !timestamp.matches("[1-9][0-9]{0,10}") || !nonce.matches("[0-9a-f]{32}")) throw malformed();
        byte[] bytes = requests.readBody(request);
        try { StandardCharsets.UTF_8.newDecoder().decode(ByteBuffer.wrap(bytes)); }
        catch (CharacterCodingException failure) { throw malformed(); }
        String credential = authorization.substring("SZ-HMAC-SHA256 ".length());
        return new SignedRequest(path, credential.substring(0, 32), tenant == null ? "" : tenant, employee,
                Long.parseLong(timestamp), nonce, credential.substring(33), bytes);
    }

    private String single(HttpServletRequest request, String name, boolean required) {
        java.util.List<String> values = Collections.list(request.getHeaders(name));
        if (values.isEmpty()) {
            if (!required) return null;
            throw new PlatformException(ErrorCode.INVALID_SIGNATURE, "缺少签名认证信息");
        }
        if (values.size() != 1 || values.getFirst().isEmpty() || values.getFirst().contains(",")) throw malformed();
        return values.getFirst();
    }

    private PlatformException malformed() { return new PlatformException(ErrorCode.INVALID_REQUEST, "MCP 请求格式不合法"); }
}
