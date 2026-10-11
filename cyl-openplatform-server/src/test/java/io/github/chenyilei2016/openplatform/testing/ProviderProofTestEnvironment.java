package io.github.chenyilei2016.openplatform.testing;

import java.util.Map;
import org.springframework.boot.EnvironmentPostProcessor;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.context.config.ConfigDataEnvironmentPostProcessor;
import org.springframework.core.Ordered;
import org.springframework.core.env.ConfigurableEnvironment;
import org.springframework.core.env.MapPropertySource;

/** 仅在测试classpath注册，同时覆盖SpringBootTest与独立测试ApplicationBuilder。 */
public final class ProviderProofTestEnvironment implements EnvironmentPostProcessor, Ordered {
    @Override public void postProcessEnvironment(ConfigurableEnvironment environment, SpringApplication application) {
        environment.getPropertySources().addFirst(new MapPropertySource("ephemeral-provider-test-keys", Map.of(
                "open-platform.gateway.provider.private-key", ProviderProofTestSupport.PRIVATE_KEY)));
    }
    @Override public int getOrder() { return ConfigDataEnvironmentPostProcessor.ORDER + 1; }
}
