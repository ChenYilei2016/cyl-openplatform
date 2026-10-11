package io.github.chenyilei2016.openapi.sample;

import org.apache.dubbo.config.ApplicationConfig;
import org.apache.dubbo.config.ProtocolConfig;
import org.apache.dubbo.config.RegistryConfig;
import org.apache.dubbo.config.ServiceConfig;
import org.apache.dubbo.config.bootstrap.DubboBootstrap;
import org.apache.dubbo.rpc.service.EchoService;
import org.springframework.beans.factory.SmartInitializingSingleton;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.CommandLineRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;

/** Spring管理的服务配置先经过starter，宿主再导出；不手工登记SDK策略或Filter。 */
@Configuration(proxyBeanMethods = false)
public class SampleDubboConfiguration {
    @Bean(destroyMethod = "destroy")
    DubboBootstrap sampleDubbo(@Value("${sample.dubbo.port}") int port) {
        ApplicationConfig application = new ApplicationConfig("openapi-provider-sdk-sample");
        application.setQosEnable(false);
        ProtocolConfig protocol = new ProtocolConfig("dubbo", port);
        protocol.setSerialization("hessian2");
        protocol.setThreadpool("fixed");
        protocol.setThreads(2);
        protocol.setQueues(16);
        return DubboBootstrap.getInstance().application(application).registry(new RegistryConfig("N/A")).protocol(protocol);
    }

    @Bean
    ServiceConfig<SampleOperations> sampleService(SampleOperations operations) {
        ServiceConfig<SampleOperations> service = new ServiceConfig<>();
        service.setId("sampleOperations");
        service.setInterface(SampleOperations.class);
        service.setRef(operations);
        service.setRetries(0);
        return service;
    }

    @Bean
    ServiceConfig<EchoService> ordinaryInternalService() {
        ServiceConfig<EchoService> service = new ServiceConfig<>();
        service.setId("ordinaryInternalService");
        service.setInterface(EchoService.class);
        service.setRef(input -> input);
        service.setRetries(0);
        return service;
    }

    @Bean
    SmartInitializingSingleton sampleExport(DubboBootstrap bootstrap, ServiceConfig<SampleOperations> service,
                                           ServiceConfig<EchoService> ordinaryInternalService) {
        return () -> bootstrap.service(service).service(ordinaryInternalService).start();
    }

    @Bean
    CommandLineRunner sampleDubboAwait(DubboBootstrap bootstrap, Environment environment) {
        return args -> {
            if ("none".equalsIgnoreCase(environment.getProperty("spring.main.web-application-type"))) bootstrap.await();
        };
    }
}
