package io.github.chenyilei2016.openplatform.domain.runtime;

import io.github.chenyilei2016.openplatform.domain.catalog.ResponseAdapter;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiDefinitionContent;
import io.github.chenyilei2016.openplatform.domain.catalog.SchemaNode;
import io.github.chenyilei2016.openplatform.domain.catalog.SchemaType;
import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** 预览和正式调用共用的纯转换：业务判定 → 提取 → 公开字段投影及校验。 */
public final class ResponseAdaptation {
    public enum Stage { REQUEST, PROVIDER_CALL, BUSINESS, ADAPT, SCHEMA }
    public enum Reason { PROVIDER_BUSINESS_REJECTED, PATH_MISSING, TYPE_MISMATCH, REQUIRED_MISSING, FIELD_NOT_ALLOWED,
        NULL_NOT_ALLOWED, VALUE_NOT_ALLOWED, LIMIT_EXCEEDED, FIELD_PROJECTED, MESSAGE_UNAVAILABLE;
        public ErrorCode errorCode() { return this == PROVIDER_BUSINESS_REJECTED ? ErrorCode.PROVIDER_BUSINESS_REJECTED : ErrorCode.DOWNSTREAM_FAILED; }
        public String publicMessage() { return this == PROVIDER_BUSINESS_REJECTED ? "提供方业务拒绝" : "提供方返回不符合接口契约"; }
    }
    public record Issue(Stage stage, Reason reason, String path, String expectedType, String actualType) {
        public Issue { if (path.length() > 256) path = path.substring(0, 253) + "..."; }
    }
    public record Result(boolean succeeded, Object adaptedData, Object publicData, Issue issue,
                         List<Issue> warnings, String providerMessage, boolean businessAccepted) {}

    /** 异常消息只含公开语义；诊断另存，避免原始返回值进入异常日志或正式响应。 */
    public static final class Failure extends PlatformException {
        private final Issue issue;
        private final List<Issue> warnings;
        private final String providerMessage;
        public Failure(Issue issue, List<Issue> warnings, String providerMessage) {
            super(issue.reason().errorCode(), issue.reason().publicMessage());
            this.issue = issue;
            this.warnings = List.copyOf(warnings);
            this.providerMessage = providerMessage;
        }
        public Issue issue() { return issue; }
        public List<Issue> warnings() { return warnings; }
        public String providerMessage() { return providerMessage; }
    }

    /** 传输硬上限与适配预算共用可定位原因，不将超限误报为普通网络故障。 */
    public static Failure responseLimitExceeded() {
        return new Failure(new Issue(Stage.PROVIDER_CALL, Reason.LIMIT_EXCEEDED, "$", null, null), List.of(), null);
    }

    private final int maxNodes;
    private final int maxDepth;
    public ResponseAdaptation(int maxNodes, int maxDepth) {
        if (maxNodes < 1 || maxDepth < 1) throw new IllegalArgumentException("返回规模限制必须为正整数");
        this.maxNodes = maxNodes;
        this.maxDepth = maxDepth;
    }

    public Result apply(ResponseAdapter adapter, SchemaNode schema, Object sample) {
        adapter.validate();
        List<Issue> warnings = new ArrayList<>();
        Object data = null;
        boolean businessAccepted = adapter.mode() == ResponseAdapter.Mode.DIRECT;
        try {
            checkBudget(sample, "$", 1, new int[]{0});
            if (adapter.mode() == ResponseAdapter.Mode.ENVELOPE) {
                Object code = atPath(sample, adapter.successPath());
                if (code == null) fail(Stage.ADAPT, Reason.NULL_NOT_ALLOWED, "$." + adapter.successPath(), ResponseAdapter.scalarType(adapter.successValues().getFirst()), "NULL");
                String expected = ResponseAdapter.scalarType(adapter.successValues().getFirst());
                if (!expected.equals(ResponseAdapter.scalarType(code)))
                    fail(Stage.ADAPT, Reason.TYPE_MISMATCH, "$." + adapter.successPath(), expected, typeOf(code));
                if (!adapter.acceptsSuccess(code)) {
                    String message = businessMessage(sample, adapter.messagePath(), warnings);
                    return new Result(false, null, null, new Issue(Stage.BUSINESS, Reason.PROVIDER_BUSINESS_REJECTED,
                            "$." + adapter.successPath(), expected, typeOf(code)), List.copyOf(warnings), message, false);
                }
                businessAccepted = true;
                data = atPath(sample, adapter.dataPath());
            } else data = sample;
            Object projected = project(schema, data, "$", warnings);
            return new Result(true, data, projected, null, List.copyOf(warnings), null, businessAccepted);
        } catch (Failure failure) {
            return new Result(false, data, null, failure.issue(), List.copyOf(warnings), null, businessAccepted);
        }
    }

    private String businessMessage(Object sample, String path, List<Issue> warnings) {
        if (path == null) return null;
        try {
            Object value = atPath(sample, path);
            if (value instanceof String text && !text.isBlank()) return text;
            warnings.add(new Issue(Stage.BUSINESS, Reason.MESSAGE_UNAVAILABLE, "$." + path, "STRING", typeOf(value)));
        } catch (Failure failure) {
            warnings.add(new Issue(Stage.BUSINESS, Reason.MESSAGE_UNAVAILABLE, "$." + path, "STRING", "MISSING"));
        }
        return null;
    }

    private Object atPath(Object root, String path) {
        Object current = root;
        if (path.isEmpty()) return current;
        String currentPath = "$";
        for (String part : path.split("\\.")) {
            if (!(current instanceof Map<?, ?> object))
                fail(Stage.ADAPT, current == null ? Reason.NULL_NOT_ALLOWED : Reason.TYPE_MISMATCH,
                        currentPath, "OBJECT", typeOf(current));
            Map<?, ?> object = (Map<?, ?>) current;
            currentPath += "." + part;
            if (!object.containsKey(part)) fail(Stage.ADAPT, Reason.PATH_MISSING, currentPath, null, "MISSING");
            current = object.get(part);
        }
        return current;
    }

    private Object project(SchemaNode schema, Object value, String path, List<Issue> warnings) {
        if (value == null) {
            if (!schema.nullable()) fail(Stage.SCHEMA, Reason.NULL_NOT_ALLOWED, path, schema.type().name(), "NULL");
            return null;
        }
        if (!schema.type().accepts(value)) fail(Stage.SCHEMA, Reason.TYPE_MISMATCH, path, schema.type().name(), typeOf(value));
        if (schema.type() == SchemaType.OBJECT) {
            Map<?, ?> object = (Map<?, ?>) value;
            Map<String, Object> projected = new LinkedHashMap<>();
            for (Map.Entry<String, SchemaNode> entry : schema.properties().entrySet()) {
                String childPath = path + "." + entry.getKey();
                if (object.containsKey(entry.getKey())) projected.put(entry.getKey(), project(entry.getValue(), object.get(entry.getKey()), childPath, warnings));
                else if (entry.getValue().required()) fail(Stage.SCHEMA, Reason.REQUIRED_MISSING, childPath, entry.getValue().type().name(), "MISSING");
            }
            // 诊断仅列字段路径，不携带被投影掉的值；总量随节点预算有界。
            for (Object key : object.keySet()) if (!schema.properties().containsKey(key) && warnings.size() < 50)
                warnings.add(new Issue(Stage.SCHEMA, Reason.FIELD_PROJECTED, path + "." + key, null, null));
            return validateEnum(schema, projected, path);
        }
        if (schema.type() == SchemaType.ARRAY) {
            List<?> array = (List<?>) value;
            List<Object> projected = new ArrayList<>(array.size());
            for (int index = 0; index < array.size(); index++) projected.add(project(schema.items(), array.get(index), path + "[" + index + "]", warnings));
            return validateEnum(schema, projected, path);
        }
        return validateEnum(schema, value, path);
    }

    private Object validateEnum(SchemaNode schema, Object value, String path) {
        if (!schema.enumValues().isEmpty() && schema.enumValues().stream().noneMatch(item -> ApiDefinitionContent.sameValue(item, value)))
            fail(Stage.SCHEMA, Reason.VALUE_NOT_ALLOWED, path, schema.type().name(), typeOf(value));
        return value;
    }

    private void checkBudget(Object value, String path, int depth, int[] nodes) {
        if (depth > maxDepth || ++nodes[0] > maxNodes) fail(Stage.ADAPT, Reason.LIMIT_EXCEEDED, path, null, typeOf(value));
        if (value instanceof Map<?, ?> object) {
            for (Map.Entry<?, ?> entry : object.entrySet()) checkBudget(entry.getValue(), path + "." + entry.getKey(), depth + 1, nodes);
        } else if (value instanceof List<?> array) {
            for (int index = 0; index < array.size(); index++) checkBudget(array.get(index), path + "[" + index + "]", depth + 1, nodes);
        }
    }

    private static String typeOf(Object value) {
        if (value == null) return "NULL";
        if (value instanceof Map<?, ?>) return "OBJECT";
        if (value instanceof List<?>) return "ARRAY";
        String scalar = ResponseAdapter.scalarType(value);
        return scalar == null ? "UNSUPPORTED" : scalar;
    }
    private static void fail(Stage stage, Reason reason, String path, String expected, String actual) {
        throw new Failure(new Issue(stage, reason, path, expected, actual), List.of(), null);
    }
}
