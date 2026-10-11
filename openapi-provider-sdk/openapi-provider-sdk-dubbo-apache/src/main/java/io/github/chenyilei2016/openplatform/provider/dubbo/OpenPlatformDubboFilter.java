package io.github.chenyilei2016.openplatform.provider.dubbo;

import io.github.chenyilei2016.openplatform.provider.*;

import org.apache.dubbo.common.extension.Activate;
import org.apache.dubbo.rpc.AsyncRpcResult;
import org.apache.dubbo.rpc.Filter;
import org.apache.dubbo.rpc.Invocation;
import org.apache.dubbo.rpc.Invoker;
import org.apache.dubbo.rpc.Result;

/** Apache 2.7/3.x共同SPI，在GenericFilter(-20000)进行不可信参数转换之前执行。 */
@Activate(group = "provider", value = "open-platform-bound", order = -30000)
public final class OpenPlatformDubboFilter implements Filter {
    private volatile OpenPlatformDubboSecurity security;

    /** 由宿主在服务导出前注入；禁止通过URL/附件传入服务端凭据。 */
    public synchronized void setOpenPlatformDubboSecurity(OpenPlatformDubboSecurity security) {
        if (this.security != null && this.security != security)
            throw new IllegalStateException("不能替换已绑定的Dubbo认证配置");
        this.security = java.util.Objects.requireNonNull(security, "security");
    }

    synchronized void register(OpenPlatformVerifier verifier, Class<?> contract, Class<?> targetType) {
        if (security == null) security = new OpenPlatformDubboSecurity(verifier);
        if (security.verifier() != verifier)
            throw new IllegalStateException("同一Dubbo服务模型不能绑定不同Verifier；Dubbo2.7须共用同一Verifier或独立进程");
        security.register(contract, targetType);
    }

    boolean contains(Class<?> contract) {
        OpenPlatformDubboSecurity configured = security;
        return configured != null && configured.contains(contract);
    }

    @Override
    public Result invoke(Invoker<?> invoker, Invocation invocation) {
        OpenPlatformDubboSecurity configured = security;
        if (configured == null)
            return rejected(invocation, OpenPlatformException.Reason.INVALID_CREDENTIAL);
        if (!configured.contains(invoker.getInterface())) return invoker.invoke(invocation);
        OpenPlatformIdentity identity;
        try {
            boolean generic = "$invoke".equals(invocation.getMethodName());
            Object[] arguments = invocation.getArguments();
            String method;
            String[] types;
            if (generic) {
                if (arguments == null
                        || arguments.length != 3
                        || !(arguments[0] instanceof String)
                        || !(arguments[1] instanceof String[])
                        || !(arguments[2] instanceof Object[])
                        || !"true".equals(invocation.getAttachment("generic")))
                    throw invalidInvocation();
                method = (String) arguments[0];
                types = (String[]) arguments[1];
                if (((Object[]) arguments[2]).length != types.length) throw invalidInvocation();
            } else {
                method = invocation.getMethodName();
                Class<?>[] parameters = invocation.getParameterTypes();
                if (parameters == null || parameters.length > 32) throw invalidInvocation();
                types = new String[parameters.length];
                for (int index = 0; index < parameters.length; index++)
                    types[index] = parameters[index].getName();
            }
            OpenPlatformEndpointPolicy policy =
                    configured.policy(invoker.getInterface(), method, types);
            if (!policy.isProtected()) return invoker.invoke(invocation);
            identity =
                    configured
                            .verifier()
                            .authenticate(
                                    name -> {
                                        Object value = invocation.getObjectAttachment(name);
                                        if (value != null && !(value instanceof String))
                                            throw new OpenPlatformException(
                                                    OpenPlatformException.Reason.INVALID_IDENTITY);
                                        return (String) value;
                                    }, OpenPlatformTarget.dubbo(invoker.getInterface().getName(),
                                            invoker.getUrl().getParameter("version", ""), invoker.getUrl().getParameter("group", ""),
                                            method, java.util.Arrays.asList(types)));
            policy.validate(identity);
            if (generic) new OpenPlatformGenericArguments().validate(arguments[2], 0);
        } catch (OpenPlatformException rejected) {
            return rejected(invocation, rejected.getReason());
        } catch (IllegalArgumentException invalidTarget) {
            return rejected(invocation, OpenPlatformException.Reason.INVALID_INVOCATION);
        }
        try (OpenPlatformContext.Scope ignored = OpenPlatformContext.open(identity)) {
            return invoker.invoke(invocation);
        }
    }

    private static OpenPlatformException invalidInvocation() {
        return new OpenPlatformException(OpenPlatformException.Reason.INVALID_INVOCATION);
    }

    private static Result rejected(Invocation invocation, OpenPlatformException.Reason reason) {
        AsyncRpcResult result = AsyncRpcResult.newDefaultAsyncResult(invocation);
        result.setAttachment("x-open-platform-status", Integer.toString(reason.getStatus()));
        result.setAttachment("x-open-platform-error", reason.name());
        return result;
    }
}
