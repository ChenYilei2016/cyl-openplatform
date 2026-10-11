package io.github.chenyilei2016.openplatform.identity;

import io.github.chenyilei2016.openplatform.application.identity.AccountAuthentication;
import jakarta.servlet.http.HttpServletRequest;

/** Web身份SPI：部署方可适配会话、SSO Cookie或回调，不向核心业务暴露SDK类型。 */
public interface BrowserIdentityProvider {
    AccountAuthentication.Account current(HttpServletRequest request);
    String csrfToken(HttpServletRequest request);
    void verifyMutation(HttpServletRequest request);
}
