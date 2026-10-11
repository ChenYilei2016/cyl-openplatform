package io.github.chenyilei2016.openplatform.infrastructure.identity;

import io.github.chenyilei2016.openplatform.application.identity.AccountAuthentication;
import io.github.chenyilei2016.openplatform.domain.access.EmployeeDirectory;
import io.github.chenyilei2016.openplatform.infrastructure.properties.identity.LocalAccountProperties;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration(proxyBeanMethods = false)
@ConditionalOnProperty(name = "open-platform.identity.provider", havingValue = "local", matchIfMissing = true)
public class LocalIdentityConfiguration {
    private final LocalAccountAdapter accounts;
    public LocalIdentityConfiguration(LocalAccountProperties properties) { accounts = new LocalAccountAdapter(properties); }
    @Bean @ConditionalOnMissingBean(AccountAuthentication.class)
    AccountAuthentication accountAuthentication() { return accounts; }
    @Bean @ConditionalOnMissingBean(EmployeeDirectory.class)
    EmployeeDirectory employeeDirectory() { return accounts::find; }
}
