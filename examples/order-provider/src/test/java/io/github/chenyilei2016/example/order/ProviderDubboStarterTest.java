package io.github.chenyilei2016.example.order;

import io.github.chenyilei2016.openplatform.provider.*;
import io.github.chenyilei2016.openplatform.provider.dubbo.OpenPlatformDubboFilter;
import io.github.chenyilei2016.openplatform.provider.dubbo.OpenPlatformDubboSecurity;
import io.github.chenyilei2016.openplatform.provider.mvc.OpenPlatformProviderAutoConfiguration;
import org.apache.dubbo.config.*;
import org.apache.dubbo.config.bootstrap.DubboBootstrap;
import org.apache.dubbo.config.spring.ServiceBean;
import org.apache.dubbo.rpc.Filter;
import org.apache.dubbo.rpc.RpcContext;
import org.apache.dubbo.rpc.model.ModuleModel;
import org.junit.jupiter.api.Test;
import org.springframework.aop.framework.ProxyFactory;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.time.Clock;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;
import static org.junit.jupiter.api.Assertions.*;

/** 实际ServiceBean、Spring代理及非Spring显式模型分别通过TCP；两套密钥不得串模型。 */
class ProviderDubboStarterTest {
    @OpenPlatformApi
    public interface TenantService { String tenant(); }

    public static class TenantServiceImpl implements TenantService {
        public String tenant() { return OpenPlatformContext.requireIdentity().getTenantId(); }
    }

    @Test
    void springServiceBeanAndManualModelAuthenticateIndependentlyAndClose() throws Exception {
        KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
        generator.initialize(2048);
        KeyPair otherKeys = generator.generateKeyPair();
        ProtocolConfig autoProtocol = protocol();
        ProtocolConfig manualProtocol = protocol();
        DubboBootstrap automatic = bootstrap("sdk-auto", autoProtocol);
        DubboBootstrap manual = bootstrap("sdk-manual", manualProtocol);
        DubboBootstrap consumer = bootstrap("sdk-client", protocol());
        AnnotationConfigApplicationContext context = new AnnotationConfigApplicationContext();
        ReferenceConfig<TenantService> first = new ReferenceConfig<>();
        ReferenceConfig<TenantService> second = new ReferenceConfig<>();
        try {
            ModuleModel module = automatic.getApplicationModel().getDefaultModule();
            context.registerBean(ModuleModel.class.getName(), ModuleModel.class, () -> module);
            context.registerBean(OpenPlatformVerifier.class, ProviderProofFixture::verifier);
            context.register(OpenPlatformProviderAutoConfiguration.class);
            context.registerBean("tenantService", ServiceBean.class, () -> {
                ServiceBean<TenantService> service = new ServiceBean<>(context, module);
                service.setId("tenant-auto");
                service.setInterface(TenantService.class);
                service.setRef((TenantService) new ProxyFactory(new TenantServiceImpl()).getProxy());
                service.setScope("remote");
                service.setProtocol(autoProtocol);
                service.setRegistry(new RegistryConfig("N/A"));
                return service;
            });
            context.refresh();
            ServiceBean<?> automaticService = context.getBean(ServiceBean.class);
            automatic.service(automaticService).start();

            ServiceConfig<TenantService> manualService = new ServiceConfig<>();
            manualService.setId("tenant-manual");
            manualService.setScopeModel(manual.getApplicationModel().getDefaultModule());
            manualService.setInterface(TenantService.class);
            manualService.setRef(new TenantServiceImpl());
            manualService.setScope("remote");
            manualService.setProtocol(manualProtocol);
            manualService.setRegistry(new RegistryConfig("N/A"));
            OpenPlatformDubboFilter filter = (OpenPlatformDubboFilter) manualService.getScopeModel()
                    .getExtensionLoader(Filter.class).getExtension("openPlatform");
            filter.setOpenPlatformDubboSecurity(new OpenPlatformDubboSecurity(
                    new OpenPlatformVerifier("local", Collections.singletonMap("test", otherKeys.getPublic()), Clock.systemUTC()),
                    Collections.singletonMap(TenantService.class, TenantServiceImpl.class)));
            manual.service(manualService).start();
            assertNotEquals(automaticService.getExportedUrls().getFirst().getPort(), manualService.getExportedUrls().getFirst().getPort(), "两个宿主必须使用独立TCP端口");

            configure(first, automaticService, consumer);
            configure(second, manualService, consumer);
            consumer.reference(first).reference(second).start();
            TenantService autoClient = first.get();
            TenantService manualClient = second.get();
            attachments(ProviderProofFixture.SIGNER, "tenant-one");
            assertEquals("tenant-one", autoClient.tenant(), () -> "SDK错误=" + RpcContext.getServerContext().getAttachment("x-open-platform-error")
                    + ", group=" + automaticService.getExportedUrls().getFirst().getParameter("group", "")
                    + ", version=" + automaticService.getExportedUrls().getFirst().getParameter("version", ""));
            OpenPlatformSigner other = new OpenPlatformSigner("local", "test", otherKeys.getPrivate(), Clock.systemUTC());
            attachments(other, "tenant-two");
            assertEquals("tenant-two", manualClient.tenant());
            attachments(ProviderProofFixture.SIGNER, "tenant-one");
            assertNull(manualClient.tenant());
            assertEquals("403", RpcContext.getServerContext().getAttachment("x-open-platform-status"));
            assertFalse(OpenPlatformContext.current().isPresent());
        } finally {
            first.destroy();
            second.destroy();
            consumer.destroy();
            context.close();
            automatic.destroy();
            manual.destroy();
            RpcContext.removeContext();
        }
    }

    private static DubboBootstrap bootstrap(String name, ProtocolConfig protocol) {
        ApplicationConfig application = new ApplicationConfig(name);
        application.setQosEnable(false);
        return DubboBootstrap.newInstance().application(application).registry(new RegistryConfig("N/A")).protocol(protocol);
    }

    private static ProtocolConfig protocol() throws java.io.IOException {
        int port;
        try (java.net.ServerSocket listener = new java.net.ServerSocket()) {
            listener.bind(new java.net.InetSocketAddress("::1", 0));
            port = listener.getLocalPort();
        }
        ProtocolConfig protocol = new ProtocolConfig("dubbo", port);
        protocol.setHost("::1");
        protocol.setThreads(2);
        protocol.setQueues(16);
        return protocol;
    }

    private static void configure(ReferenceConfig<TenantService> reference, ServiceConfig<?> service, DubboBootstrap consumer) {
        reference.setScopeModel(consumer.getApplicationModel().getDefaultModule());
        reference.setInterface(TenantService.class);
        reference.setUrl(service.getExportedUrls().getFirst().toIdentityString());
        reference.setRetries(0);
        reference.setTimeout(5000);
    }

    private static void attachments(OpenPlatformSigner signer, String tenant) {
        Map<String, String> identity = new HashMap<>();
        identity.put("x-open-platform-application-id", "sdk-test");
        identity.put("x-open-platform-app-key", "test-key");
        identity.put("x-open-platform-tenant-id", tenant);
        identity.put("x-request-id", "sdk-model-check");
        RpcContext.getContext().setAttachments(signer.sign(identity,
                OpenPlatformTarget.dubbo(TenantService.class.getName(), "", "", "tenant", Collections.emptyList())));
    }
}
