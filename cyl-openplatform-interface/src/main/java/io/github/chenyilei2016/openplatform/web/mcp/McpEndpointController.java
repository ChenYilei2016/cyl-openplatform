package io.github.chenyilei2016.openplatform.web.mcp;

import io.github.chenyilei2016.openplatform.application.mcp.McpInvocationService;
import io.github.chenyilei2016.openplatform.application.mcp.McpSignatureVerifier;
import io.github.chenyilei2016.openplatform.application.mcp.McpToolCatalogService;
import io.github.chenyilei2016.openplatform.application.mcp.McpToolSetService;
import io.github.chenyilei2016.openplatform.application.observability.ObservationService;
import io.github.chenyilei2016.openplatform.application.runtime.ApiInvocationExecutor;
import io.github.chenyilei2016.openplatform.application.runtime.InvocationFailure;
import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.ObjectIdType;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.github.chenyilei2016.openplatform.domain.observability.CallChannel;
import io.github.chenyilei2016.openplatform.domain.observability.CallMode;
import io.github.chenyilei2016.openplatform.domain.observability.CallRecord;
import io.github.chenyilei2016.openplatform.domain.runtime.InvocationDiagnostics.Dispatch;
import io.github.chenyilei2016.openplatform.domain.signature.SignedRequest;
import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.math.BigInteger;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.Semaphore;
import lombok.RequiredArgsConstructor;
import org.slf4j.MDC;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.json.JsonMapper;

/** 无会话、JSON响应的MCP 2025-06-18入口；标准业务响应包装不参与JSON-RPC。 */
@RestController
@RequiredArgsConstructor
public class McpEndpointController {
    private static final String VERSION = "2025-06-18";
    private final McpRequestReader reader;
    private final McpSignatureVerifier signatures;
    private final McpToolCatalogService catalog;
    private final McpToolSetService sets;
    private final McpInvocationService invocations;
    private final ObservationService observations;
    private final JsonMapper json;
    private final Semaphore inFlight = new Semaphore(32);

    /** 供MCP网关调用的签名MCP入口；SZ-HMAC-SHA256认证；工具调用身份只取签名覆盖的请求头；不建立会话。 */
    @PostMapping(value = {"/mcp/v1", "/mcp/v1/sets/{code}"}, produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<?> handle(@PathVariable(required = false) String code, HttpServletRequest request) {
        if (!inFlight.tryAcquire()) return response(429, rpcError(null, -32000, "MCP请求并发已满", ErrorCode.RATE_LIMITED));
        long started = System.nanoTime();
        Object id = null;
        CallRecord.CallRecordBuilder observation = null;
        ResponseEntity<?> result = null;
        try {
            SignedRequest signed = reader.read(request, code);
            Map<String, Object> rpc = readRpc(signed.body());
            id = rpc.get("id");
            String method = (String) rpc.get("method");
            if (method.equals("tools/call") && id != null) observation = CallRecord.builder()
                    .id(ObjectIdType.CALL_RECORD.nextId()).requestId(MDC.get("requestId")).mode(CallMode.PRODUCTION)
                    .channel(CallChannel.MCP).clientIp(request.getRemoteAddr()).occurredAt(Instant.now());
            McpSignatureVerifier.VerifiedGateway gateway = signatures.verify(signed);
            String setId = sets.requireActiveId(code);
            if (!method.equals("initialize") && !VERSION.equals(request.getHeader("MCP-Protocol-Version")))
                throw new ProtocolFailure(-32600, "请携带MCP-Protocol-Version: " + VERSION);
            Map<String, Object> params = object(rpc.getOrDefault("params", Map.of()));
            if (id == null) {
                if (!method.startsWith("notifications/")) throw new ProtocolFailure(-32600, "请求必须包含id");
                result = response(202, null);
            } else {
                Object body = switch (method) {
                    case "initialize" -> initialize(params);
                    case "ping" -> Map.of();
                    case "tools/list" -> list(setId, params);
                    case "tools/call" -> call(gateway, signed, setId, params, observation);
                    default -> throw new ProtocolFailure(-32601, "Method not found");
                };
                result = response(200, Map.of("jsonrpc", "2.0", "id", id, "result", body));
            }
        } catch (ProtocolFailure failure) {
            if (observation != null) observation.errorCode(ErrorCode.INVALID_REQUEST.getCode());
            result = response(failure.code == -32601 || failure.code == -32602 ? 200 : 400,
                    rpcError(id, failure.code, failure.getMessage(), ErrorCode.INVALID_REQUEST));
        } catch (PlatformException failure) {
            if (observation != null) observation.errorCode(failure.getErrorCode().getCode());
            result = response(failure.getErrorCode().httpStatus(), rpcError(id, -32000, failure.getMessage(), failure.getErrorCode()));
        } catch (IOException failure) {
            result = response(400, rpcError(id, -32700, "请求正文读取失败", ErrorCode.INVALID_REQUEST));
        } catch (RuntimeException failure) {
            if (observation != null) observation.errorCode(ErrorCode.INTERNAL_ERROR.getCode());
            result = response(500, rpcError(id, -32603, "MCP服务暂不可用", ErrorCode.INTERNAL_ERROR));
        } finally {
            try {
                if (observation != null) {
                    int status = result == null ? 500 : result.getStatusCode().value();
                    observations.record(observation.httpStatus(status)
                            .outcome(status == 200 && observation.build().errorCode() == null ? "SUCCESS" : "FAILURE")
                            .durationMillis((System.nanoTime() - started) / 1_000_000).build());
                }
            } finally { inFlight.release(); }
        }
        return result;
    }

    private Object initialize(Map<String, Object> params) {
        if (!(params.get("protocolVersion") instanceof String) || !(params.get("capabilities") instanceof Map<?, ?>)
                || !(params.get("clientInfo") instanceof Map<?, ?>)) throw new ProtocolFailure(-32602, "初始化参数不完整");
        return Map.of("protocolVersion", VERSION, "capabilities", Map.of("tools", Map.of("listChanged", false)),
                "serverInfo", Map.of("name", "cyl-openplatform", "version", "1.0"));
    }

    private Object list(String setId, Map<String, Object> params) {
        Object cursor = params.get("cursor");
        if (cursor != null && !(cursor instanceof String)) throw new ProtocolFailure(-32602, "cursor必须为字符串");
        McpToolCatalogService.CatalogPage page = catalog.list(setId, (String) cursor);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("tools", page.tools());
        if (page.nextCursor() != null) result.put("nextCursor", page.nextCursor());
        return result;
    }

    private Object call(McpSignatureVerifier.VerifiedGateway gateway, SignedRequest signed, String setId,
                        Map<String, Object> params, CallRecord.CallRecordBuilder observation) {
        if (!(params.get("name") instanceof String name) || !name.matches("[a-zA-Z0-9_]{1,64}"))
            throw new ProtocolFailure(-32602, "工具名不合法");
        Map<String, Object> arguments = object(params.getOrDefault("arguments", Map.of()));
        observation.toolName(name);
        try {
            ApiInvocationExecutor.ExecutionResult executed = invocations.call(gateway, signed, name, setId, arguments,
                    MDC.get("requestId"), observation.build().clientIp(), observation);
            Map<String, Object> content = new LinkedHashMap<>();
            content.put("data", executed.data());
            content.put("requestId", MDC.get("requestId"));
            return Map.of("content", List.of(Map.of("type", "text", "text", json.writeValueAsString(content))),
                    "structuredContent", content, "isError", false);
        } catch (PlatformException failure) {
            observation.errorCode(failure.getErrorCode().getCode());
            Dispatch dispatch = failure instanceof InvocationFailure invocation ? invocation.diagnostics().providerDispatch() : Dispatch.NOT_SENT;
            if (failure.getErrorCode() == ErrorCode.INVALID_SIGNATURE
                    || failure.getErrorCode() == ErrorCode.DEPENDENCY_UNAVAILABLE && dispatch == Dispatch.NOT_SENT
                    || failure.getErrorCode() == ErrorCode.RATE_LIMITED && failure instanceof InvocationFailure && dispatch == Dispatch.NOT_SENT) throw failure;
            return toolError(failure.getErrorCode(), failure.getMessage(), dispatch);
        } catch (RuntimeException failure) {
            observation.errorCode(ErrorCode.INTERNAL_ERROR.getCode());
            return toolError(ErrorCode.INTERNAL_ERROR, "调用结果无法确认，请凭requestId核对后再决定是否重试", Dispatch.UNKNOWN);
        }
    }

    private Object toolError(ErrorCode error, String message, Dispatch dispatch) {
        Map<String, Object> content = Map.of("code", error.getCode(), "message", message,
                "requestId", MDC.get("requestId"), "dispatch", dispatch.name());
        return Map.of("content", List.of(Map.of("type", "text", "text", json.writeValueAsString(content))), "isError", true);
    }

    private Map<String, Object> readRpc(byte[] bytes) {
        Object raw;
        try { raw = json.readerFor(Object.class).with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS).readValue(bytes); }
        catch (RuntimeException invalid) { throw new ProtocolFailure(-32700, "Parse error"); }
        if (!(raw instanceof Map<?, ?> values)) throw new ProtocolFailure(-32600, "只接受单条JSON-RPC消息");
        if (!"2.0".equals(values.get("jsonrpc")) || !(values.get("method") instanceof String method) || method.isBlank()
                || method.length() > 100 || !Set.of("jsonrpc", "id", "method", "params").containsAll(values.keySet()))
            throw new ProtocolFailure(-32600, "Invalid Request");
        Object id = values.get("id");
        if (values.containsKey("id") && !(id instanceof String
                || id instanceof Integer || id instanceof Long || id instanceof BigInteger))
            throw new ProtocolFailure(-32600, "请求id须为字符串或整数");
        @SuppressWarnings("unchecked") Map<String, Object> rpc = (Map<String, Object>) values;
        return rpc;
    }

    private static Map<String, Object> object(Object value) {
        if (!(value instanceof Map<?, ?>)) throw new ProtocolFailure(-32602, "参数必须为JSON对象");
        @SuppressWarnings("unchecked") Map<String, Object> object = (Map<String, Object>) value;
        return object;
    }
    private static Map<String, Object> rpcError(Object id, int code, String message, ErrorCode error) {
        Map<String, Object> response = new LinkedHashMap<>();
        response.put("jsonrpc", "2.0"); response.put("id", id);
        response.put("error", Map.of("code", code, "message", message,
                "data", Map.of("code", error.getCode(), "requestId", MDC.get("requestId"))));
        return response;
    }
    private static ResponseEntity<?> response(int status, Object body) {
        ResponseEntity.BodyBuilder response = ResponseEntity.status(status).header("Cache-Control", "no-store");
        if (status == 429) response.header("Retry-After", "1");
        return body == null ? response.build() : response.contentType(MediaType.APPLICATION_JSON).body(body);
    }
    private static final class ProtocolFailure extends RuntimeException {
        private final int code;
        private ProtocolFailure(int code, String message) { super(message); this.code = code; }
    }
}
