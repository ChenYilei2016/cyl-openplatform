package io.github.chenyilei2016.example.order.rpc;

import org.apache.dubbo.config.ApplicationConfig;
import org.apache.dubbo.config.ProtocolConfig;
import org.apache.dubbo.config.RegistryConfig;
import org.apache.dubbo.config.ServiceConfig;
import org.apache.dubbo.config.bootstrap.DubboBootstrap;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.SmartInitializingSingleton;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;

import java.net.URI;
import java.util.Map;

/** 独立示例专属 Dubbo 模型，关闭 Spring 时释放端口、服务和线程。 */
@Configuration(proxyBeanMethods = false)
public class OrderDubboConfiguration {
    private static final Logger LOG = LoggerFactory.getLogger(OrderDubboConfiguration.class);

    @Bean(destroyMethod = "destroy")
    DubboBootstrap orderDubboBootstrap(
            @Value("${example.order.dubbo.port:20881}") int port,
            Environment environment) {
        if (port != -1 && (port < 1 || port > 65535))
            throw new IllegalArgumentException("Dubbo 端口必须是 -1 或 1–65535");
        DubboBootstrap bootstrap = DubboBootstrap.newInstance();
        try {
            ApplicationConfig application = new ApplicationConfig("example-order-provider");
            application.setQosEnable(false);
            ProtocolConfig protocol = new ProtocolConfig("dubbo", port);
            // Dubbo 将 127.* 判为 anyhost；使用原生 IPv6 回环确保只监听本机。
            protocol.setHost(environment.getProperty("example.order.dubbo.host", "::1"));
            protocol.setSerialization("hessian2");
            protocol.setThreadpool("fixed");
            protocol.setThreads(32);
            protocol.setQueues(0);
            protocol.setPayload(327680);
            String address = environment.getProperty("example.order.dubbo.registry.address", "N/A");
            RegistryConfig registry = new RegistryConfig(address);
            if (!"N/A".equals(address)) {
                URI registryUri = URI.create(address);
                if (!"nacos".equals(registryUri.getScheme())
                        || registryUri.getHost() == null
                        || registryUri.getPort() < 1
                        || registryUri.getPort() > 65535
                        || registryUri.getUserInfo() != null
                        || registryUri.getQuery() != null
                        || registryUri.getFragment() != null
                        || (registryUri.getPath() != null && !registryUri.getPath().isEmpty())) {
                    throw new IllegalArgumentException("注册中心地址必须是 nacos://host:port，认证信息单独配置");
                }
                registry.setRegisterMode("interface");
                registry.setUseAsConfigCenter(false);
                registry.setUseAsMetadataCenter(false);
                registry.setGroup(
                        environment.getProperty(
                                "example.order.dubbo.registry.group", "cyl-openplatform-example"));
                registry.setUsername(
                        environment.getProperty("example.order.dubbo.registry.username", ""));
                registry.setPassword(
                        environment.getProperty("example.order.dubbo.registry.password", ""));
                registry.setParameters(
                        Map.of(
                                "namespace",
                                environment.getProperty(
                                        "example.order.dubbo.registry.namespace", "dev")));
            }
            bootstrap
                    .application(application)
                    .registry(registry)
                    .protocol(protocol);
            return bootstrap;
        } catch (RuntimeException | Error failure) {
            bootstrap.destroy();
            throw failure;
        }
    }
    @Bean
    ServiceConfig<OrderQueryFacade> orderDubboService(DubboBootstrap bootstrap, OrderQueryFacadeImpl facade, Environment environment) {
        ServiceConfig<OrderQueryFacade> service = new ServiceConfig<>();
        service.setId("orderQueryFacade");
        service.setScopeModel(bootstrap.getApplicationModel().getDefaultModule());
        service.setInterface(OrderQueryFacade.class);
        service.setRef(facade);
        service.setVersion("1.0.0");
        service.setGroup(environment.getProperty("example.order.dubbo.service-group", "order-example"));
        service.setScope("remote");
        service.setRetries(0);
        return service;
    }

    @Bean
    SmartInitializingSingleton orderDubboExport(DubboBootstrap bootstrap, ServiceConfig<OrderQueryFacade> service) {
        return () -> {
            bootstrap.service(service).start();
            LOG.info("Order Dubbo provider listening on port {}", service.getExportedUrls().getFirst().getPort());
        };
    }
}
