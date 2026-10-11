package io.github.chenyilei2016.openplatform.infrastructure.runtime;

import io.github.chenyilei2016.openplatform.infrastructure.common.BoundedOutputStream;
import io.github.chenyilei2016.openplatform.provider.OpenPlatformTarget;
import io.github.chenyilei2016.openplatform.infrastructure.connection.runtime.ManagedDubboConnectionRuntime;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiBinding;
import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.runtime.ResponseAdaptation;
import io.github.chenyilei2016.openplatform.domain.runtime.ProviderCallFailure;
import io.github.chenyilei2016.openplatform.domain.runtime.InvocationDiagnostics.Dispatch;
import tools.jackson.core.exc.StreamConstraintsException;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.github.chenyilei2016.openplatform.domain.runtime.DubboApiInvoker;
import io.github.chenyilei2016.openplatform.domain.runtime.InvocationContext;
import io.opentelemetry.api.trace.propagation.W3CTraceContextPropagator;
import io.opentelemetry.context.Context;
import java.lang.reflect.Array;
import io.github.chenyilei2016.openplatform.domain.runtime.DubboArguments;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Semaphore;
import java.util.concurrent.atomic.AtomicBoolean;
import org.apache.dubbo.rpc.RpcContext;
import org.apache.dubbo.rpc.RpcContextAttachment;
import org.apache.dubbo.rpc.RpcException;
import org.apache.dubbo.rpc.service.GenericService;
import org.springframework.beans.factory.DisposableBean;
import org.springframework.stereotype.Component;
import tools.jackson.databind.json.JsonMapper;

/** 按固定连接修订复用服务引用；可信身份由环境签名统一验证。 */
@Component
public class GenericDubboApiInvoker implements DubboApiInvoker, DisposableBean {
    private final GatewayDubboSettings properties;
    private final JsonMapper json;
    private final GatewayProviderProof proof;
    private final ManagedDubboConnectionRuntime connections;
    private final Semaphore permits;
    private final AtomicBoolean closed = new AtomicBoolean();
    public GenericDubboApiInvoker(GatewayDubboSettings properties, JsonMapper json, ManagedDubboConnectionRuntime connections, GatewayProviderProof proof) {
        this.properties = properties;
        this.proof = proof;
        this.json = json;
        this.connections = connections;
        this.permits = new Semaphore(properties.getMaxConcurrentRequests());
    }

    @Override
    public Object invoke(ApiBinding binding, Map<String, Object> parameters, InvocationContext context, String requestId) {
        if (closed.get()) throw new ProviderCallFailure(ErrorCode.DOWNSTREAM_FAILED, "Dubbo调用资源已关闭", Dispatch.NOT_SENT, null);
        if (!permits.tryAcquire()) {
            throw new ProviderCallFailure(ErrorCode.RATE_LIMITED, "网关并发调用已达上限", Dispatch.NOT_SENT, null);
        }
        ManagedDubboConnectionRuntime.ReferenceLease lease = null;
        RpcContext.RestoreContext saved = new RpcContext.RestoreContext();
        RpcContext.removeContext();
        boolean attempted = false;
        try {
            ApiBinding.Dubbo dubbo = binding.dubbo();
            if (dubbo.connectionId() == null || dubbo.connectionRevision() == null)
                throw new PlatformException(ErrorCode.INVALID_REQUEST, "请先为API选择Dubbo连接及修订");
            cleanValue(parameters, false, 0, new int[]{20_000});
            Object[] arguments = DubboArguments.prepare(parameters, dubbo.parameterTypes());
            lease = connections.acquire(dubbo.connectionId(), dubbo.connectionRevision(), dubbo.identity());
            GenericService service = lease.service();
            BoundedOutputStream request = new BoundedOutputStream(properties.getMaxRequestBytes());
            json.writeValue(request, parameters);
            RpcContextAttachment attachments = RpcContext.getClientAttachment();
            // 只传播当前有效 W3C 上下文；旧调用的附件已隔离，退出时统一恢复。
            W3CTraceContextPropagator.getInstance().inject(Context.current(), attachments, RpcContextAttachment::setAttachment);
            proof.headers(context, OpenPlatformTarget.dubbo(
                    dubbo.interfaceName(), dubbo.version(), dubbo.group(), dubbo.method(), dubbo.parameterTypes()), requestId)
                    .forEach(attachments::setAttachment);
            attachments.setAttachment("timeout", Long.toString(Math.min(binding.timeoutMillis(), properties.getTotalTimeout().toMillis())));
            Object result;
            try {
                attempted = true;
                result = service.$invoke(dubbo.method(), dubbo.parameterTypes().toArray(String[]::new), arguments);
            } catch (RuntimeException exception) {
                rejectResponseStatus();
                if (exception instanceof RpcException rpcException && rpcException.isTimeout()) {
                    throw new ProviderCallFailure(ErrorCode.DOWNSTREAM_TIMEOUT, "提供方调用超时，业务是否执行尚不确定", Dispatch.UNKNOWN, null);
                }
                throw new ProviderCallFailure(ErrorCode.DOWNSTREAM_FAILED, "提供方调用失败，无法确认执行结果", Dispatch.UNKNOWN, null);
            }
            rejectResponseStatus();
            try {
                Object normalized = cleanValue(result, true, 0, new int[]{20_000});
                BoundedOutputStream response = new BoundedOutputStream(properties.getMaxResponseBytes());
                json.writeValue(response, normalized);
                return json.readValue(response.toByteArray(), Object.class);
            } catch (ResponseAdaptation.Failure failure) {
                throw failure;
            } catch (RuntimeException exception) {
                Throwable cause = exception;
                while (cause != null) {
                    if (cause instanceof StreamConstraintsException || cause instanceof PlatformException platform
                            && platform.getErrorCode() == ErrorCode.REQUEST_TOO_LARGE)
                        throw ResponseAdaptation.responseLimitExceeded();
                    cause = cause.getCause();
                }
                throw new PlatformException(ErrorCode.DOWNSTREAM_FAILED, "提供方响应不合法或超出大小限制", exception);
            }
        } catch (PlatformException exception) {
            if (exception instanceof ProviderCallFailure || exception instanceof ResponseAdaptation.Failure) throw exception;
            throw new ProviderCallFailure(exception.getErrorCode(), exception.getMessage(), attempted ? Dispatch.UNKNOWN : Dispatch.NOT_SENT, null);
        } catch (RuntimeException exception) {
            Throwable cause = exception;
            while (cause != null) {
                if (cause instanceof PlatformException platformException) {
                    if (platformException instanceof ProviderCallFailure || platformException instanceof ResponseAdaptation.Failure) throw platformException;
                    throw new ProviderCallFailure(platformException.getErrorCode(), platformException.getMessage(), attempted ? Dispatch.UNKNOWN : Dispatch.NOT_SENT, null);
                }
                cause = cause.getCause();
            }
            throw new ProviderCallFailure(ErrorCode.DOWNSTREAM_FAILED, "提供方调用失败或数据不合法", attempted ? Dispatch.UNKNOWN : Dispatch.NOT_SENT, null);
        } finally {
            RpcContext.removeContext();
            saved.restore();
            if (lease != null) lease.close();
            permits.release();
        }
    }

    private static void rejectResponseStatus() {
        String status = RpcContext.getClientResponseContext().getAttachment("x-open-platform-status");
        if (status == null || "200".equals(status)) return;
        ErrorCode code = switch (status) {
            case "403" -> ErrorCode.FORBIDDEN;
            case "404" -> ErrorCode.NOT_FOUND;
            case "429" -> ErrorCode.RATE_LIMITED;
            case "504" -> ErrorCode.DOWNSTREAM_TIMEOUT;
            default -> ErrorCode.DOWNSTREAM_FAILED;
        };
        throw new ProviderCallFailure(code, code.getMessage(), Dispatch.SENT, RpcContext.getClientResponseContext().getAttachment("x-open-platform-error"));
    }

    /** JSON边界与Dubbo的class元数据边界一致；遍历预算也约束循环引用和超深返回。 */
    private static Object cleanValue(Object value, boolean response, int depth, int[] remaining) {
        if (--remaining[0] < 0 || depth > 64) {
            if (response) throw ResponseAdaptation.responseLimitExceeded();
            throw new PlatformException(ErrorCode.INVALID_REQUEST, "Dubbo数据超出结构限制");
        }
        if (value == null || value instanceof String || value instanceof Number || value instanceof Boolean) return value;
        if (response && value instanceof Character character) return character.toString();
        if (value instanceof Map<?, ?> map) {
            Map<String, Object> copy = response ? new LinkedHashMap<>() : null;
            for (Map.Entry<?, ?> entry : map.entrySet()) {
                if (!(entry.getKey() instanceof String name)) throw new PlatformException(ErrorCode.INVALID_REQUEST, "Dubbo对象键必须是字符串");
                if ("class".equals(name)) {
                    if (!response) throw new PlatformException(ErrorCode.INVALID_REQUEST, "Dubbo参数禁止class元数据");
                    continue;
                }
                Object cleaned = cleanValue(entry.getValue(), response, depth + 1, remaining);
                if (response) copy.put(name, cleaned);
            }
            return response ? copy : value;
        }
        if (value instanceof List<?> list) {
            List<Object> copy = response ? new ArrayList<>() : null;
            for (Object item : list) {
                Object cleaned = cleanValue(item, response, depth + 1, remaining);
                if (response) copy.add(cleaned);
            }
            return response ? copy : value;
        }
        if (value.getClass().isArray()) {
            List<Object> copy = new ArrayList<>();
            for (int index = 0; index < Array.getLength(value); index++) copy.add(cleanValue(Array.get(value, index), response, depth + 1, remaining));
            return copy;
        }
        throw new PlatformException(ErrorCode.INVALID_REQUEST, "Dubbo数据必须是JSON对象、数组或标量");
    }

    @Override
    public void destroy() {
        if (!closed.compareAndSet(false, true)) return;

    }
}
