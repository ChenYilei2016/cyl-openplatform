package io.github.chenyilei2016.openplatform.provider.mvc;

import io.github.chenyilei2016.openplatform.provider.CurrentOpenPlatformIdentity;
import io.github.chenyilei2016.openplatform.provider.OpenPlatformIdentity;
import io.github.chenyilei2016.openplatform.provider.OpenPlatformVerifier;
import io.github.chenyilei2016.openplatform.provider.OpenPlatformKeys;
import java.security.PublicKey;
import java.time.Clock;
import java.util.Map;
import java.util.LinkedHashMap;

import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.SmartInitializingSingleton;
import org.springframework.boot.autoconfigure.condition.ConditionalOnClass;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.beans.factory.config.BeanPostProcessor;
import org.springframework.aop.framework.AopProxyUtils;
import io.github.chenyilei2016.openplatform.provider.dubbo.OpenPlatformDubboRegistration;
import org.apache.dubbo.config.ServiceConfig;
import java.util.function.Consumer;
import java.util.function.BooleanSupplier;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.MethodParameter;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.method.support.HandlerMethodArgumentResolver;
import org.springframework.web.servlet.DispatcherServlet;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;

import java.util.List;

@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(OpenPlatformProviderProperties.class)
public class OpenPlatformProviderAutoConfiguration {
    @Bean
    @ConditionalOnMissingBean(OpenPlatformVerifier.class)
    public OpenPlatformVerifier openPlatformVerifier(OpenPlatformProviderProperties properties) {
        Map<String, PublicKey> keys = new LinkedHashMap<>();
        if (properties.getPublicKeys() == null || properties.getPublicKeys().size() > 2)
            throw new IllegalArgumentException("提供方环境公钥最多两把");
        properties.getPublicKeys().forEach((id, value) -> keys.put(id, OpenPlatformKeys.publicKey(value)));
        return new OpenPlatformVerifier(properties.getEnvironmentId(), keys, Clock.systemUTC());
    }

    @Configuration(proxyBeanMethods = false)
    @ConditionalOnClass(DispatcherServlet.class)
    @ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
    static class MvcConfiguration {
        @Bean
        public OpenPlatformMvcInterceptor openPlatformMvcInterceptor(
                OpenPlatformVerifier verifier, OpenPlatformProviderProperties properties) {
            return new OpenPlatformMvcInterceptor(verifier, properties.getProtectedPaths());
        }

        @Bean
        public WebMvcConfigurer openPlatformMvcConfigurer(OpenPlatformMvcInterceptor interceptor) {
            return new WebMvcConfigurer() {
                @Override
                public void addInterceptors(InterceptorRegistry registry) {
                    registry.addInterceptor(interceptor).order(Integer.MIN_VALUE);
                }

                @Override
                public void addArgumentResolvers(List<HandlerMethodArgumentResolver> resolvers) {
                    resolvers.add(new OpenPlatformIdentityArgumentResolver());
                }
            };
        }

        @Bean
        public SmartInitializingSingleton openPlatformProtectionCheck(
                OpenPlatformProviderProperties properties,
                ObjectProvider<RequestMappingHandlerMapping> mappings,
                @Qualifier("openPlatformDubboProtection") ObjectProvider<BooleanSupplier> dubboProtection) {
            return () -> {
                boolean protectedEndpoint = !properties.getProtectedPaths().isEmpty();
                for (RequestMappingHandlerMapping mapping : mappings) {
                    for (HandlerMethod handler : mapping.getHandlerMethods().values()) {
                        protectedEndpoint |= OpenPlatformMvcInterceptor.policy(handler).isProtected();
                        for (MethodParameter parameter : handler.getMethodParameters())
                            if (parameter.hasParameterAnnotation(CurrentOpenPlatformIdentity.class)
                                    && parameter.getParameterType() != OpenPlatformIdentity.class)
                                throw new IllegalStateException("@CurrentOpenPlatformIdentity参数类型错误");
                    }
                }
                BooleanSupplier dubbo = dubboProtection.getIfAvailable();
                if (!protectedEndpoint && (dubbo == null || !dubbo.getAsBoolean()))
                    throw new IllegalStateException(
                            "请配置open-platform.provider.protected-paths或标注开放平台受保护入口");
            };
        }
    }

    @Configuration(proxyBeanMethods = false)
    @ConditionalOnClass(name = "org.apache.dubbo.config.ServiceConfig")
    static class DubboConfiguration {
        @Bean
        BooleanSupplier openPlatformDubboProtection(ObjectProvider<ServiceConfig<?>> services) {
            return () -> services.stream().anyMatch(service -> OpenPlatformDubboRegistration.protectedService(
                    service, AopProxyUtils.ultimateTargetClass(service.getRef())));
        }

        @Bean
        static BeanPostProcessor openPlatformDubboServices(ObjectProvider<OpenPlatformVerifier> verifier) {
            return new BeanPostProcessor() {
                @Override
                public Object postProcessBeforeInitialization(Object bean, String beanName) {
                    if (bean instanceof ServiceConfig) {
                        ServiceConfig<?> service = (ServiceConfig<?>) bean;
                        if (service.isExported() && OpenPlatformDubboRegistration.protectedService(service, AopProxyUtils.ultimateTargetClass(service.getRef())))
                            throw new IllegalStateException("平台ServiceConfig已在Spring初始化前导出；请在Bean初始化后导出或使用显式非Spring登记");
                        Consumer<ServiceConfig<?>> beforeExport = configured -> {
                            Class<?> targetType = AopProxyUtils.ultimateTargetClass(configured.getRef());
                            try {
                                OpenPlatformDubboRegistration.bind(configured, verifier.getObject(), targetType);
                            } catch (IllegalArgumentException | IllegalStateException failure) {
                                throw new IllegalStateException("Dubbo bean " + beanName + " 无法登记平台策略；请提供真实Spring目标或使用显式非Spring登记", failure);
                            }
                        };
                        service.getServiceMetadata().addAttribute(OpenPlatformDubboRegistration.BEFORE_EXPORT_ATTRIBUTE, beforeExport);
                    }
                    return bean;
                }
            };
        }
    }
}
