package io.github.chenyilei2016.openplatform.domain.catalog;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/** API业务内容比较：忽略身份与修订，scope无序，Schema字段展示顺序和数组顺序有意义。 */
public final class ApiDefinitionContent {
    private ApiDefinitionContent() {}

    public static List<String> changedFields(ApiDefinition before, ApiDefinition after) {
        Map<String, Object> candidate = fields(after);
        if (before == null) return List.copyOf(candidate.keySet());
        Map<String, Object> baseline = fields(before);
        return candidate.keySet().stream().filter(field -> !sameValue(baseline.get(field), candidate.get(field))).toList();
    }

    private static Map<String, Object> fields(ApiDefinition definition) {
        Map<String, Object> fields = new LinkedHashMap<>();
        fields.put("service", definition.service()); fields.put("version", definition.version());
        fields.put("method", definition.method()); fields.put("name", definition.name());
        fields.put("category", definition.category()); fields.put("owner", definition.owner());
        fields.put("protocol", definition.protocol()); fields.put("scopeCodes", Set.copyOf(definition.scopeCodes()));
        fields.put("requestSchema", definition.requestSchema()); fields.put("responseSchema", definition.responseSchema());
        fields.put("errorDefinitions", definition.errorDefinitions()); fields.put("binding", definition.binding());
        fields.put("mappings", definition.mappings()); fields.put("lifecycle", definition.lifecycle());
        fields.put("description", definition.description());
        fields.put("employeeRequired", definition.employeeRequired());
        fields.put("responseAdapter", definition.responseAdapter());
        fields.put("operationKind", definition.operationKind());
        fields.put("idempotencyField", definition.idempotencyField());
        fields.put("mcpTool", definition.mcpTool());
        return fields;
    }

    public static boolean sameValue(Object before, Object after) {
        if (before == after) return true;
        if (before == null || after == null) return false;
        if (before instanceof Number left && after instanceof Number right) {
            return new BigDecimal(left.toString()).compareTo(new BigDecimal(right.toString())) == 0;
        }
        if (before instanceof SchemaNode left && after instanceof SchemaNode right) {
            return left.type() == right.type() && Objects.equals(left.description(), right.description())
                    && Objects.equals(left.required(), right.required())
                    && Objects.equals(left.nullable(), right.nullable())
                    && new ArrayList<>(left.properties().keySet()).equals(new ArrayList<>(right.properties().keySet()))
                    && sameValue(left.properties(), right.properties()) && sameValue(left.items(), right.items())
                    && sameValue(left.enumValues(), right.enumValues()) && sameValue(left.defaultValue(), right.defaultValue())
                    && sameValue(left.example(), right.example());
        }
        if (before instanceof ResponseAdapter left && after instanceof ResponseAdapter right) {
            return left.mode() == right.mode() && Objects.equals(left.successPath(), right.successPath())
                    && sameValue(left.successValues(), right.successValues()) && Objects.equals(left.dataPath(), right.dataPath())
                    && Objects.equals(left.messagePath(), right.messagePath());
        }
        if (before instanceof ParameterMapping left && after instanceof ParameterMapping right) {
            return Objects.equals(left.target(), right.target()) && left.source() == right.source()
                    && Objects.equals(left.path(), right.path()) && sameValue(left.value(), right.value());
        }
        if (before instanceof Map<?, ?> left && after instanceof Map<?, ?> right) {
            return left.keySet().equals(right.keySet())
                    && left.entrySet().stream().allMatch(entry -> sameValue(entry.getValue(), right.get(entry.getKey())));
        }
        if (before instanceof List<?> left && after instanceof List<?> right) {
            if (left.size() != right.size()) return false;
            for (int index = 0; index < left.size(); index++) {
                if (!sameValue(left.get(index), right.get(index))) return false;
            }
            return true;
        }
        return Objects.equals(before, after);
    }
}
