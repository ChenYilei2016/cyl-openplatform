package io.github.chenyilei2016.openplatform.identity;

import io.github.chenyilei2016.openplatform.application.identity.AccountAuthentication;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration(proxyBeanMethods = false)
@ConditionalOnProperty(name = "open-platform.identity.provider", havingValue = "local", matchIfMissing = true)
public class LocalBrowserIdentityConfiguration {
    @Bean @ConditionalOnMissingBean(BrowserIdentityProvider.class)
    BrowserIdentityProvider browserIdentityProvider(AccountAuthentication accounts) {
        return new BrowserIdentityProvider() {
            @Override public AccountAuthentication.Account current(HttpServletRequest request) {
                return accounts.current(BrowserSession.username(request));
            }
            @Override public String csrfToken(HttpServletRequest request) { return BrowserSession.csrf(request); }
            @Override public void verifyMutation(HttpServletRequest request) { BrowserSession.requireCsrf(request); }
        };
    }
}
