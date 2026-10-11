package io.github.chenyilei2016.openplatform.provider.mvc;

import static org.junit.jupiter.api.Assertions.*;

import io.github.chenyilei2016.openplatform.provider.CurrentOpenPlatformIdentity;

import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Bean;
import org.apache.dubbo.config.ServiceConfig;
import io.github.chenyilei2016.openplatform.provider.OpenPlatformApi;
import org.springframework.core.env.MapPropertySource;
import org.springframework.mock.web.MockServletContext;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.context.support.AnnotationConfigWebApplicationContext;
import org.springframework.web.servlet.config.annotation.EnableWebMvc;

import java.util.HashMap;
import java.util.Map;

class OpenPlatformStartupTest {
    @Configuration
    @EnableWebMvc
    static class WebConfiguration {}

    @OpenPlatformApi
    interface DubboContract { String query(); }

    @Configuration
    static class DubboOnlyConfiguration {
        @Bean
        ServiceConfig<DubboContract> protectedDubboService() {
            ServiceConfig<DubboContract> service = new ServiceConfig<>();
            service.setId("protocol-selection-check");
            service.setInterface(DubboContract.class);
            service.setRef(() -> "sample");
            return service;
        }
    }

    @Test
    void servletHostMayUseOnlyDubboWithoutDeclaringHttpProtection() {
        try (AnnotationConfigWebApplicationContext context = context(true, false, false)) {
            context.register(DubboOnlyConfiguration.class);
            assertDoesNotThrow(context::refresh);
        }
    }

    @RestController
    static class InvalidParameter {
        @GetMapping("/invalid")
        String invalid(@CurrentOpenPlatformIdentity String identity) {
            return identity;
        }
    }

    private AnnotationConfigWebApplicationContext context(
            boolean hasPublicKey, boolean paths, boolean invalidParameter) {
        AnnotationConfigWebApplicationContext context = new AnnotationConfigWebApplicationContext();
        context.setServletContext(new MockServletContext());
        Map<String, Object> properties = new HashMap<>();
        properties.put("open-platform.provider.environment-id", "local");
        if (hasPublicKey) properties.put("open-platform.provider.public-keys.test",
                java.util.Base64.getEncoder().encodeToString(ProviderProofFixture.KEYS.getPublic().getEncoded()));
        if (paths) properties.put("open-platform.provider.protected-paths[0]", "/safe/**");
        context.getEnvironment()
                .getPropertySources()
                .addFirst(new MapPropertySource("sdk-test", properties));
        context.register(WebConfiguration.class, OpenPlatformProviderAutoConfiguration.class);
        if (invalidParameter) context.register(InvalidParameter.class);
        return context;
    }

    @Test
    void missingPublicKeysAndProtectionFailDuringStartup() {
        try (AnnotationConfigWebApplicationContext context = context(false, true, false)) {
            assertThrows(Exception.class, context::refresh);
        }
        try (AnnotationConfigWebApplicationContext context =
                context(true, false, false)) {
            assertThrows(Exception.class, context::refresh);
        }
        try (AnnotationConfigWebApplicationContext context =
                context(true, true, false)) {
            assertDoesNotThrow(context::refresh);
        }
    }

    @Test
    void wrongIdentityParameterTypeFailsBeforeReceivingTraffic() {
        try (AnnotationConfigWebApplicationContext context =
                context(true, false, true)) {
            assertThrows(Exception.class, context::refresh);
        }
    }
}
