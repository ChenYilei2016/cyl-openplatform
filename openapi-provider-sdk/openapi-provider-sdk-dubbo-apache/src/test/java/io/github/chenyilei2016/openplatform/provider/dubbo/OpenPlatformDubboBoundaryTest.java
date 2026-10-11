package io.github.chenyilei2016.openplatform.provider.dubbo;

import static org.junit.jupiter.api.Assertions.*;

import io.github.chenyilei2016.openplatform.provider.*;

import org.apache.dubbo.common.URL;
import org.apache.dubbo.rpc.*;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.util.Collections;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

class OpenPlatformDubboBoundaryTest {

    interface UnmarkedService { String query(); }

    @OpenPlatformApi
    static class ProtectedDelegate implements UnmarkedService {
        public String query() { return "protected"; }
    }

    @Test
    void opaqueProxyCannotHideProtectedImplementationBehindAnUnmarkedContract() {
        UnmarkedService proxy = (UnmarkedService) java.lang.reflect.Proxy.newProxyInstance(
                getClass().getClassLoader(), new Class<?>[] {UnmarkedService.class},
                (instance, method, args) -> method.invoke(new ProtectedDelegate(), args));
        org.apache.dubbo.config.ServiceConfig<UnmarkedService> service = new org.apache.dubbo.config.ServiceConfig<>();
        service.setInterface(UnmarkedService.class);
        service.setRef(proxy);
        assertThrows(IllegalArgumentException.class,
                () -> OpenPlatformDubboRegistration.bind(service, ProviderProofFixture.verifier(), proxy.getClass()));
        assertNull(service.getParameters());
    }

    interface Service {
        @OpenPlatformApi
        String query(Map<String, Object> input);

        String employee();

        String internal();
    }

    static class Implementation implements Service {
        public String query(Map<String, Object> input) {
            return "";
        }

        @RequireOpenPlatformEmployee
        public String employee() {
            return "";
        }

        public String internal() {
            return "";
        }
    }

    private final AtomicInteger invoked = new AtomicInteger();
    private final Invoker<Service> service =
            new Invoker<Service>() {
                public Class<Service> getInterface() {
                    return Service.class;
                }

                public URL getUrl() {
                    return URL.valueOf("dubbo://127.0.0.1:20880/" + Service.class.getName());
                }

                public boolean isAvailable() {
                    return true;
                }

                public void destroy() {}

                public Result invoke(Invocation invocation) {
                    invoked.incrementAndGet();
                    String value =
                            "internal".equals(invocation.getMethodName())
                                    ? "internal"
                                    : OpenPlatformContext.requireIdentity().getTenantId();
                    return AsyncRpcResult.newDefaultAsyncResult(value, invocation);
                }
            };

    private OpenPlatformDubboFilter configured() {
        OpenPlatformDubboFilter filter = new OpenPlatformDubboFilter();
        filter.setOpenPlatformDubboSecurity(
                new OpenPlatformDubboSecurity(
                        ProviderProofFixture.verifier(),
                        Collections.singletonMap(Service.class, Implementation.class)));
        return filter;
    }

    private RpcInvocation invocation(String method, boolean generic) {
        RpcInvocation call = new RpcInvocation();
        call.setInvoker(service);
        call.setMethodName(generic ? "$invoke" : method);
        call.setParameterTypes(
                generic
                        ? new Class<?>[] {String.class, String[].class, Object[].class}
                        : "query".equals(method) ? new Class<?>[] {Map.class} : new Class<?>[0]);
        call.setArguments(
                generic
                        ? new Object[] {
                            method,
                            new String[] {Map.class.getName()},
                            new Object[] {Collections.singletonMap("orderNo", "1")}
                        }
                        : "query".equals(method)
                                ? new Object[] {Collections.singletonMap("orderNo", "1")}
                                : new Object[0]);
        if (generic) call.setAttachment("generic", "true");
        Map<String, String> identity = new HashMap<>();
        identity.put("x-open-platform-application-id", "app");
        identity.put("x-open-platform-app-key", "key");
        identity.put("x-open-platform-tenant-id", "tenant");
        identity.put("x-request-id", "request");
        ProviderProofFixture.SIGNER.sign(identity, OpenPlatformTarget.dubbo(Service.class.getName(), "", "", method,
                "query".equals(method) ? Collections.singletonList(Map.class.getName()) : Collections.emptyList()))
                .forEach(call::setAttachment);
        return call;
    }

    @AfterEach
    void restoresContext() {
        assertFalse(OpenPlatformContext.current().isPresent());
    }

    @Test
    void authenticatesTypedAndGenericAndLeavesUnprotectedMethodAlone() {
        OpenPlatformDubboFilter filter = configured();
        for (boolean generic : new boolean[] {false, true}) {
            RpcInvocation call = invocation("query", generic);
            assertEquals("tenant", filter.invoke(service, call).getValue());
            call.setAttachment("x-open-platform-signature", "forged");
            assertEquals(
                    "403", filter.invoke(service, call).getAttachment("x-open-platform-status"));
        }
        RpcInvocation internal = invocation("internal", false);
        internal.setAttachment("x-open-platform-signature", "wrong");
        assertEquals("internal", filter.invoke(service, internal).getValue());
        assertEquals(3, invoked.get());
    }

    @Test
    void classHintsUnknownSignaturesAndAlternateGenericFormatsStopBeforeConversion() {
        OpenPlatformDubboFilter filter = configured();
        RpcInvocation call = invocation("query", true);
        Map<String, Object> nested = new HashMap<>();
        nested.put("class", "malicious.UntrustedType");
        call.setArguments(
                new Object[] {
                    "query",
                    new String[] {Map.class.getName()},
                    new Object[] {Collections.singletonMap("nested", nested)}
                });
        assertEquals("400", filter.invoke(service, call).getAttachment("x-open-platform-status"));
        call = invocation("query", true);
        call.setAttachment("generic", "bean");
        assertEquals("400", filter.invoke(service, call).getAttachment("x-open-platform-status"));
        call = invocation("query", true);
        call.setArguments(
                new Object[] {"query", new String[] {"malicious.Unknown"}, new Object[] {null}});
        assertEquals("400", filter.invoke(service, call).getAttachment("x-open-platform-status"));
        assertEquals(0, invoked.get());
    }

    @Test
    void unresolvedJdkProxyTypeCannotSilentlyDropImplementationAnnotations() {
        Class<?> proxyType =
                java.lang.reflect.Proxy.getProxyClass(
                        Service.class.getClassLoader(), Service.class);
        assertThrows(
                IllegalArgumentException.class,
                () ->
                        new OpenPlatformDubboSecurity(
                                ProviderProofFixture.verifier(),
                                Collections.singletonMap(Service.class, proxyType)));
        assertEquals(
                "403",
                configured()
                        .invoke(service, invocation("employee", false))
                        .getAttachment("x-open-platform-status"));
    }

    @Test
    void implementationAnnotationsAndMissingConfigurationFailClosed() {
        OpenPlatformDubboFilter filter = configured();
        assertEquals(
                "403",
                filter.invoke(service, invocation("employee", false))
                        .getAttachment("x-open-platform-status"));
        assertEquals(
                "403",
                new OpenPlatformDubboFilter()
                        .invoke(service, invocation("query", true))
                        .getAttachment("x-open-platform-status"));
        assertEquals(0, invoked.get());
    }
}
