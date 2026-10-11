package io.github.chenyilei2016.openplatform.infrastructure.environmentrelease;

import io.github.chenyilei2016.openplatform.domain.common.PageResult;
import io.github.chenyilei2016.openplatform.domain.access.EmployeeProfile;
import io.github.chenyilei2016.openplatform.domain.access.EmployeeProfileQuery;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiDefinition;
import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.github.chenyilei2016.openplatform.domain.environmentrelease.EnvironmentReleaseClient;
import io.github.chenyilei2016.openplatform.domain.environmentrelease.EnvironmentReleaseModels.*;
import io.github.chenyilei2016.openplatform.infrastructure.common.BoundedOutputStream;
import io.github.chenyilei2016.openplatform.infrastructure.common.HttpTracePropagation;
import io.opentelemetry.context.Context;
import io.github.chenyilei2016.openplatform.infrastructure.environmentrelease.EnvironmentReleaseSettings.Node;
import io.github.chenyilei2016.openplatform.infrastructure.environmentrelease.EnvironmentReleaseSettings.RemoteTarget;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.Semaphore;
import lombok.extern.slf4j.Slf4j;
import org.slf4j.MDC;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import tools.jackson.core.ObjectReadContext;
import tools.jackson.core.StreamReadFeature;
import tools.jackson.core.json.JsonFactory;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.json.JsonMapper;

/** 固定节点单次传输，网络故障保留未知结果；刷新仅返回本次实际观测。 */
@Slf4j
@Component
public class WebClientEnvironmentReleaseClient implements EnvironmentReleaseClient {
    private static final String PATH = "/internal-api/environment-releases/v1";
    private static final String UNKNOWN = "目标结果未知，请刷新状态或按原传输重试";
    private static final String INVALID_RESPONSE = "目标响应不合法或身份不匹配";
    private static final Duration DEADLINE = Duration.ofSeconds(5);
    private final WebClient client;
    private final JsonMapper json;
    private final JsonFactory responseFactory;
    private final EnvironmentReleaseSettings environment;
    private final Semaphore permits = new Semaphore(16);

    public WebClientEnvironmentReleaseClient(@Qualifier("environmentReleaseHttpClient") WebClient client,
                                            JsonMapper json, EnvironmentReleaseSettings environment) {
        this.client = client;
        this.json = json;
        this.environment = environment;
        // 预览同时包含before/after；只扩响应解析器容量，保留全局结构、精度和模块规则。
        this.responseFactory = ((JsonFactory) json.tokenStreamFactory()).rebuild()
                .streamReadConstraints(json.tokenStreamFactory().streamReadConstraints().rebuild()
                        .maxDocumentLength(1_048_576).maxTokenCount(80_000).build())
                .enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION).build();
    }

    @Override
    public ConnectionDirectory connections(String targetId, int page, int pageSize, String query) {
        RemoteTarget target = environment.requireTarget(targetId);
        Node node = target.nodes().getFirst();
        String path = org.springframework.web.util.UriComponentsBuilder.fromPath(PATH + "/dubbo-connections")
                .queryParam("page", page).queryParam("pageSize", pageSize).queryParam("query", "{query}").encode().buildAndExpand(query).toUriString();
        try {
            Reply reply = exchange(target, node, HttpMethod.GET, path, null).block();
            if (reply.rejected()) throw new PlatformException(ErrorCode.CONFLICT, rejection(target, "读取服务连接目录", reply, List.of()));
            requireInteger(reply.data(), "page");
            requireInteger(reply.data(), "pageSize");
            requireInteger(reply.data(), "total");
            if (!(reply.data().get("items") instanceof List<?> items) || items.size() > pageSize)
                throw new IllegalArgumentException(INVALID_RESPONSE);
            for (Object item : items) {
                if (!(item instanceof Map<?, ?> option) || !(option.get("revision") instanceof Integer || option.get("revision") instanceof Long))
                    throw new IllegalArgumentException(INVALID_RESPONSE);
            }
            ConnectionDirectory directory = json.convertValue(reply.data(), ConnectionDirectory.class);
            if (!targetId.equals(directory.environmentId()) || !node.id().equals(directory.nodeId())
                    || directory.page() != page || directory.pageSize() != pageSize || directory.total() < 0
                    || directory.items() == null || directory.items().size() > pageSize
                    || directory.items().stream().anyMatch(option -> option.id() == null || option.id().length() > 36
                    || option.name() == null || option.name().length() > 100 || option.revision() < 1))
                throw new IllegalArgumentException(INVALID_RESPONSE);
            return directory;
        } catch (PlatformException failure) {
            throw failure;
        } catch (RuntimeException failure) {
            throw new PlatformException(ErrorCode.DOWNSTREAM_FAILED, "无法读取目标服务连接，请稍后重试", failure);
        }
    }

    @Override
    public PageResult<EmployeeProfile> owners(
            String targetId, EmployeeProfileQuery query) {
        RemoteTarget target = environment.requireTarget(targetId);
        String path = org.springframework.web.util.UriComponentsBuilder.fromPath(PATH + "/owners")
                .queryParam("tenantId","{tenantId}").queryParam("page",query.page()).queryParam("pageSize",query.pageSize())
                .queryParam("name","{name}").queryParam("employeeNo","{employeeNo}")
                .encode().buildAndExpand(Map.of("tenantId",query.tenantId(),"name",query.name() == null ? "" : query.name(),
                        "employeeNo",query.employeeNo() == null ? "" : query.employeeNo())).toUriString();
        try {
            Reply reply = exchange(target,target.nodes().getFirst(),HttpMethod.GET,path,null).block();
            if (reply.rejected()) throw new PlatformException(ErrorCode.CONFLICT,rejection(target, "读取负责人目录", reply, List.of()));
            requireInteger(reply.data(),"page");requireInteger(reply.data(),"pageSize");requireInteger(reply.data(),"total");
            if (!(reply.data().get("items") instanceof List<?> items) || items.size()>query.pageSize()) throw new IllegalArgumentException(INVALID_RESPONSE);
            PageResult<EmployeeProfile> result = json.convertValue(reply.data(),
                    json.getTypeFactory().constructParametricType(PageResult.class,EmployeeProfile.class));
            if (result.page()!=query.page() || result.pageSize()!=query.pageSize() || result.total()<0
                    || result.items().stream().anyMatch(person -> !query.tenantId().equals(person.tenantId()) || person.id()==null || person.id().length()>36)) throw new IllegalArgumentException(INVALID_RESPONSE);
            return result;
        } catch (PlatformException failure) { throw failure; }
        catch (RuntimeException failure) { throw new PlatformException(ErrorCode.DOWNSTREAM_FAILED,"无法读取目标负责人目录，请重试",failure); }
    }

    @Override
    public Preview preview(String targetId, ApiDefinition definition) {
        RemoteTarget target = environment.requireTarget(targetId);
        Node node = target.nodes().getFirst();
        try {
            Reply reply = exchange(target, node, HttpMethod.POST, PATH + "/preview",
                    new PreviewRequest(environment.environmentId(), targetId, definition)).block();
            if (reply.rejected()) throw new PlatformException(ErrorCode.CONFLICT, rejection(target, "预览", reply, definition.scopeCodes()));
            var data = reply.data();
            requireInteger(data, "expectedRevision");
            if (!(data.get("auditRequired") instanceof Boolean)) throw new IllegalArgumentException();
            Preview preview = json.convertValue(data, Preview.class);
            if (definition.employeeRequired() && !preview.definition().employeeRequired())
                throw new PlatformException(ErrorCode.CONFLICT, "目标环境不支持必须指定调用员工，拒绝传输");
            if (!targetId.equals(preview.environmentId()) || !node.id().equals(preview.nodeId())
                    || !Objects.equals(definition, preview.definition()) || preview.expectedRevision() < 0
                    || preview.changedFields() == null || preview.previewDigest() == null
                    || !preview.previewDigest().matches("[a-f0-9]{64}")
                    || !Set.of("CREATE", "UPDATE", "UNCHANGED").contains(preview.change())) {
                throw new IllegalArgumentException();
            }
            return preview;
        } catch (PlatformException failure) {
            throw failure;
        } catch (RuntimeException failure) {
            throw new PlatformException(ErrorCode.DOWNSTREAM_FAILED, "无法取得有效目标预览，请稍后重试", failure);
        }
    }

    @Override
    public DeliveryResult receive(String targetId, SendRequest request) {
        RemoteTarget target = environment.requireTarget(targetId);
        if (!environment.environmentId().equals(request.sourceEnvironment()) || !targetId.equals(request.targetEnvironment())) {
            throw new PlatformException(ErrorCode.INVALID_REQUEST, "传输来源或目标与配置不一致");
        }
        Node node = target.nodes().getFirst();
        try {
            Reply reply = exchange(target, node, HttpMethod.POST, PATH + "/receive", request).block();
            if (reply.rejected()) return new DeliveryResult(null, true, rejection(target, "接收", reply, request.definition() == null ? List.of() : request.definition().scopeCodes()));
            return new DeliveryResult(receipt(reply.data(), target, node, request.transferId()), false, null);
        } catch (RuntimeException failure) {
            log.warn("跨环境传输结果未知 targetId={} nodeId={} transferId={}", target.id(), node.id(), request.transferId(), failure);
            return new DeliveryResult(null, false, UNKNOWN);
        }
    }

    @Override
    public List<NodeObservation> observe(String targetId, String transferId) {
        Context callerContext = Context.current();
        String requestId = MDC.get("requestId");
        String traceId = MDC.get("traceId");
        RemoteTarget target = environment.requireTarget(targetId);
        try {
            if (!UUID.fromString(transferId).toString().equals(transferId)) throw new IllegalArgumentException();
        } catch (RuntimeException invalid) {
            throw new PlatformException(ErrorCode.INVALID_REQUEST, "传输ID不合法");
        }
        return Flux.fromIterable(target.nodes()).flatMapSequential(node ->
                exchange(target, node, HttpMethod.GET, PATH + "/receipts/" + transferId, null)
                        .map(reply -> new NodeObservation(node.id(),
                                reply.rejected() ? null : receipt(reply.data(), target, node, transferId),
                                reply.rejected() ? rejection(target, "查询回执", reply, List.of()) : null, Instant.now()))
                        .onErrorResume(failure -> {
                            log.warn("跨环境节点观测失败 targetId={} nodeId={} transferId={} requestId={} traceId={}",
                                    target.id(), node.id(), transferId, requestId, traceId, failure);
                            return Mono.just(new NodeObservation(node.id(), null, "暂时无法读取该节点状态，请刷新观测或检查节点连接", Instant.now()));
                        }), 4)
                .collectList().contextWrite(context -> context.put(Context.class, callerContext)).block();
    }

    private Mono<Reply> exchange(RemoteTarget target, Node node, HttpMethod method, String path, Object body) {
        Context callerContext = Context.current();
        return Mono.deferContextual(subscriberContext -> {
            Context traceContext = subscriberContext.getOrDefault(Context.class, callerContext);
            if (!permits.tryAcquire()) return Mono.error(new PlatformException(ErrorCode.RATE_LIMITED, "跨环境并发调用已达上限"));
            return Mono.defer(() -> {
                // Query variables are already encoded; the URI overload avoids encoding percent signs again.
                WebClient.RequestBodySpec request = client.method(method).uri(java.net.URI.create(node.origin() + path)).accept(MediaType.APPLICATION_JSON)
                        .httpRequest(httpRequest -> HttpTracePropagation.injectIfAbsent(traceContext, httpRequest.getHeaders()))
                        .header("Authorization", "Bearer " + target.credential())
                        .header("X-Platform-Source", environment.environmentId());
                WebClient.RequestHeadersSpec<?> outgoing = request;
                if (body != null) {
                    var encoded = new BoundedOutputStream(262_144);
                    json.writeValue(encoded, body);
                    outgoing = request.contentType(MediaType.APPLICATION_JSON).bodyValue(encoded.toByteArray());
                }
                return outgoing.exchangeToMono(response -> {
                    int status = response.statusCode().value();
                    var contentType = response.headers().contentType().orElse(MediaType.APPLICATION_OCTET_STREAM);
                    if (!(MediaType.APPLICATION_JSON.isCompatibleWith(contentType)
                            || ("application".equals(contentType.getType()) && contentType.getSubtype().endsWith("+json")))) {
                        return Mono.error(new IllegalArgumentException(INVALID_RESPONSE));
                    }
                    if (status != 200 && !Set.of(400, 401, 403, 404, 409, 413, 415, 429).contains(status)) {
                        return Mono.error(new IllegalArgumentException(INVALID_RESPONSE));
                    }
                    return response.bodyToMono(byte[].class).switchIfEmpty(Mono.error(new IllegalArgumentException(INVALID_RESPONSE)))
                            .map(bytes -> {
                                try (var parser = responseFactory.createParser(ObjectReadContext.empty(), bytes)) {
                                    Envelope envelope = json.readerFor(Envelope.class)
                                            .with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS).readValue(parser);
                                    if (!(envelope.code() instanceof Integer code) || envelope.requestId() == null
                                            || envelope.requestId().isBlank() || envelope.resultMsg() == null
                                            || (status == 200 ? code != 200 || envelope.data() == null
                                            : code / 100_000 != status || envelope.data() != null)) {
                                        throw new IllegalArgumentException(INVALID_RESPONSE);
                                    }
                                    return new Reply(status != 200, envelope.data(), status, code, envelope.resultMsg(), envelope.requestId());
                                }
                            });
                });
            }).timeout(DEADLINE).doFinally(signal -> permits.release());
        });
    }

    private Receipt receipt(Map<String, Object> data, RemoteTarget target, Node node, String transferId) {
        requireInteger(data, "draftRevision");
        requireInteger(data, "stateVersion");
        if (!(data.get("enabled") instanceof Boolean) || !(data.get("auditRequired") instanceof Boolean)) {
            throw new IllegalArgumentException(INVALID_RESPONSE);
        }
        Receipt receipt = json.convertValue(data, Receipt.class);
        if (!target.id().equals(receipt.environmentId()) || !node.id().equals(receipt.nodeId())
                || !environment.environmentId().equals(receipt.sourceEnvironment()) || !transferId.equals(receipt.transferId())
                || receipt.apiId() == null || receipt.apiId().isBlank() || receipt.releaseId() == null || receipt.releaseId().isBlank()
                || receipt.draftRevision() < 1 || receipt.stateVersion() < 0 || receipt.status() == null || receipt.observedAt() == null) {
            throw new IllegalArgumentException(INVALID_RESPONSE);
        }
        return receipt;
    }

    private static void requireInteger(Map<String, Object> data, String name) {
        if (data == null || !(data.get(name) instanceof Integer || data.get(name) instanceof Long)) {
            throw new IllegalArgumentException(INVALID_RESPONSE);
        }
    }

    private record Envelope(Object code, String resultMsg, Map<String, Object> data, String requestId) {}
    private static String rejection(RemoteTarget target, String action, Reply reply, List<String> requiredScopes) {
        return EnvironmentReleaseRejection.describe(target, action, reply.status(), reply.code(), reply.message(), reply.requestId(), requiredScopes);
    }

    private record Reply(boolean rejected, Map<String, Object> data, int status, int code, String message, String requestId) {}
}
