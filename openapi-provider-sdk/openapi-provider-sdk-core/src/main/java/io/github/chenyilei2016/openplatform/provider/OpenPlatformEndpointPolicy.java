package io.github.chenyilei2016.openplatform.provider;

import java.lang.annotation.Annotation;
import java.lang.reflect.Method;

/** 共用接口/实现/父类声明的入口策略；反射只针对宿主已注册的类型，不加载请求指定类。 */
public enum OpenPlatformEndpointPolicy {
    UNPROTECTED,
    APPLICATION,
    EMPLOYEE;

    public boolean isProtected() {
        return this != UNPROTECTED;
    }

    public void validate(OpenPlatformIdentity identity) {
        if (this == EMPLOYEE) identity.requireEmployee();
    }

    public static OpenPlatformEndpointPolicy resolve(Class<?> type, Method method) {
        boolean employee = declared(type, method, RequireOpenPlatformEmployee.class);
        if (employee) return EMPLOYEE;
        if (declared(type, method, OpenPlatformApi.class)) return APPLICATION;
        for (Annotation[] annotations : method.getParameterAnnotations())
            for (Annotation annotation : annotations)
                if (annotation.annotationType() == CurrentOpenPlatformIdentity.class)
                    return APPLICATION;
        return UNPROTECTED;
    }

    private static boolean declared(
            Class<?> type, Method method, Class<? extends Annotation> marker) {
        if (method.isAnnotationPresent(marker)) return true;
        if (type == null || type == Object.class) return false;
        if (type.isAnnotationPresent(marker)) return true;
        try {
            if (type.getMethod(method.getName(), method.getParameterTypes())
                    .isAnnotationPresent(marker)) return true;
        } catch (NoSuchMethodException absent) {
            /* 此层未声明该入口，继续检查接口与父类。 */
        }
        for (Class<?> contract : type.getInterfaces())
            if (declared(contract, method, marker)) return true;
        return declared(type.getSuperclass(), method, marker);
    }
}
