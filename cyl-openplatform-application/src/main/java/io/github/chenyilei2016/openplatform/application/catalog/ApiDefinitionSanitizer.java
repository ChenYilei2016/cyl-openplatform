package io.github.chenyilei2016.openplatform.application.catalog;

import io.github.chenyilei2016.openplatform.domain.catalog.*;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.*;
import static io.github.chenyilei2016.openplatform.application.common.SensitiveValues.*;

/** 与管理差异展示使用相同敏感字段规则，但复制实际移除值，不能只在页面隐藏。 */
final class ApiDefinitionSanitizer {
    private final Set<String> warnings = new LinkedHashSet<>();

    ApiCopyService.Preview preview(String sourceId, ApiCopyService.SourceKind kind, String releaseId, ApiDefinition source, String owner) {
        ApiDefinition snapshot = snapshot(source, owner, ApiLifecycle.DEFAULT);
        snapshot.validate();
        return new ApiCopyService.Preview(sourceId, kind, source.draftRevision(), releaseId, snapshot, List.copyOf(warnings));
    }

    ApiDefinition snapshot(ApiDefinition source, String owner, ApiLifecycle lifecycle) {
        ApiBinding binding = source.binding();
        if (binding.http() != null) binding = new ApiBinding(binding.protocol(), binding.timeoutMillis(),
                new ApiBinding.Http(cleanText(binding.http().url()), binding.http().method(), binding.http().targetMode(), binding.http().serviceName(),
                        cleanHttpPath(binding.http().path()),
                        binding.http().sourceClass(), binding.http().sourceMethod()), null);
        List<ParameterMapping> mappings = source.mappings().stream().map(mapping -> {
            if (mapping.source() != ParameterMapping.Source.FIXED) return mapping;
            Object value = sensitivePath(mapping.target()) ? removed(mapping.value()) : cleanValue(mapping.value());
            return new ParameterMapping(mapping.target(), mapping.source(), mapping.path(), value, mapping.location());
        }).toList();
        ApiDefinition snapshot = new ApiDefinition(null, source.service(), source.version(), source.method(), cleanText(source.name()),
                cleanText(source.category()), cleanText(owner), source.protocol(), 1, source.scopeCodes(),
                cleanSchema(source.requestSchema(), false), cleanSchema(source.responseSchema(), false),
                source.errorDefinitions().stream().map(error -> new ApiDefinition.ErrorDefinition(error.code(), cleanText(error.message()))).toList(),
                binding, mappings, new ApiLifecycle(lifecycle.status(), lifecycle.compatibility(), cleanText(lifecycle.compatibilityNotes()),
                        cleanText(lifecycle.deprecationNotice()), lifecycle.replacementVersion(), lifecycle.sunsetDate()), cleanText(source.description()), source.employeeRequired(), source.responseAdapter(),
                source.operationKind(), source.idempotencyField(),
                new McpToolConfig(source.mcpTool().enabled(), cleanText(source.mcpTool().aiDescription())));
        return snapshot;
    }

    private String cleanHttpPath(String path) {
        if (path == null) return null;
        String safe = cleanText("http://discovery.invalid" + path);
        return safe == null ? null : safe.substring("http://discovery.invalid".length());
    }

    private SchemaNode cleanSchema(SchemaNode node, boolean privateField) {
        Map<String, SchemaNode> properties = new LinkedHashMap<>();
        node.properties().forEach((key, value) -> properties.put(key, cleanSchema(value, privateField || sensitivePath(key))));
        SchemaNode items = node.items() == null ? null : cleanSchema(node.items(), privateField);
        // 对复合示例整体清除含敏感字段的值，避免删除必填子字段后留下不合法示例。
        List<Object> enums = node.enumValues();
        if (privateField || enums.stream().anyMatch(value -> !Objects.equals(value, cleanValue(value)))) {
            removed(enums.isEmpty() ? null : enums);
            enums = List.of();
        }
        Object defaultValue = privateField ? removed(node.defaultValue()) : safeSchemaValue(node.defaultValue());
        Object example = privateField ? removed(node.example()) : safeSchemaValue(node.example());
        return new SchemaNode(node.type(), cleanText(node.description()), node.required(), properties, items, enums, defaultValue, example, node.nullable());
    }

    private Object safeSchemaValue(Object value) {
        return Objects.equals(value, cleanValue(value)) ? value : removed(value);
    }

    private Object cleanValue(Object value) {
        if (value instanceof Map<?, ?> object) {
            Map<String, Object> safe = new LinkedHashMap<>();
            object.forEach((key, entry) -> {
                if (sensitivePath((String) key)) removed(entry);
                else safe.put((String) key, cleanValue(entry));
            });
            return safe;
        }
        if (value instanceof List<?> array) return array.stream().map(this::cleanValue).toList();
        if (value instanceof String text) return BEARER.matcher(text).find() ? removed(text) : cleanText(text);
        return value;
    }

    private String cleanText(String text) {
        if (text == null) return null;
        String safe = BEARER.matcher(text).replaceAll("[已清除敏感值]");
        if (!safe.matches("(?is)^https?://.*") && INLINE_SECRET.matcher(safe).find()) safe = "[已清除敏感说明]";
        if (!safe.equals(text)) removed(text);
        if (safe.matches("(?is)^https?://.*")) {
            try {
                if (safe.indexOf('{') >= 0 || safe.indexOf('}') >= 0) HttpUrlTemplate.parse(safe);
                URI uri = URI.create(safe.replace("{", "%7B").replace("}", "%7D"));
                if (uri.getRawQuery() != null) {
                    List<String> pairs = new ArrayList<>();
                    for (String pair : uri.getRawQuery().split("&", -1)) {
                        String key = URLDecoder.decode(pair.split("=", 2)[0], StandardCharsets.UTF_8);
                        if (sensitivePath(key) || BEARER.matcher(URLDecoder.decode(pair, StandardCharsets.UTF_8)).find()) removed(pair);
                        else pairs.add(pair);
                    }
                    if (pairs.size() != uri.getRawQuery().split("&", -1).length) {
                        String suffix = uri.getRawFragment() == null ? "" : "#" + uri.getRawFragment();
                        safe = safe.substring(0, safe.indexOf('?')) + (pairs.isEmpty() ? "" : "?" + String.join("&", pairs)) + suffix;
                    }
                }
                if (uri.getRawUserInfo() != null) {
                    safe = safe.replace(uri.getRawUserInfo() + "@", "");
                    removed(text);
                }
            } catch (IllegalArgumentException invalid) {
                // 无法安全解释的URL示例不携带到新草稿；正式绑定仍由领域验证。
                removed(text);
                return null;
            }
        }
        return safe;
    }

    private Object removed(Object value) {
        if (value != null) warnings.add("已移除敏感字段、凭据或Token值；请核对绑定、固定映射、默认值及示例后保存");
        return null;
    }
    private static boolean sensitivePath(String path) {
        return Arrays.stream(path.split("\\.")).anyMatch(part -> SENSITIVE.matcher(part.replace("-", "").replace("_", "")).matches());
    }
}
