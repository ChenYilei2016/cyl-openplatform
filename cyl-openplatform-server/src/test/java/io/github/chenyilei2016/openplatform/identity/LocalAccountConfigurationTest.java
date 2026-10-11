package io.github.chenyilei2016.openplatform.identity;

import io.github.chenyilei2016.openplatform.application.identity.AccountAuthentication;
import io.github.chenyilei2016.openplatform.domain.access.EmployeeDirectory;
import io.github.chenyilei2016.openplatform.infrastructure.identity.LocalIdentityConfiguration;
import io.github.chenyilei2016.openplatform.infrastructure.identity.LocalAccountAdapter;
import io.github.chenyilei2016.openplatform.infrastructure.properties.identity.LocalAccountProperties;
import org.junit.jupiter.api.Test;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

class LocalAccountConfigurationTest {
    private final ApplicationContextRunner context = new ApplicationContextRunner().withUserConfiguration(Config.class);
    @Test void localImplementationProvidesBothContractsWithoutExternalServices() {
        context.run(result -> assertThat(result).hasNotFailed().hasSingleBean(AccountAuthentication.class).hasSingleBean(EmployeeDirectory.class));
    }
    @Test void privateAdapterCanReplaceBothContracts() {
        context.withPropertyValues("open-platform.identity.provider=external")
                .withBean(AccountAuthentication.class, () -> mock(AccountAuthentication.class))
                .withBean(EmployeeDirectory.class, () -> mock(EmployeeDirectory.class))
                .run(result -> assertThat(result).hasNotFailed().doesNotHaveBean(LocalAccountAdapter.class)
                        .hasSingleBean(AccountAuthentication.class).hasSingleBean(EmployeeDirectory.class));
    }
    @Configuration(proxyBeanMethods = false)
    @EnableConfigurationProperties(LocalAccountProperties.class)
    @Import(LocalIdentityConfiguration.class)
    static class Config {}
}
