package io.github.chenyilei2016.openplatform.infrastructure.runtime;

import io.github.chenyilei2016.openplatform.infrastructure.common.BoundedOutputStream;
import io.github.chenyilei2016.openplatform.provider.OpenPlatformTarget;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiBinding;
import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.runtime.ResponseAdaptation;
import io.github.chenyilei2016.openplatform.domain.runtime.ProviderCallFailure;
import io.github.chenyilei2016.openplatform.domain.runtime.InvocationDiagnostics.Dispatch;
import tools.jackson.core.exc.StreamConstraintsException;
import org.springframework.core.io.buffer.DataBufferLimitException;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.github.chenyilei2016.openplatform.domain.runtime.HttpApiInvoker;
import io.github.chenyilei2016.openplatform.domain.runtime.HttpParameters;
import io.github.chenyilei2016.openplatform.domain.runtime.HttpServiceDiscovery;
import io.github.chenyilei2016.openplatform.domain.runtime.InvocationContext;
import io.opentelemetry.context.Context;
import io.github.chenyilei2016.openplatform.infrastructure.common.HttpTracePropagation;
import java.net.URI;
import io.github.chenyilei2016.openplatform.domain.catalog.HttpUrlTemplate;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Map;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeoutException;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.util.UriComponentsBuilder;
import org.springframework.web.util.UriUtils;
import reactor.core.publisher.Mono;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.json.JsonMapper;

/** 不转发客户Header；连接、完整响应读取和取消均在同一调用期限内。 */
@Component
public class WebClientHttpApiInvoker implements HttpApiInvoker {
    private final WebClient client;
    private final JsonMapper json;
    private final GatewayHttpSettings properties;
    private final GatewayProviderProof proof;
    private final HttpServiceDiscovery discovery;
    private final Semaphore permits;

    public WebClientHttpApiInvoker(@Qualifier("gatewayHttpClient") WebClient client, JsonMapper json,
                                   GatewayHttpSettings properties, GatewayProviderProof proof, HttpServiceDiscovery discovery) {
        this.client = client;
        this.json = json;
        this.properties = properties;
        this.permits = new Semaphore(properties.getMaxConcurrentRequests());
        this.proof = proof;
        this.discovery = discovery;
    }

    @Override
    public Object invoke(ApiBinding binding, HttpParameters parameters, InvocationContext context, String requestId) {
        Context traceContext = Context.current();
        if (!permits.tryAcquire()) {
            throw new ProviderCallFailure(ErrorCode.RATE_LIMITED, "网关并发调用已达上限", Dispatch.NOT_SENT, null);
        }
        boolean attempted = false;
        long started = System.nanoTime();
        Duration budget = Duration.ofMillis(Math.min(binding.timeoutMillis(), properties.getTotalTimeout().toMillis()));
        try {
            binding.validate();
            URI uri = binding.http().template().expand(parameters.path());
            boolean jsonBody = binding.http().hasJsonBody();
            if (!jsonBody && !parameters.body().isEmpty())
                throw new PlatformException(ErrorCode.INVALID_REQUEST, "GET/DELETE不支持BODY参数");
            BoundedOutputStream encoded = new BoundedOutputStream(properties.getMaxRequestBytes());
            json.writeValue(encoded, jsonBody ? parameters.body() : parameters.query());
            byte[] bodyBytes = jsonBody ? encoded.toByteArray() : null;
            if (!parameters.path().isEmpty()) json.writeValue(encoded, parameters.path());
            if (jsonBody && !parameters.query().isEmpty()) json.writeValue(encoded, parameters.query());
            HttpMethod method = HttpMethod.valueOf(binding.http().method());
            if (!parameters.query().isEmpty()) {
                UriComponentsBuilder builder = UriComponentsBuilder.fromUri(uri);
                org.springframework.util.MultiValueMap<String, String> fixedQuery = builder.build(true).getQueryParams();
                if (fixedQuery.keySet().stream().map(key -> UriUtils.decode(key, StandardCharsets.UTF_8))
                        .anyMatch(parameters.query()::containsKey)) {
                    throw new PlatformException(ErrorCode.DOWNSTREAM_FAILED, "提供方固定query与映射参数冲突");
                }
                for (Map.Entry<String, Object> parameter : parameters.query().entrySet()) {
                    Object value = parameter.getValue();
                    String text = value instanceof Map<?, ?> || value instanceof Iterable<?> || value == null
                            ? json.writeValueAsString(value) : value.toString();
                    builder.queryParam(UriUtils.encode(parameter.getKey(), StandardCharsets.UTF_8), UriUtils.encode(text, StandardCharsets.UTF_8));
                }
                uri = builder.build(true).toUri();
            }
            HttpUrlTemplate.validateExpandedTarget(uri);
            if (binding.http().discovered()) {
                URI selected = discovery.select(binding.http().serviceName(), remaining(budget, started));
                uri = URI.create(selected.getScheme() + "://" + selected.getRawAuthority() + uri.getRawPath()
                        + (uri.getRawQuery() == null ? "" : "?" + uri.getRawQuery()));
            }
            WebClient.RequestBodySpec request = client.method(method).uri(uri)
                    .accept(MediaType.APPLICATION_JSON)
                    .httpRequest(httpRequest -> HttpTracePropagation.injectIfAbsent(traceContext, httpRequest.getHeaders()));
            proof.headers(context, OpenPlatformTarget.http(uri, method.name()), requestId)
                    .forEach(request::header);
            WebClient.RequestHeadersSpec<?> outgoing = jsonBody ? request.contentType(MediaType.APPLICATION_JSON).bodyValue(bodyBytes) : request;
            Duration timeout = remaining(budget, started);
            attempted = true;
            byte[] responseBytes = outgoing.exchangeToMono(response -> {
                int status = response.statusCode().value();
                if (!response.statusCode().is2xxSuccessful()) {
                    ErrorCode error = switch (status) {
                        case 403 -> ErrorCode.FORBIDDEN;
                        case 404 -> ErrorCode.NOT_FOUND;
                        case 429 -> ErrorCode.RATE_LIMITED;
                        case 408, 504 -> ErrorCode.DOWNSTREAM_TIMEOUT;
                        default -> ErrorCode.DOWNSTREAM_FAILED;
                    };
                    return Mono.error(new ProviderCallFailure(error, error.getMessage(), Dispatch.SENT, response.headers().asHttpHeaders().getFirst("X-Open-Platform-Error")));
                }
                MediaType contentType = response.headers().contentType().orElse(MediaType.APPLICATION_OCTET_STREAM);
                if (!(MediaType.APPLICATION_JSON.isCompatibleWith(contentType)
                        || ("application".equals(contentType.getType()) && contentType.getSubtype().endsWith("+json")))) {
                    return Mono.error(new ProviderCallFailure(ErrorCode.DOWNSTREAM_FAILED, "提供方未返回JSON", Dispatch.SENT, null));
                }
                return response.bodyToMono(byte[].class)
                        .switchIfEmpty(Mono.error(new ProviderCallFailure(ErrorCode.DOWNSTREAM_FAILED, "提供方返回为空", Dispatch.SENT, null)));
            }).timeout(timeout).block();
            // JSON null 是合法业务值；不能在 Reactor map 中返回 Java null。
            try {
                return json.readerFor(Object.class).with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS).readValue(responseBytes);
            } catch (StreamConstraintsException tooLarge) {
                throw ResponseAdaptation.responseLimitExceeded();
            } catch (RuntimeException invalidJson) {
                throw new ProviderCallFailure(ErrorCode.DOWNSTREAM_FAILED, "提供方响应不是合法JSON", Dispatch.SENT, null);
            }
        } catch (PlatformException exception) {
            if (exception instanceof ProviderCallFailure || exception instanceof ResponseAdaptation.Failure) throw exception;
            throw new ProviderCallFailure(exception.getErrorCode(), exception.getMessage(), attempted ? Dispatch.UNKNOWN : Dispatch.NOT_SENT, null);
        } catch (RuntimeException exception) {
            Throwable cause = exception;
            while (cause != null) {
                if (cause instanceof StreamConstraintsException || cause instanceof DataBufferLimitException) {
                    if (!attempted) throw new ProviderCallFailure(ErrorCode.REQUEST_TOO_LARGE, "映射后的请求超出大小限制", Dispatch.NOT_SENT, null);
                    throw ResponseAdaptation.responseLimitExceeded();
                }
                if (cause instanceof PlatformException platformException) {
                    if (platformException instanceof ProviderCallFailure || platformException instanceof ResponseAdaptation.Failure) throw platformException;
                    throw new ProviderCallFailure(platformException.getErrorCode(), platformException.getMessage(), attempted ? Dispatch.UNKNOWN : Dispatch.NOT_SENT, null);
                }
                if (cause instanceof TimeoutException || cause instanceof io.netty.channel.ConnectTimeoutException
                        || cause instanceof io.netty.handler.timeout.ReadTimeoutException) {
                    throw new ProviderCallFailure(ErrorCode.DOWNSTREAM_TIMEOUT, attempted ? "提供方调用超时，业务是否执行尚不确定" : "提供方发现或准备超时，未发送请求",
                            attempted ? Dispatch.UNKNOWN : Dispatch.NOT_SENT, null);
                }
                cause = cause.getCause();
            }
            throw new ProviderCallFailure(ErrorCode.DOWNSTREAM_FAILED, "提供方调用失败，无法确认是否已送达", attempted ? Dispatch.UNKNOWN : Dispatch.NOT_SENT, null);
        } finally {
            permits.release();
        }
    }

    private static Duration remaining(Duration budget, long started) {
        Duration timeout = budget.minusNanos(System.nanoTime() - started);
        if (timeout.isNegative() || timeout.isZero())
            throw new ProviderCallFailure(ErrorCode.DOWNSTREAM_TIMEOUT, "提供方发现或准备超时，未发送请求", Dispatch.NOT_SENT, null);
        return timeout;
    }
}
