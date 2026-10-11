package io.github.chenyilei2016.openplatform.infrastructure.importing;

import io.github.chenyilei2016.openplatform.domain.catalog.SchemaNode;
import io.github.chenyilei2016.openplatform.domain.catalog.SchemaType;
import java.net.URI;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;
import tools.jackson.core.JsonPointer;

/** 单个操作的转换上下文；引用展开、Schema预算及未表达项集中管理。 */
final class OpenApiSourceSupport {
    private static final Pattern PRIVATE_NAME = Pattern.compile("authorization|cookie|setcookie|password|passwd|secret|appsecret|signingsecret|token|accesstoken|refreshtoken|apikey|xapikey|xszsignature", Pattern.CASE_INSENSITIVE);
    private static final Pattern PRIVATE_TEXT = Pattern.compile("(?i)\\bBearer\\s+[^\\s]+|\\b(?:password|passwd|secret|token|api[_-]?key)\\s*[:=]\\s*\\S+");
    private static final Pattern SCRIPT = Pattern.compile("(?is)<\\s*script\\b|javascript\\s*:|on(?:error|load)\\s*=");
    private static final Set<String> SCHEMA_FIELDS = Set.of("type", "nullable", "description", "required", "properties", "items", "enum", "default", "example", "$ref", "title", "deprecated", "externalDocs");
    private final Map<String, Object> root;
    final Set<String> warnings = new LinkedHashSet<>();
    final Set<String> blockers = new LinkedHashSet<>();
    private int schemaNodes;

    OpenApiSourceSupport(Map<String, Object> root) { this.root = root; }

    @SuppressWarnings("unchecked")
    static Map<String, Object> object(Object value) {
        return value instanceof Map<?, ?> ? (Map<String, Object>) value : Map.of();
    }

    static boolean sensitive(String name) { return PRIVATE_NAME.matcher(name.replace("_", "").replace("-", "")).matches(); }
    static boolean script(String text) { return SCRIPT.matcher(text).find(); }

    Map<String, Object> resolve(Object input, String location, Set<String> references) {
        if (!(input instanceof Map<?, ?>)) { blockers.add(location + "缺少有效对象结构"); return Map.of(); }
        Map<String, Object> value = object(input);
        if (!value.containsKey("$ref")) return value;
        if (!(value.get("$ref") instanceof String reference) || !reference.startsWith("#/")) {
            blockers.add(location + "含外部或不支持的引用；不会访问远程地址，请改为文档内引用"); return Map.of();
        }
        if (value.size() > 1) blockers.add(location + "引用同时包含其他字段，需手动核对，不能静默忽略");
        if (references.size() >= 32 || !references.add(reference)) {
            blockers.add(location + "存在循环引用或引用链过深，请展开为有限结构"); return Map.of();
        }
        Object target = root;
        try {
            JsonPointer pointer = JsonPointer.compile(URI.create(reference).getFragment());
            while (!pointer.matches()) {
                if (target instanceof Map<?, ?> map) target = map.get(pointer.getMatchingProperty());
                else if (target instanceof List<?> list && pointer.getMatchingIndex() >= 0 && pointer.getMatchingIndex() < list.size()) target = list.get(pointer.getMatchingIndex());
                else { target = null; break; }
                pointer = pointer.tail();
            }
        } catch (IllegalArgumentException failure) { target = null; }
        if (target == null) { blockers.add(location + "的本地引用目标不存在或格式不合法"); return Map.of(); }
        return resolve(target, location, references);
    }

    SchemaNode schema(Object input, String location, boolean request, boolean required, int depth, Set<String> ancestors) {
        if (depth > 8 || ++schemaNodes > 200) { blockers.add(location + "超出平台Schema深度8或节点200限制"); return null; }
        Set<String> references = new HashSet<>(ancestors);
        Map<String, Object> source = resolve(input, location, references);
        if (source.isEmpty()) return null;
        for (String field : source.keySet()) {
            if (field.equals("additionalProperties") && Boolean.FALSE.equals(source.get(field))) continue;
            if (field.startsWith("x-")) { warnings.add(location + "的扩展字段未导入，请核对"); continue; }
            if (!SCHEMA_FIELDS.contains(field)) blockers.add(location + "." + field + "不能被平台Schema精确表达，请手动补齐");
        }
        SchemaType type;
        try { type = SchemaType.valueOf(String.valueOf(source.get("type")).toUpperCase(Locale.ROOT)); }
        catch (IllegalArgumentException failure) { blockers.add(location + "缺少可映射的明确类型，不自动猜测组合或空类型"); return null; }
        Map<String, SchemaNode> properties = new LinkedHashMap<>();
        SchemaNode items = null;
        if (type == SchemaType.OBJECT) {
            if (!source.containsKey("additionalProperties")) warnings.add(location + "只转换已声明字段，请求拒绝额外字段、返回仅公开已声明字段，请确认");
            Map<String, Object> children = object(source.get("properties"));
            if (source.containsKey("properties") && !(source.get("properties") instanceof Map<?, ?>)) blockers.add(location + ".properties必须为对象");
            if (children.size() > 50) { blockers.add(location + "超过50个字段，请拆分或手动整理"); return null; }
            Set<String> mandatory = new HashSet<>();
            if (source.get("required") instanceof List<?> requiredFields) {
                for (Object field : requiredFields) {
                    if (!(field instanceof String name) || !children.containsKey(name)) blockers.add(location + ".required指向不存在的字段");
                    else mandatory.add(name);
                }
            } else if (source.containsKey("required")) blockers.add(location + ".required必须为字段名数组");
            for (Map.Entry<String, Object> entry : children.entrySet()) {
                String name = entry.getKey();
                if (sensitive(name)) { warnings.add(location + "中的秘密字段及样例已排除，请手动核对业务字段"); continue; }
                if (!name.matches("[a-zA-Z][a-zA-Z0-9_]{0,63}") || request && SchemaNode.isIdentityField(name)) {
                    blockers.add(location + "含不合法字段名或可信身份字段，请手动确认"); continue;
                }
                SchemaNode child = schema(entry.getValue(), location + ".properties." + name, request, mandatory.contains(name), depth + 1, references);
                if (child != null) properties.put(name, child);
            }
        } else if (type == SchemaType.ARRAY) {
            items = schema(source.get("items"), location + ".items", request, false, depth + 1, references);
            if (items == null) blockers.add(location + "缺少有效数组元素结构");
        }
        if (type != SchemaType.OBJECT && (source.containsKey("properties") || source.containsKey("required"))) blockers.add(location + "非对象类型不能携带properties或required");
        if (type != SchemaType.ARRAY && source.containsKey("items")) blockers.add(location + "非数组类型不能携带items");
        List<Object> enums = new ArrayList<>();
        if (source.get("enum") instanceof List<?> values) {
            if (values.size() > 50) blockers.add(location + ".enum超过50项");
            else for (Object value : values) {
                Object safe = example(value, location + ".enum");
                if (safe != null) enums.add(safe);
                if (value == null) blockers.add(location + ".enum包含null，平台无法表达");
            }
        } else if (source.containsKey("enum")) blockers.add(location + ".enum必须为数组");
        Object defaultValue = example(source.get("default"), location + ".default");
        Object example = example(source.get("example"), location + ".example");
        if (source.containsKey("default") && source.get("default") == null || source.containsKey("example") && source.get("example") == null)
            blockers.add(location + "显式null示例或默认值无法表达，请手动核对");
        String description = text(source.get("description"), location + ".description");
        if (description != null && description.length() > 500) blockers.add(location + ".description超过500字符，请手动整理");
        if (source.containsKey("title") || source.containsKey("deprecated") || source.containsKey("externalDocs")) warnings.add(location + "的title、deprecated或外部文档注释未自动转换，请核对");
        if (source.containsKey("nullable") && !(source.get("nullable") instanceof Boolean)) blockers.add(location + ".nullable必须为布尔值");
        SchemaNode result = new SchemaNode(type, description, required, properties, items, enums, defaultValue, example, Boolean.TRUE.equals(source.get("nullable")));
        try {
            for (Object value : enums) result.validateValue(value, false);
            if (defaultValue != null) result.validateValue(defaultValue, true);
            if (example != null) result.validateValue(example, true);
        } catch (RuntimeException failure) { blockers.add(location + "的示例、默认值或枚举与转换后结构不一致，请核对"); }
        return result;
    }

    Object example(Object value, String location) {
        if (value == null) return null;
        if (privateValue(value)) { warnings.add(location + "含秘密或身份值，已移除整个示例/默认值，请补充脱敏内容"); return null; }
        return value;
    }

    private boolean privateValue(Object value) {
        if (value instanceof Map<?, ?> object) return object.entrySet().stream().anyMatch(entry -> sensitive(entry.getKey().toString())
                || SchemaNode.isIdentityField(entry.getKey().toString()) || privateValue(entry.getValue()));
        if (value instanceof List<?> list) return list.stream().anyMatch(this::privateValue);
        return value instanceof String text && PRIVATE_TEXT.matcher(text).find();
    }

    String text(Object value, String location) {
        if (!(value instanceof String text)) return null;
        if (PRIVATE_TEXT.matcher(text).find()) { warnings.add(location + "包含敏感内容，已清除"); return null; }
        return text;
    }
}
