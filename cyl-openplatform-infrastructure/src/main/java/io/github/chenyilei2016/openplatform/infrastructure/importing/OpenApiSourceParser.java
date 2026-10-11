package io.github.chenyilei2016.openplatform.infrastructure.importing;

import io.github.chenyilei2016.openplatform.application.importing.ApiSourceParser;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiBinding;
import io.github.chenyilei2016.openplatform.domain.catalog.ParameterMapping;
import io.github.chenyilei2016.openplatform.domain.catalog.HttpUrlTemplate;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiDefinition;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiLifecycle;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiProtocol;
import io.github.chenyilei2016.openplatform.domain.catalog.SchemaNode;
import io.github.chenyilei2016.openplatform.domain.catalog.SchemaType;
import io.github.chenyilei2016.openplatform.domain.common.CredentialSecrets;
import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.swagger.v3.parser.OpenAPIV3Parser;
import io.swagger.v3.parser.core.models.ParseOptions;
import io.swagger.v3.parser.core.models.SwaggerParseResult;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Component;
import tools.jackson.core.StreamReadConstraints;
import tools.jackson.core.StreamReadFeature;
import tools.jackson.core.json.JsonFactory;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.json.JsonMapper;

/** OpenAPI 3.0 JSON到补全候选：不执行来源、不读取远程引用、不保存半成品。 */
@Component
public final class OpenApiSourceParser implements ApiSourceParser {
    private static final int MAX_BYTES = 262_144;
    private static final Set<String> METHODS = Set.of("get", "put", "post", "delete", "options", "head", "patch", "trace");
    private static final JsonMapper JSON = JsonMapper.builder(JsonFactory.builder()
            .streamReadConstraints(StreamReadConstraints.builder().maxDocumentLength(MAX_BYTES)
                    .maxTokenCount(40_000).maxNestingDepth(64).maxStringLength(65_536).maxNumberLength(128).build()).build())
            .enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION)
            .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
            .enable(DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS).build();

    @Override
    public Result parse(String document) {
        if (document == null || document.isBlank() || document.length() > MAX_BYTES
                || document.getBytes(StandardCharsets.UTF_8).length > MAX_BYTES) {
            throw invalid("接口文档必须是非空OpenAPI 3.0 JSON，且不超过256 KiB");
        }
        Map<String, Object> root;
        try {
            Object value = JSON.readValue(document, Object.class);
            if (!(value instanceof Map<?, ?>)) throw invalid("仅支持OpenAPI 3.0 JSON对象；YAML请先转换为JSON");
            root = OpenApiSourceSupport.object(value);
        } catch (PlatformException failure) {
            throw failure;
        } catch (RuntimeException failure) {
            throw invalid("接口文档不是合法JSON，或存在重复字段、超限结构；YAML请先转换为OpenAPI 3.0 JSON");
        }
        if (!(root.get("openapi") instanceof String version) || !version.matches("3\\.0\\.\\d+")) {
            throw invalid("仅支持OpenAPI 3.0 JSON；OpenAPI 3.1、Swagger 2及其他格式请转换或手动创建");
        }
        ArrayDeque<Object> pending = new ArrayDeque<>();
        pending.add(root);
        int nodes = 0;
        while (!pending.isEmpty()) {
            Object value = pending.removeFirst();
            if (++nodes > 20_000) throw invalid("接口文档超过20000个JSON节点，请拆分来源");
            if (value instanceof Map<?, ?> object) {
                if (object.keySet().stream().anyMatch(key -> OpenApiSourceSupport.script(key.toString())))
                    throw invalid("接口文档含脚本或可执行内容，请移除后重新导入");
                object.values().stream().map(item -> item == null ? Boolean.FALSE : item).forEach(pending::addLast);
            }
            else if (value instanceof List<?> list) list.stream().map(item -> item == null ? Boolean.FALSE : item).forEach(pending::addLast);
            else if (value instanceof String text && OpenApiSourceSupport.script(text)) {
                throw invalid("接口文档含脚本或可执行内容，请移除后重新导入");
            }
        }
        if (!(root.get("paths") instanceof Map<?, ?> paths)) throw invalid("OpenAPI文档缺少paths对象");
        Map<String, Map<String, Object>> pathItems = new LinkedHashMap<>();
        Map<String, OpenApiSourceSupport> pathContexts = new LinkedHashMap<>();
        long operationCount = 0;
        for (Map.Entry<?, ?> entry : paths.entrySet()) {
            OpenApiSourceSupport context = new OpenApiSourceSupport(root);
            Map<String, Object> item = context.resolve(entry.getValue(), "paths." + entry.getKey(), new HashSet<>());
            pathItems.put(entry.getKey().toString(), item);
            pathContexts.put(entry.getKey().toString(), context);
            operationCount += item.keySet().stream().filter(METHODS::contains).count();
            if (item.isEmpty() && !context.blockers.isEmpty()) operationCount++;
            if (operationCount > 100) throw invalid("接口文档必须包含1–100个操作，请先拆分来源");
        }
        if (operationCount < 1 || operationCount > 100) throw invalid("接口文档必须包含1–100个操作，请先拆分来源");

        // 只调用readContents；关闭所有解析/展开开关，servers和外部$ref从不成为读取目标。
        ParseOptions options = new ParseOptions();
        options.setResolve(false);
        options.setResolveFully(false);
        options.setFlatten(false);
        SwaggerParseResult checked;
        try { checked = new OpenAPIV3Parser().readContents(document, null, options); }
        catch (RuntimeException failure) { throw invalid("OpenAPI文档结构校验失败，请检查info、paths与操作定义"); }
        if (checked == null || checked.getOpenAPI() == null) throw invalid("OpenAPI文档结构校验失败，请检查info、paths与操作定义");
        Map<String, List<String>> diagnostics = diagnostics(checked.getMessages(), pathItems);

        List<Candidate> candidates = new ArrayList<>();
        for (Map.Entry<String, Map<String, Object>> pathEntry : pathItems.entrySet()) {
            String path = pathEntry.getKey();
            Map<String, Object> pathItem = pathEntry.getValue();
            OpenApiSourceSupport pathContext = pathContexts.get(path);
            pathContext.blockers.addAll(diagnostics.getOrDefault("", List.of()));
            if (pathItem.isEmpty() && !pathContext.blockers.isEmpty()) {
                String safePath = pathContext.text(path, "path");
                candidates.add(new Candidate("operation-" + candidates.size(), safePath == null ? "路径信息已脱敏" : safePath,
                        null, new ArrayList<>(pathContext.warnings), new ArrayList<>(pathContext.blockers)));
            }
            for (String method : pathItem.keySet()) {
                if (!METHODS.contains(method)) continue;
                OpenApiSourceSupport context = new OpenApiSourceSupport(root);
                context.blockers.addAll(pathContext.blockers);
                if (path.contains("?") || path.contains("#") || OpenApiSourceSupport.sensitive(path)) context.blockers.add("路径不能携带查询串、fragment或敏感信息，请整理来源路径");
                Map<String, Object> operation = OpenApiSourceSupport.object(pathItem.get(method));
                context.blockers.addAll(diagnostics.getOrDefault(path + "\n" + method, List.of()));
                if (operation.containsKey("callbacks")) context.blockers.add("操作包含callbacks，平台无法自动表达，请手动补齐");
                if (root.containsKey("security") || operation.containsKey("security")) context.warnings.add("来源认证不导入；请单独确认平台权限组与可信身份映射");
                Map<String, SchemaNode> fields = new LinkedHashMap<>();
                List<ParameterMapping> mappings = new ArrayList<>();
                Set<String> parameterTargets = new HashSet<>();
                parameters(pathItem.get("parameters"), fields, mappings, parameterTargets, context, "路径参数");
                parameters(operation.get("parameters"), fields, mappings, parameterTargets, context, "操作参数");
                SchemaNode bodySchema = null;
                boolean hasParameters = !fields.isEmpty();
                if (operation.containsKey("requestBody")) {
                    Map<String, Object> body = context.resolve(operation.get("requestBody"), "requestBody", new HashSet<>());
                    SchemaNode request = content(body, "requestBody", true, context);
                    bodySchema = request;
                    if (request != null && request.type() != SchemaType.OBJECT) context.blockers.add("requestBody必须为JSON对象，请手动整理请求结构");
                    else if (request != null) request.properties().forEach((name, field) -> {
                        String sourceField = importFieldName(name, ParameterMapping.Location.BODY, fields, context);
                        fields.put(sourceField, field);
                        mappings.add(new ParameterMapping(name, ParameterMapping.Source.REQUEST, sourceField, null, ParameterMapping.Location.BODY));
                    });
                    if (hasParameters && request != null && (request.example() != null || request.defaultValue() != null || !request.enumValues().isEmpty()))
                        context.blockers.add("消息体与独立参数合并后，根级示例、默认值或枚举需手动核对，不能直接导入");
                }
                SchemaNode requestSchema = !hasParameters && bodySchema != null && bodySchema.type() == SchemaType.OBJECT ? bodySchema
                        : new SchemaNode(SchemaType.OBJECT, null, false, fields, null, List.of(), null, null, false);
                Map<String, Object> responses = OpenApiSourceSupport.object(operation.get("responses"));
                List<String> success = responses.keySet().stream().filter(code -> code.matches("2\\d\\d") || code.equalsIgnoreCase("2XX")).toList();
                SchemaNode responseSchema = null;
                if (success.size() != 1 || success.getFirst().equalsIgnoreCase("2XX")) {
                    context.blockers.add("必须明确唯一成功响应，不能自动选择多个2xx或范围响应；请补充响应说明");
                } else {
                    String location = "responses." + success.getFirst();
                    Map<String, Object> response = context.resolve(responses.get(success.getFirst()), location, new HashSet<>());
                    responseSchema = content(response, location, false, context);
                    if (response.containsKey("headers") || response.containsKey("links")) context.blockers.add(location + "含响应头或links，需手动核对未映射内容");
                }
                if (responses.size() > success.size()) context.warnings.add("非成功响应未自动转换为平台错误码，请逐项补充错误说明");
                String url = address(root, pathItem, operation, path, context);
                String verb = method.toUpperCase(Locale.ROOT);
                if (!Set.of("GET", "POST", "PUT", "PATCH", "DELETE").contains(verb)) context.blockers.add("内部HTTP方法" + verb + "当前不支持，请手动调整");
                context.warnings.add("请确认内部地址、方法和每项参数来源；外部服务标识、版本、操作标识、分类、负责人及权限组须自行补齐");
                String name = context.text(operation.get("summary"), "summary");
                String description = context.text(operation.get("description"), "description");
                String safePath = context.text(path, "path");
                String label = verb + " " + (safePath == null ? "路径信息已脱敏" : safePath);
                ApiDefinition definition = new ApiDefinition(null, "", "", "", name == null ? "" : name, "", "", ApiProtocol.HTTP,
                        0, List.of(), requestSchema, responseSchema, List.of(), new ApiBinding(ApiProtocol.HTTP, 3000,
                        new ApiBinding.Http(url, verb), null), mappings, ApiLifecycle.DEFAULT, description, false, null,
                        null, null, null);
                candidates.add(new Candidate("operation-" + candidates.size(), label, definition, new ArrayList<>(context.warnings), new ArrayList<>(context.blockers)));
            }
        }
        return new Result(CredentialSecrets.digest(document), candidates);
    }

    private static void parameters(Object input, Map<String, SchemaNode> fields, List<ParameterMapping> mappings, Set<String> parameterTargets,
                                   OpenApiSourceSupport context, String location) {
        if (input == null) return;
        if (!(input instanceof List<?> parameters)) { context.blockers.add(location + "必须是数组"); return; }
        for (Object value : parameters) {
            Map<String, Object> parameter = context.resolve(value, location, new HashSet<>());
            String name = parameter.get("name") instanceof String text ? text : "";
            String source = parameter.get("in") instanceof String text ? text : "";
            if (OpenApiSourceSupport.sensitive(name) || source.equals("cookie")) {
                context.warnings.add(location + "中的认证、Cookie或秘密参数已排除"); continue;
            }
            if (!name.matches("[a-zA-Z][a-zA-Z0-9_]{0,63}") || SchemaNode.isIdentityField(name)) {
                context.blockers.add(location + "含不合法字段名或可信身份字段，请手动确认身份映射"); continue;
            }
            if (!Set.of("query", "path", "header").contains(source) || parameter.containsKey("content")) {
                context.blockers.add(location + "." + name + "的参数来源或content无法直接表达"); continue;
            }
            if (source.equals("header")) {
                context.blockers.add(location + "." + name + "的普通header映射尚不支持，请手动确认"); continue;
            }
            if (parameter.containsKey("style") || parameter.containsKey("explode") || parameter.containsKey("allowReserved") || parameter.containsKey("allowEmptyValue"))
                context.blockers.add(location + "." + name + "含序列化选项，请手动确认");
            SchemaNode schema = context.schema(parameter.get("schema"), location + "." + name, true,
                    Boolean.TRUE.equals(parameter.get("required")), 1, new HashSet<>());
            if (schema != null) {
                String description = schema.description() == null ? context.text(parameter.get("description"), location + "." + name + ".description") : schema.description();
                Object example = schema.example();
                if (parameter.containsKey("example")) {
                    if (example != null) context.blockers.add(location + "." + name + "同时有参数级和结构级示例，请明确选择");
                    else example = context.example(parameter.get("example"), location + "." + name + ".example");
                }
                schema = new SchemaNode(schema.type(), description, schema.required(), schema.properties(), schema.items(), schema.enumValues(), schema.defaultValue(), example, schema.nullable());
            }
            if (schema != null) {
                ParameterMapping.Location targetLocation = source.equals("path") ? ParameterMapping.Location.PATH : ParameterMapping.Location.QUERY;
                boolean duplicate = !parameterTargets.add(targetLocation + ":" + name);
                if (duplicate) context.blockers.add(location + "." + name + "在同一位置重复，请确认路径与操作参数覆盖关系");
                else {
                    String sourceField = importFieldName(name, targetLocation, fields, context);
                    fields.put(sourceField, schema);
                    mappings.add(new ParameterMapping(name, ParameterMapping.Source.REQUEST, sourceField, null, targetLocation));
                }
            }
            if (parameter.containsKey("examples")) context.blockers.add(location + "." + name + "含命名examples，请明确选择并核对示例");
        }
    }

    /** 内部同名参数保留位置；外部业务JSON必须使用不同字段才能分别取值。 */
    private static String importFieldName(String target, ParameterMapping.Location location, Map<String, SchemaNode> fields, OpenApiSourceSupport context) {
        if (!fields.containsKey(target)) return target;
        String prefix = location.name().toLowerCase(Locale.ROOT) + "_";
        String base = prefix + target;
        if (base.length() > 60) base = base.substring(0, 60);
        String candidate = base;
        for (int suffix = 2; fields.containsKey(candidate); suffix++) candidate = base + "_" + suffix;
        context.warnings.add("同名" + location + "参数" + target + "的外部来源字段暂命名为" + candidate + "，请确认并按需修改");
        return candidate;
    }

    private static SchemaNode content(Map<String, Object> container, String location, boolean request, OpenApiSourceSupport context) {
        Map<String, Object> content = OpenApiSourceSupport.object(container.get("content"));
        if (content.size() != 1 || !content.containsKey("application/json")) {
            context.blockers.add(location + "必须为唯一application/json内容；多内容类型、文件、表单或空响应需手动补齐"); return null;
        }
        Map<String, Object> media = OpenApiSourceSupport.object(content.get("application/json"));
        if (media.containsKey("encoding")) context.blockers.add(location + "含encoding，无法自动表达");
        SchemaNode schema = context.schema(media.get("schema"), location + ".schema", request, false, 1, new HashSet<>());
        if (media.containsKey("examples")) context.blockers.add(location + "含命名examples，请明确选择并核对示例");
        if (schema != null && media.containsKey("example")) {
            Object example = context.example(media.get("example"), location + ".example");
            if (schema.example() != null) context.blockers.add(location + "同时有结构级和媒体级示例，请明确选择");
            else schema = new SchemaNode(schema.type(), schema.description(), schema.required(), schema.properties(), schema.items(), schema.enumValues(), schema.defaultValue(), example, schema.nullable());
        }
        return schema;
    }

    private static String address(Map<String, Object> root, Map<String, Object> pathItem, Map<String, Object> operation,
                                  String path, OpenApiSourceSupport context) {
        Object selected = operation.containsKey("servers") ? operation.get("servers") : pathItem.containsKey("servers") ? pathItem.get("servers") : root.get("servers");
        if (!(selected instanceof List<?> servers) || servers.size() != 1) {
            context.warnings.add("未确定唯一内部服务地址，请手动补充；解析不会访问servers"); return "";
        }
        Map<String, Object> server = OpenApiSourceSupport.object(servers.getFirst());
        if (!(server.get("url") instanceof String base) || server.containsKey("variables") || base.contains("{")) {
            context.blockers.add("服务地址含变量，需确认固定内部地址"); return "";
        }
        try {
            URI uri = URI.create(base);
            if (!Set.of("http", "https").contains(uri.getScheme()) || uri.getHost() == null
                    || uri.getRawUserInfo() != null || uri.getRawQuery() != null || uri.getRawFragment() != null || !path.startsWith("/") || path.contains("?") || path.contains("#")) {
                context.warnings.add("来源内部地址不是无认证信息的绝对HTTP(S)地址，请手动补充"); return "";
            }
            String address = context.text(base.replaceAll("/+$", "") + path, "内部地址");
            if (address != null) HttpUrlTemplate.parse(address);
            return address == null ? "" : address;
        } catch (IllegalArgumentException failure) { context.warnings.add("内部地址不合法，请手动补充"); return ""; }
    }

    private static PlatformException invalid(String message) { return new PlatformException(ErrorCode.INVALID_REQUEST, message); }

    /** 只关联解析器的结构位置，不回显可能包含认证值的原始诊断文本。不能定位的诊断保守阻断整份文档。 */
    private static Map<String, List<String>> diagnostics(List<String> messages, Map<String, Map<String, Object>> paths) {
        Map<String, List<String>> result = new LinkedHashMap<>();
        if (messages == null) return result;
        for (String message : messages) {
            String reason = message != null && message.contains(" is missing") ? "缺少必填字段"
                    : message != null && message.contains(" is not of type") ? "字段类型不合法"
                    : message != null && message.contains(" is unexpected") ? "包含规范未定义的字段"
                    : message != null && message.contains(" is repeated") ? "存在重复定义" : "结构校验未通过";
            boolean matched = false;
            for (Map.Entry<String, Map<String, Object>> path : paths.entrySet()) {
                String prefix = "attribute paths.'" + path.getKey() + "'";
                for (String method : path.getValue().keySet()) {
                    if (!METHODS.contains(method)) continue;
                    String operation = prefix + "(" + method + ")";
                    String typedOperation = prefix + "." + method;
                    if (message != null && (message.startsWith(operation + ".") || message.startsWith(operation + " ")
                            || message.startsWith(typedOperation + " "))) {
                        String location = "操作定义";
                        for (String field : List.of("responses", "requestBody", "parameters", "summary", "description", "operationId", "tags", "callbacks", "security", "servers", "deprecated"))
                            if (message.startsWith(operation + "." + field + ".") || message.startsWith(operation + "." + field + " ")) location = field;
                        result.computeIfAbsent(path.getKey() + "\n" + method, ignored -> new ArrayList<>())
                                .add("OpenAPI " + method.toUpperCase(Locale.ROOT) + " " + location + "：" + reason + "，请核对该操作");
                        matched = true;
                    }
                }
            }
            if (matched) continue;
            for (Map.Entry<String, Map<String, Object>> path : paths.entrySet()) {
                if (message == null || !message.startsWith("attribute paths.'" + path.getKey() + "'.")) continue;
                for (String method : path.getValue().keySet()) {
                    if (!METHODS.contains(method)) continue;
                    result.computeIfAbsent(path.getKey() + "\n" + method, ignored -> new ArrayList<>()).add("OpenAPI 共享路径定义：" + reason + "，请核对此路径的参数与定义");
                    matched = true;
                }
            }
            if (!matched) {
                String location = "未能定位的结构";
                for (String section : List.of("openapi", "info", "paths", "components", "servers", "security", "tags", "externalDocs"))
                    if (message != null && (message.startsWith("attribute " + section + ".") || message.startsWith("attribute " + section + " "))) location = section;
                result.computeIfAbsent("", ignored -> new ArrayList<>()).add("OpenAPI 全局 " + location + "：" + reason + "，请修正文档后重新解析");
            }
        }
        return result;
    }
}
