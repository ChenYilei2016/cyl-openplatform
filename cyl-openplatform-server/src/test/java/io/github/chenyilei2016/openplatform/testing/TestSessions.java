package io.github.chenyilei2016.openplatform.testing;

import io.github.chenyilei2016.openplatform.identity.BrowserSession;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.util.DigestUtils;
import java.nio.charset.StandardCharsets;

/** 业务用例直接建立服务端会话；账号登录与随机CSRF另有真实边界回归。 */
public final class TestSessions {
    private TestSessions() {}
    public static MockHttpSession session(String username) {
        MockHttpSession session = new MockHttpSession();
        session.setAttribute(BrowserSession.ACCOUNT, username);
        session.setAttribute(BrowserSession.class.getName() + ".csrf", DigestUtils.md5DigestAsHex(username.getBytes(StandardCharsets.UTF_8)));
        return session;
    }
}
