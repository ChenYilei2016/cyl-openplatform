package io.github.chenyilei2016.openplatform.provider.dubbo;

import io.github.chenyilei2016.openplatform.provider.OpenPlatformEndpointPolicy;
import io.github.chenyilei2016.openplatform.provider.OpenPlatformVerifier;
import org.apache.dubbo.common.extension.Activate;
import org.apache.dubbo.common.extension.ExtensionLoader;
import org.apache.dubbo.config.ConfigPostProcessor;
import org.apache.dubbo.config.ServiceConfig;
import org.apache.dubbo.rpc.Filter;
import java.lang.reflect.Method;
import java.util.HashMap;
import java.util.Map;
import java.util.function.Consumer;

/** 2.7/3.x共用的导出前入口；Spring回调只在本地元数据中，不进入URL或附件。 */
@Activate
public final class OpenPlatformDubboRegistration implements ConfigPostProcessor {
    public static final String BEFORE_EXPORT_ATTRIBUTE = OpenPlatformDubboRegistration.class.getName();
    private static final String BOUND_PARAMETER = "open-platform-bound";

    @Override
    @SuppressWarnings("unchecked")
    public void postProcessServiceConfig(ServiceConfig service) {
        Object callback = service.getServiceMetadata().getAttribute(BEFORE_EXPORT_ATTRIBUTE);
        if (callback != null) ((Consumer<ServiceConfig<?>>) callback).accept(service);
        else if (filter(service).contains(service.getInterfaceClass())) activate(service);
    }

    /** 仅服务自身已声明保护策略才加入SDK；普通内部服务不被接管。 */
    public static void bind(ServiceConfig<?> service, OpenPlatformVerifier verifier, Class<?> targetType) {
        Class<?> contract = service.getInterfaceClass();
        if (!protectedService(service, targetType)) return;
        filter(service).register(verifier, contract, targetType);
        activate(service);
    }

    public static boolean protectedService(ServiceConfig<?> service, Class<?> targetType) {
        if (targetType == null || java.lang.reflect.Proxy.isProxyClass(targetType))
            throw new IllegalArgumentException("无法判断Dubbo代理的真实保护策略；请提供可解析的Spring目标或在非Spring宿主显式登记真实目标类型");
        for (Method method : service.getInterfaceClass().getMethods())
            if (OpenPlatformEndpointPolicy.resolve(targetType, method).isProtected()) return true;
        return false;
    }

    private static void activate(ServiceConfig<?> service) {
        checkFilterConfiguration(service.getFilter());
        if (service.getProvider() != null) {
            checkFilterConfiguration(service.getProvider().getFilter());
            if (service.getProvider().getParameters() != null)
                checkFilterConfiguration(service.getProvider().getParameters().get("service.filter"));
        }
        Map<String, String> parameters = new HashMap<>();
        if (service.getParameters() != null) parameters.putAll(service.getParameters());
        checkFilterConfiguration(parameters.get("service.filter"));
        parameters.put(BOUND_PARAMETER, "true");
        service.setParameters(parameters);
    }

    private static void checkFilterConfiguration(String filters) {
        if (filters == null) return;
        for (String name : filters.split(",")) {
            if ("-default".equals(name.trim()) || "-openPlatform".equals(name.trim()) || "openPlatform".equals(name.trim()))
                throw new IllegalStateException("平台Dubbo服务须保留默认过滤器；移除显式openPlatform/-openPlatform/-default，由SDK按导出服务自动激活");
        }
    }

    private static OpenPlatformDubboFilter filter(ServiceConfig<?> service) {
        Method modelAccessor;
        try {
            modelAccessor = service.getClass().getMethod("getScopeModel");
        } catch (NoSuchMethodException legacyRuntime) {
            return (OpenPlatformDubboFilter) ExtensionLoader.getExtensionLoader(Filter.class).getExtension("openPlatform");
        }
        try {
            // 唯一版本接缝：3.x按服务的实际ModuleModel；2.7没有getScopeModel。
            Object model = modelAccessor.invoke(service);
            if (model == null) throw new IllegalStateException("Dubbo服务模型尚未确定，不能登记平台策略");
            Object loader = model.getClass().getMethod("getExtensionLoader", Class.class).invoke(model, Filter.class);
            return (OpenPlatformDubboFilter) ((ExtensionLoader<?>) loader).getExtension("openPlatform");
        } catch (ReflectiveOperationException failure) {
            throw new IllegalStateException("无法绑定服务所在Dubbo模型；请在导出前检查ServiceConfig的ScopeModel", failure);
        }
    }
}
