package io.github.chenyilei2016.openplatform.provider.dubbo;

import io.github.chenyilei2016.openplatform.provider.*;

import java.lang.reflect.Method;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;

/** 导出前冻结显式接入的服务及方法策略，保留未标注方法的原内部调用行为。 */
public final class OpenPlatformDubboSecurity {
    private final OpenPlatformVerifier verifier;
    private volatile Map<Class<?>, Map<String, OpenPlatformEndpointPolicy>> services = Collections.emptyMap();

    OpenPlatformDubboSecurity(OpenPlatformVerifier verifier) {
        this.verifier = java.util.Objects.requireNonNull(verifier, "verifier");
    }

    public OpenPlatformDubboSecurity(
            OpenPlatformVerifier verifier, Map<Class<?>, Class<?>> implementationTypes) {
        this(verifier);
        if (implementationTypes == null
                || implementationTypes.isEmpty()
                || implementationTypes.size() > 64)
            throw new IllegalArgumentException("请显式登记1至64个开放平台Dubbo服务");
        implementationTypes.forEach(this::register);
    }

    /** 导出前编译，允许同策略重复登记；不会覆盖已导出接口的安全策略。 */
    synchronized void register(Class<?> contract, Class<?> implementationType) {
        if (!contract.isInterface()
                || implementationType == null
                || !contract.isAssignableFrom(implementationType)
                || java.lang.reflect.Proxy.isProxyClass(implementationType))
            throw new IllegalArgumentException("请登记匹配接口的真实目标类型，JDK代理须由宿主解代理后再登记");
        Method[] methods = contract.getMethods();
        if (methods.length > 512) throw new IllegalArgumentException("单个接入服务最多512个方法");
        Map<String, OpenPlatformEndpointPolicy> policies = new HashMap<>();
        boolean protectedMethod = false;
        for (Method method : methods) {
            OpenPlatformEndpointPolicy policy =
                    OpenPlatformEndpointPolicy.resolve(implementationType, method);
            protectedMethod |= policy.isProtected();
            Class<?>[] parameters = method.getParameterTypes();
            String[] names = new String[parameters.length];
            for (int index = 0; index < parameters.length; index++)
                names[index] = parameters[index].getName();
            policies.put(signature(method.getName(), names), policy);
        }
        if (!protectedMethod) throw new IllegalArgumentException("接入服务未声明受保护入口");
        Map<String, OpenPlatformEndpointPolicy> existing = services.get(contract);
        if (existing != null) {
            if (!existing.equals(policies)) throw new IllegalStateException("同一Dubbo接口的实现策略不一致；Dubbo3请使用独立服务模型，2.7请分离进程");
            return;
        }
        if (services.size() >= 64) throw new IllegalArgumentException("最多登记64个开放平台Dubbo服务");
        Map<Class<?>, Map<String, OpenPlatformEndpointPolicy>> configured = new HashMap<>(services);
        configured.put(contract, Collections.unmodifiableMap(policies));
        services = Collections.unmodifiableMap(configured);
    }

    public boolean contains(Class<?> contract) {
        return services.containsKey(contract);
    }

    OpenPlatformVerifier verifier() {
        return verifier;
    }

    OpenPlatformEndpointPolicy policy(Class<?> contract, String method, String[] parameters) {
        OpenPlatformEndpointPolicy policy =
                services.get(contract).get(signature(method, parameters));
        if (policy == null)
            throw new OpenPlatformException(OpenPlatformException.Reason.INVALID_INVOCATION);
        return policy;
    }

    private static String signature(String method, String[] parameters) {
        if (method == null || method.length() > 128 || parameters == null || parameters.length > 32)
            throw new OpenPlatformException(OpenPlatformException.Reason.INVALID_INVOCATION);
        StringBuilder key = new StringBuilder(method).append('(');
        for (String parameter : parameters) {
            if (parameter == null || parameter.length() > 512 || parameter.indexOf(',') >= 0)
                throw new OpenPlatformException(OpenPlatformException.Reason.INVALID_INVOCATION);
            key.append(parameter).append(',');
        }
        return key.append(')').toString();
    }
}
