package io.github.chenyilei2016.openplatform.configuration;

import io.github.chenyilei2016.openplatform.application.token.TokenSettings;
import io.github.chenyilei2016.openplatform.application.platform.PlatformSettings;
import io.github.chenyilei2016.openplatform.infrastructure.runtime.GatewayHttpSettings;
import io.github.chenyilei2016.openplatform.application.operations.OperationsSettings;
import java.time.Duration;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.cloud.autoconfigure.ConfigurationPropertiesRebinderAutoConfiguration;
import org.springframework.cloud.context.environment.EnvironmentChangeEvent;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.MapPropertySource;
import static org.assertj.core.api.Assertions.assertThat;

/** 只绑定配置，不创建 Web/数据库/定时任务服务。 */
class PropertiesBindingTest {
    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(strings = {"59s", "31d"})
    void tokenTtlStillRejectsOutOfRangeValues(String ttl) {
        new ApplicationContextRunner().withUserConfiguration(Bindings.class)
                .withPropertyValues("open-platform.token.ttl=" + ttl)
                .run(context -> assertThat(context).hasFailed());
    }

    @Test
    @ExtendWith(OutputCaptureExtension.class)
    void refreshRebindsAndResetsPropertiesWithoutDefaultInstanceWarnings(CapturedOutput output) {
        Map<String, Object> values = new HashMap<>(Map.of(
                "open-platform.token.ttl", "8d",
                "open-platform.operations.retention-days", "91",
                "open-platform.local-login.enabled", "false",
                "open-platform.local-login.identities[0].alias", "admin",
                "open-platform.local-login.identities[0].tenant-id", "tenant",
                "open-platform.local-login.identities[0].employee-no", "001"));
        new ApplicationContextRunner().withUserConfiguration(Bindings.class)
                .withConfiguration(AutoConfigurations.of(ConfigurationPropertiesRebinderAutoConfiguration.class))
                .withInitializer(context -> context.getEnvironment().getPropertySources()
                        .addFirst(new MapPropertySource("refresh-test", values)))
                .run(context -> {
                    TokenSettings token = context.getBean(TokenSettings.class);
                    OperationsSettings operations = context.getBean(OperationsSettings.class);
                    assertThat(token.ttl()).isEqualTo(Duration.ofDays(8));
                    assertThat(operations.getRetentionDays()).isEqualTo(91);
                    values.put("open-platform.token.ttl", "9d");
                    values.put("open-platform.operations.retention-days", "92");
                    context.publishEvent(new EnvironmentChangeEvent(context.getSourceApplicationContext(), Set.copyOf(values.keySet())));
                    assertThat(token.ttl()).isEqualTo(Duration.ofDays(9));
                    assertThat(operations.getRetentionDays()).isEqualTo(92);
                    Set<String> removed = Set.copyOf(values.keySet());
                    values.clear();
                    context.publishEvent(new EnvironmentChangeEvent(context.getSourceApplicationContext(), removed));
                    assertThat(token.ttl()).isEqualTo(Duration.ofDays(7));
                    assertThat(operations.getRetentionDays()).isEqualTo(90);
                    assertThat(output.getAll()).doesNotContain("Cannot create default instance");
                });
    }

    @Test
    void providerProofFailsAtAssemblyWithoutAnEnvironmentKey() {
        ApplicationContextRunner runner = new ApplicationContextRunner().withUserConfiguration(Bindings.class)
                .withBean(io.github.chenyilei2016.openplatform.infrastructure.runtime.GatewayProviderProof.class);
        runner.run(context -> assertThat(context).hasFailed());
        runner.withPropertyValues("open-platform.gateway.provider.key-id=test",
                        "open-platform.gateway.provider.private-key=invalid")
                .run(context -> assertThat(context).hasFailed());
        runner.withPropertyValues("open-platform.gateway.provider.key-id=test",
                        "open-platform.gateway.provider.private-key=" + io.github.chenyilei2016.openplatform.testing.ProviderProofTestSupport.PRIVATE_KEY)
                .run(context -> assertThat(context).hasFailed());
        runner.withPropertyValues("open-platform.environment-release.environment-id=local",
                        "open-platform.gateway.provider.key-id=test",
                        "open-platform.gateway.provider.private-key=" + io.github.chenyilei2016.openplatform.testing.ProviderProofTestSupport.PRIVATE_KEY)
                .run(context -> assertThat(context).hasNotFailed()
                        .hasSingleBean(io.github.chenyilei2016.openplatform.infrastructure.runtime.GatewayProviderProof.class));
    }

    @Test
    void centralizedScanBindsExistingKeysToConsumerContracts() {
        new ApplicationContextRunner().withUserConfiguration(Bindings.class)
                .withPropertyValues("open-platform.name=test-platform", "open-platform.token.ttl=8d",
                        "open-platform.operations.retention-days=91", "open-platform.operations.alerts.evaluation-enabled=false",
                        "open-platform.local-login.identities[0].alias=admin", "open-platform.local-login.identities[0].tenant-id=tenant",
                        "open-platform.local-login.identities[0].employee-no=employee")
                .run(context -> {
                    assertThat(context).hasNotFailed().hasSingleBean(PlatformSettings.class)
                            .hasSingleBean(TokenSettings.class)
                            .hasSingleBean(OperationsSettings.class);
                    assertThat(context.getBean(PlatformSettings.class).getName()).isEqualTo("test-platform");
                    assertThat(context.getBean(TokenSettings.class).ttl()).isEqualTo(Duration.ofDays(8));
                    assertThat(context.getBean(OperationsSettings.class).getRetentionDays()).isEqualTo(91);
                    assertThat(context.getBean(OperationsSettings.class).isEvaluationEnabled()).isFalse();
                });
    }

    @Configuration(proxyBeanMethods = false)
    @ConfigurationPropertiesScan("io.github.chenyilei2016.openplatform.infrastructure.properties")
    static class Bindings {}
}
