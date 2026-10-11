package io.github.chenyilei2016.openapi.sample;

import org.apache.dubbo.config.*;
import org.apache.dubbo.config.bootstrap.DubboBootstrap;
import org.apache.dubbo.rpc.RpcContext;
import org.apache.dubbo.rpc.service.GenericService;

import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.TimeUnit;

/** 跨进程验收客户端；凭据仅由环境提供，不放命令行、不输出附件。 */
public final class SampleDubboClient {
    private SampleDubboClient() {}
    private static final io.github.chenyilei2016.openplatform.provider.OpenPlatformSigner SIGNER =
            new io.github.chenyilei2016.openplatform.provider.OpenPlatformSigner("local", "current",
                    io.github.chenyilei2016.openplatform.provider.OpenPlatformKeys.privateKey(System.getenv("SAMPLE_GATEWAY_PRIVATE_KEY")), java.time.Clock.systemUTC());

    public static void verify(int port) throws Exception {
        String url = "dubbo://[::1]:" + port + "/" + SampleOperations.class.getName();
        ApplicationConfig application = new ApplicationConfig("openapi-sdk-check-client");
        application.setQosEnable(false);
        ReferenceConfig<SampleOperations> typed = new ReferenceConfig<>();
        typed.setInterface(SampleOperations.class);
        typed.setUrl(url);
        typed.setRetries(0);
        typed.setTimeout(5000);
        ReferenceConfig<GenericService> generic = new ReferenceConfig<>();
        generic.setInterface(SampleOperations.class);
        generic.setGeneric("true");
        generic.setUrl(url);
        generic.setRetries(0);
        generic.setTimeout(5000);
        ReferenceConfig<org.apache.dubbo.rpc.service.EchoService> ordinary = new ReferenceConfig<>();
        ordinary.setInterface(org.apache.dubbo.rpc.service.EchoService.class);
        ordinary.setUrl("dubbo://[::1]:" + port + "/" + org.apache.dubbo.rpc.service.EchoService.class.getName());
        ordinary.setRetries(0);
        ordinary.setTimeout(5000);
        DubboBootstrap bootstrap = DubboBootstrap.getInstance();
        try {
            bootstrap
                    .application(application)
                    .registry(new RegistryConfig("N/A"))
                    .reference(typed)
                    .reference(generic)
                    .reference(ordinary)
                    .start();
            SampleOperations service = typed.get();
            GenericService genericService = generic.get();
            for (int index = 0; index < 8; index++) {
                String tenant = "tenant-" + index;
                headers("identity", tenant, false, false);
                equal(tenant, service.identity("sample"));
                headers("identity", tenant, false, false);
                equal(
                        tenant,
                        genericService.$invoke(
                                "identity",
                                new String[] {String.class.getName()},
                                new Object[] {"sample"}));
                headers("asynchronous", tenant, false, false);
                equal(tenant, service.asynchronous("sample").get(5, TimeUnit.SECONDS));
                headers("employee", tenant, false, false);
                equal(null, service.employee());
                headers("employee", tenant, true, false);
                equal("E1001", service.employee());
                headers("identity", tenant, false, true);
                equal(
                        null,
                        genericService.$invoke(
                                "identity",
                                new String[] {String.class.getName()},
                                new Object[] {"sample"}));
                RpcContext.getContext().clearAttachments();
                equal("empty", service.internal());
            }
            RpcContext.getContext().clearAttachments();
            equal("ordinary", ordinary.get().$echo("ordinary"));
            System.out.println("SDK_DUBBO_CHECKS=57");
        } finally {
            typed.destroy();
            generic.destroy();
            ordinary.destroy();
            bootstrap.destroy();
        }
    }

    private static void headers(String method, String tenant, boolean employee, boolean invalid) {
        Map<String, String> values = new HashMap<>();
        values.put("x-open-platform-application-id", "sample-app");
        values.put("x-open-platform-app-key", "sample-key");
        values.put("x-open-platform-tenant-id", tenant);
        values.put("x-request-id", "sample-request");
        if (employee) {
            values.put("x-open-platform-user-id", "user");
            values.put("x-open-platform-employee-id", "employee");
            values.put("x-open-platform-employee-no", "E1001");
        }
        Map<String, String> proof = SIGNER.sign(values, io.github.chenyilei2016.openplatform.provider.OpenPlatformTarget.dubbo(
                SampleOperations.class.getName(), "", "", method,
                "employee".equals(method) ? java.util.Collections.emptyList() : java.util.Collections.singletonList(String.class.getName())));
        if (invalid) proof.put("x-open-platform-signature", "forged");
        RpcContext.getContext().setAttachments(proof);
    }

    private static void equal(Object expected, Object actual) {
        if (!java.util.Objects.equals(expected, actual)) throw new AssertionError("SDK跨进程身份检查未通过");
    }
}
