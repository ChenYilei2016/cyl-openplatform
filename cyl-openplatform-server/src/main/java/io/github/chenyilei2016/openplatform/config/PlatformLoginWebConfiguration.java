package io.github.chenyilei2016.openplatform.config;

import io.github.chenyilei2016.openplatform.identity.PlatformLoginInterceptor;
import io.github.chenyilei2016.openplatform.infrastructure.properties.platform.LoginProperties;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class PlatformLoginWebConfiguration implements WebMvcConfigurer {
    private final PlatformLoginInterceptor login;
    private final LoginProperties properties;

    public PlatformLoginWebConfiguration(PlatformLoginInterceptor login, LoginProperties properties) {
        this.login = login;
        this.properties = properties;
    }

    @Override public void addInterceptors(InterceptorRegistry registry) {
        if (!properties.getRequiredPathPatterns().containsAll(java.util.List.of("/admin-api/**", "/portal-api/**")))
            throw new IllegalStateException("open-platform.login.required-path-patterns必须包含管理与门户会话入口");
        registry.addInterceptor(login).addPathPatterns(properties.getRequiredPathPatterns()).order(org.springframework.core.Ordered.HIGHEST_PRECEDENCE + 11);
    }
}
