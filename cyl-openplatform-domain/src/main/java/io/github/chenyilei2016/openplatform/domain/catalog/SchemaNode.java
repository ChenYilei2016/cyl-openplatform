package io.github.chenyilei2016.openplatform.domain.catalog;

import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.FieldValidation;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import java.util.LinkedHashMap;
import java.util.ArrayList;
import io.github.chenyilei2016.openplatform.domain.runtime.ResponseAdaptation;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.Collections;
import java.util.Locale;
import java.util.regex.Pattern;

/** 支持的 JSON 契约树；结构和示例使用同一套类型规则。 */
public record SchemaNode(SchemaType type, String description, Boolean required,
                         Map<String, SchemaNode> properties, SchemaNode items,
                         List<Object> enumValues, Object defaultValue, Object example, Boolean nullable) {
    private static final Pattern FIELD = Pattern.compile("[a-zA-Z][a-zA-Z0-9_]{0,63}");
    private static final Set<String> IDENTITIES = Set.of("applicationid", "appkey", "tenantid", "userid", "employeeid", "employeeno");

    public SchemaNode {
        required = Boolean.TRUE.equals(required);
        nullable = Boolean.TRUE.equals(nullable);
        properties = properties == null ? Map.of() : Collections.unmodifiableMap(new LinkedHashMap<>(properties));
        enumValues = enumValues == null ? List.of() : List.copyOf(enumValues);
    }

    public static boolean isIdentityField(String field) {
        return IDENTITIES.contains(field.replace("_", "").toLowerCase(Locale.ROOT));
    }

    public void validate(boolean request) {
        validate(request, 1, new int[]{0});
    }

    private void validate(boolean request, int depth, int[] count) {
        FieldValidation checks = new FieldValidation();
        checks.check(type != null, "/type", "请选择JSON结构类型");
        checks.check(depth <= 8 && ++count[0] <= 200 && properties.size() <= 50 && enumValues.size() <= 50,
                "", "JSON结构规模超出限制");
        checks.check(description == null || description.length() <= 500, "/description", "字段说明不能超过500字符");
        checks.check(type == SchemaType.OBJECT || properties.isEmpty(), "/properties", "仅OBJECT可定义properties");
        checks.check(type == SchemaType.ARRAY ? items != null : items == null, "/items", "仅ARRAY必须定义items");
        checks.requireValid(); // 无效容器不能继续递归或校验示例。
        for (Map.Entry<String, SchemaNode> property : properties.entrySet()) {
            String path = "/properties/" + FieldValidation.segment(property.getKey());
            if (!FIELD.matcher(property.getKey()).matches() || property.getValue() == null)
                checks.check(false, path, "字段名或子结构不合法");
            else {
                checks.check(!(request && isIdentityField(property.getKey())), path, "请求不能定义可信身份字段");
                checks.inspect(path, () -> property.getValue().validate(request, depth + 1, count));
            }
        }
        if (items != null) checks.inspect("/items", () -> items.validate(request, depth + 1, count));
        checks.requireValid();
        for (int index = 0; index < enumValues.size(); index++) {
            Object value = enumValues.get(index);
            checks.inspect("/enumValues/" + index, () -> validateValue(value, false));
        }
        if (defaultValue != null) checks.inspect("/defaultValue", () -> validateValue(defaultValue, true));
        if (example != null) checks.inspect("/example", () -> validateValue(example, true));
        checks.requireValid();
    }

    /** 文档示例与真实请求共用类型、字段和枚举规则；示例数组另有200项上限。 */
    public void validateValue(Object value, boolean checkEnum) {
        List<ResponseAdaptation.Issue> issues = new ArrayList<>();
        inspectValue(value, "$", checkEnum, true, false, new int[]{0}, issues);
        if (!issues.isEmpty()) invalid("JSON值不符合结构：" + issues.getFirst().path() + " / " + issues.getFirst().reason());
    }

    /** 默认值补齐前允许缺省字段，补齐后校验枚举；一次报告至多20个问题。 */
    public List<ResponseAdaptation.Issue> requestIssues(Object value, boolean beforeDefaults) {
        List<ResponseAdaptation.Issue> issues = new ArrayList<>();
        inspectValue(value, "$", !beforeDefaults, false, beforeDefaults, new int[]{0}, issues);
        return List.copyOf(issues);
    }

    private void inspectValue(Object value, String path, boolean checkEnum, boolean exampleValue, boolean beforeDefaults,
                              int[] nodes, List<ResponseAdaptation.Issue> issues) {
        if (issues.size() >= 20) return;
        if (++nodes[0] > 20_000) { issue(issues, path, ResponseAdaptation.Reason.LIMIT_EXCEEDED, value); return; }
        if (value == null) {
            if (!nullable) issue(issues, path, ResponseAdaptation.Reason.NULL_NOT_ALLOWED, null);
            return;
        }
        if (type == null || !type.accepts(value)) { issue(issues, path, ResponseAdaptation.Reason.TYPE_MISMATCH, value); return; }
        if (checkEnum && !enumValues.isEmpty() && enumValues.stream().noneMatch(item -> ApiDefinitionContent.sameValue(item, value)))
            issue(issues, path, ResponseAdaptation.Reason.VALUE_NOT_ALLOWED, value);
        if (value instanceof Map<?, ?> object) {
            for (Object key : object.keySet()) if (!properties.containsKey(key))
                issue(issues, path + "." + key, ResponseAdaptation.Reason.FIELD_NOT_ALLOWED, object.get(key));
            for (Map.Entry<String, SchemaNode> entry : properties.entrySet()) {
                SchemaNode child = entry.getValue();
                if (object.containsKey(entry.getKey())) child.inspectValue(object.get(entry.getKey()), path + "." + entry.getKey(), !beforeDefaults, exampleValue, beforeDefaults, nodes, issues);
                else if (child.required() && !(beforeDefaults && child.defaultValue() != null))
                    child.issue(issues, path + "." + entry.getKey(), ResponseAdaptation.Reason.REQUIRED_MISSING, null);
            }
        } else if (value instanceof List<?> list) {
            if (exampleValue && list.size() > 200) { issue(issues, path, ResponseAdaptation.Reason.LIMIT_EXCEEDED, value); return; }
            for (int index = 0; index < list.size() && issues.size() < 20; index++)
                items.inspectValue(list.get(index), path + "[" + index + "]", !beforeDefaults, exampleValue, beforeDefaults, nodes, issues);
        } else if (value instanceof String text && text.length() > 10_000) issue(issues, path, ResponseAdaptation.Reason.LIMIT_EXCEEDED, value);
    }
    private void issue(List<ResponseAdaptation.Issue> issues, String path, ResponseAdaptation.Reason reason, Object actual) {
        if (issues.size() >= 20) return;
        String actualType = reason == ResponseAdaptation.Reason.REQUIRED_MISSING ? "MISSING" : actual == null ? "NULL"
                : actual instanceof Map<?, ?> ? "OBJECT" : actual instanceof List<?> ? "ARRAY" : ResponseAdapter.scalarType(actual);
        issues.add(new ResponseAdaptation.Issue(ResponseAdaptation.Stage.REQUEST, reason, path, type == null ? "UNKNOWN" : type.name(), actualType));
    }

    /** 仅补缺失字段；先验证容器规模并累计节点预算，避免小请求触发嵌套默认值指数展开。 */
    public Object applyDefaults(Object value) {
        return applyDefaults(value, new int[]{0});
    }

    private Object applyDefaults(Object value, int[] expandedNodes) {
        if (++expandedNodes[0] > 20_000) {
            invalid("默认值展开后的JSON节点超出限制");
        }
        if (value instanceof Map<?, ?> object && type == SchemaType.OBJECT) {
            if (object.size() > 50 || object.keySet().stream().anyMatch(key -> !properties.containsKey(key))) {
                invalid("JSON对象字段数量超限或存在未声明字段");
            }
            Map<String, Object> result = new LinkedHashMap<>();
            properties.forEach((key, schema) -> {
                if (object.containsKey(key)) {
                    result.put(key, schema.applyDefaults(object.get(key), expandedNodes));
                } else if (schema.defaultValue() != null) {
                    result.put(key, schema.applyDefaults(schema.defaultValue(), expandedNodes));
                }
            });
            return result;
        }
        if (value instanceof List<?> array && type == SchemaType.ARRAY) {
            if (array.size() > 20_000) {
                invalid("JSON数组元素数量超出限制");
            }
            return array.stream().map(item -> items.applyDefaults(item, expandedNodes)).toList();
        }
        return value;
    }

    public SchemaNode atPath(String path) {
        SchemaNode current = this;
        for (String segment : path.split("\\.", -1)) {
            if (!FIELD.matcher(segment).matches() || current.type != SchemaType.OBJECT) return null;
            current = current.properties.get(segment);
            if (current == null) return null;
        }
        return current;
    }

    public Object generatedExample() {
        if (example != null) return example;
        if (defaultValue != null) return defaultValue;
        if (!enumValues.isEmpty()) return enumValues.getFirst();
        return switch (type) {
            case OBJECT -> {
                Map<String, Object> result = new LinkedHashMap<>();
                properties.forEach((key, value) -> result.put(key, value.generatedExample()));
                yield result;
            }
            case ARRAY -> List.of(items.generatedExample());
            case STRING -> "示例";
            case INTEGER -> 1;
            case NUMBER -> new java.math.BigDecimal("1.0");
            case BOOLEAN -> true;
        };
    }

    private static void invalid(String message) { throw new PlatformException(ErrorCode.INVALID_REQUEST, message); }
}
