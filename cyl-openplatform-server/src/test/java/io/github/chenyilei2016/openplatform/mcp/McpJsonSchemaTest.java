package io.github.chenyilei2016.openplatform.mcp;

import io.github.chenyilei2016.openplatform.domain.catalog.SchemaNode;
import io.github.chenyilei2016.openplatform.domain.mcp.McpJsonSchema;
import java.math.BigDecimal;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.json.JsonMapper;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class McpJsonSchemaTest {
    private final JsonMapper json = JsonMapper.builder().enable(DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS).build();

    @SuppressWarnings("unchecked")
    private static Map<String, Object> map(Object value) {
        return (Map<String, Object>) value;
    }

    private SchemaNode schema(String text) {
        return json.readValue(text, SchemaNode.class);
    }

    @Test
    void requestObjectBecomesStrictInputSchemaAndFieldsWithDefaultsMayBeOmitted() {
        Map<String, Object> input = McpJsonSchema.input(schema("""
                {"type":"OBJECT","properties":{
                  "orderNo":{"type":"STRING","required":true,"description":"订单号","example":"A001"},
                  "pageSize":{"type":"INTEGER","required":true,"defaultValue":20},
                  "remark":{"type":"STRING"}}}
                """));
        assertThat(input).containsEntry("type", "object").containsEntry("additionalProperties", false);
        // 平台在默认值补齐前允许缺省“必填但有默认值”的字段，MCP 也必须允许省略（default 只是注解，不会替调用方填值）。
        assertThat(input.get("required")).isEqualTo(List.of("orderNo"));
        Map<String, Object> properties = map(input.get("properties"));
        assertThat(properties.get("orderNo")).isEqualTo(Map.of("type", "string", "description", "订单号", "examples", List.of("A001")));
        assertThat(map(properties.get("pageSize"))).containsEntry("type", "integer").containsEntry("default", 20);
    }

    @Test
    void nullableTypesAndEnumsAllowNullLikeThePlatformValidator() {
        Map<String, Object> input = McpJsonSchema.input(schema("""
                {"type":"OBJECT","properties":{
                  "status":{"type":"STRING","nullable":true,"enumValues":["OPEN","CLOSED"]},
                  "amount":{"type":"NUMBER","nullable":true}}}
                """));
        Map<String, Object> properties = map(input.get("properties"));
        assertThat(map(properties.get("status"))).containsEntry("type", List.of("string", "null"))
                .containsEntry("enum", Arrays.asList("OPEN", "CLOSED", null));
        assertThat(map(properties.get("amount"))).containsEntry("type", List.of("number", "null"));
        assertThat(input).doesNotContainKey("required");
    }

    @Test
    void nestedObjectsArraysAndExactNumbersArePreserved() {
        Map<String, Object> input = McpJsonSchema.input(schema("""
                {"type":"OBJECT","properties":{"items":{"type":"ARRAY","required":true,"items":{"type":"OBJECT","properties":{
                  "sku":{"type":"STRING","required":true},
                  "price":{"type":"NUMBER","enumValues":[1.00000000000000000001]}}}}}}
                """));
        Map<String, Object> items = map(map(input.get("properties")).get("items"));
        assertThat(items.get("type")).isEqualTo("array");
        Map<String, Object> element = map(items.get("items"));
        assertThat(element).containsEntry("type", "object").containsEntry("additionalProperties", false)
                .containsEntry("required", List.of("sku"));
        Object price = map(map(element.get("properties")).get("price")).get("enum");
        assertThat(price).isEqualTo(List.of(new BigDecimal("1.00000000000000000001")));
    }

    @Test
    void outputSchemaWrapsBusinessDataWithRequestId() {
        Map<String, Object> output = McpJsonSchema.output(schema("""
                {"type":"OBJECT","properties":{"orderNo":{"type":"STRING","required":true,"defaultValue":"example"}}}
                """));
        assertThat(output).containsEntry("type", "object").containsEntry("required", List.of("data", "requestId"));
        Map<String, Object> properties = map(output.get("properties"));
        assertThat(properties.get("requestId")).isEqualTo(Map.of("type", "string"));
        assertThat(map(properties.get("data"))).containsEntry("type", "object").containsEntry("required", List.of("orderNo"));
    }

    @Test
    void onlyObjectRequestsCanBecomeToolInput() {
        assertThatThrownBy(() -> McpJsonSchema.input(schema("{\"type\":\"ARRAY\",\"items\":{\"type\":\"STRING\"}}")))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
