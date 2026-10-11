package io.github.chenyilei2016.openplatform.domain.mcp;

import io.github.chenyilei2016.openplatform.domain.catalog.SchemaNode;
import io.github.chenyilei2016.openplatform.domain.catalog.SchemaType;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * API 契约（SchemaNode）到 MCP 工具 JSON Schema 的转换规则（117 第 6 节）。
 * 与平台请求校验保持同一语义：未声明字段拒绝、nullable 允许 null（枚举同样）、“必填但有默认值”的字段允许省略；
 * default 与 example 只作为注解输出，数值保持原始精度。结果为纯数据结构，由接口层统一编码为 JSON。
 */
public final class McpJsonSchema {
    private McpJsonSchema() {
    }

    /** 工具输入：MCP 要求根为对象，非对象请求结构不能作为工具。 */
    public static Map<String, Object> input(SchemaNode request) {
        if (request == null || request.type() != SchemaType.OBJECT)
            throw new IllegalArgumentException("MCP 工具的请求结构根必须是对象");
        Map<String, Object> schema = node(request, true);
        // tools/call.arguments 必须是对象，根结构不能声明为 object/null 联合类型。
        schema.put("type", "object");
        return schema;
    }

    /** 工具输出：描述 structuredContent = { data: 业务数据, requestId }。 */
    public static Map<String, Object> output(SchemaNode response) {
        Map<String, Object> properties = new LinkedHashMap<>();
        properties.put("data", response == null ? Map.of() : node(response, false));
        properties.put("requestId", Map.of("type", "string"));
        Map<String, Object> schema = new LinkedHashMap<>();
        schema.put("type", "object");
        schema.put("properties", properties);
        schema.put("required", List.of("data", "requestId"));
        schema.put("additionalProperties", false);
        return schema;
    }

    private static Map<String, Object> node(SchemaNode node, boolean request) {
        Map<String, Object> schema = new LinkedHashMap<>();
        String type = switch (node.type()) {
            case OBJECT -> "object";
            case ARRAY -> "array";
            case STRING -> "string";
            case INTEGER -> "integer";
            case NUMBER -> "number";
            case BOOLEAN -> "boolean";
        };
        schema.put("type", node.nullable() ? List.of(type, "null") : type);
        if (node.description() != null && !node.description().isBlank()) schema.put("description", node.description());
        if (!node.enumValues().isEmpty()) {
            List<Object> values = new ArrayList<>(node.enumValues());
            if (node.nullable()) values.add(null);
            schema.put("enum", values);
        }
        if (node.defaultValue() != null) schema.put("default", node.defaultValue());
        if (node.example() != null) schema.put("examples", List.of(node.example()));
        if (node.type() == SchemaType.OBJECT) {
            Map<String, Object> properties = new LinkedHashMap<>();
            List<String> required = new ArrayList<>();
            node.properties().forEach((name, child) -> {
                properties.put(name, node(child, request));
                if (child.required() && (!request || child.defaultValue() == null)) required.add(name);
            });
            schema.put("properties", properties);
            if (!required.isEmpty()) schema.put("required", List.copyOf(required));
            schema.put("additionalProperties", false);
        }
        if (node.type() == SchemaType.ARRAY && node.items() != null) schema.put("items", node(node.items(), request));
        return schema;
    }
}
