package io.github.chenyilei2016.openplatform.identity;

import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;

/** 仅服务端会话保存账号和CSRF随机值，客户端不能声明身份。 */
public final class BrowserSession {
    public static final String ACCOUNT = BrowserSession.class.getName() + ".account";
    public static final String CSRF_HEADER = "X-CSRF-Token";
    private static final String CSRF = BrowserSession.class.getName() + ".csrf";
    private static final SecureRandom RANDOM = new SecureRandom();
    private BrowserSession() {}

    public static String csrf(HttpServletRequest request) {
        HttpSession session = request.getSession(true);
        synchronized (session) {
            if (session.getAttribute(CSRF) instanceof String token) return token;
            byte[] bytes = new byte[32];
            RANDOM.nextBytes(bytes);
            String token = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
            session.setAttribute(CSRF, token);
            return token;
        }
    }

    public static void requireCsrf(HttpServletRequest request) {
        HttpSession session = request.getSession(false);
        String supplied = request.getHeader(CSRF_HEADER);
        if (session == null || !(session.getAttribute(CSRF) instanceof String expected) || supplied == null
                || !MessageDigest.isEqual(expected.getBytes(StandardCharsets.UTF_8), supplied.getBytes(StandardCharsets.UTF_8)))
            throw new PlatformException(ErrorCode.FORBIDDEN, "操作凭据已失效，请刷新页面");
    }

    public static String username(HttpServletRequest request) {
        HttpSession session = request.getSession(false);
        if (session == null || !(session.getAttribute(ACCOUNT) instanceof String username))
            throw new PlatformException(ErrorCode.UNAUTHENTICATED, "请使用平台账号登录");
        return username;
    }
}
