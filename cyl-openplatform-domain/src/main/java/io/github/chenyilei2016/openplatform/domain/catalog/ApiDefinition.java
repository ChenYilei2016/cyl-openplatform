package io.github.chenyilei2016.openplatform.domain.catalog;

import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.FieldValidation;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.github.chenyilei2016.openplatform.domain.mcp.McpToolName;
import java.util.List;
import java.util.HashSet;
import java.util.Map;
import java.util.regex.Pattern;

/** API定义内容；是否生效由独立发布状态决定。 */
public record ApiDefinition(String id, String service, String version, String method, String name,
                            String category, String owner, ApiProtocol protocol, long draftRevision,
                            List<String> scopeCodes, SchemaNode requestSchema, SchemaNode responseSchema,
                            List<ErrorDefinition> errorDefinitions, ApiBinding binding, List<ParameterMapping> mappings, ApiLifecycle lifecycle, String description, Boolean employeeRequired, ResponseAdapter responseAdapter,
                            ApiOperationKind operationKind, String idempotencyField, McpToolConfig mcpTool) {
    public record ErrorDefinition(String code, String message) {}
    /** 点分请求字段路径，最多8层；与映射目标使用同一字段名规则。 */
    private static final Pattern FIELD_PATH = Pattern.compile("[a-zA-Z][a-zA-Z0-9_]{0,63}(?:\\.[a-zA-Z][a-zA-Z0-9_]{0,63}){0,7}");
    /** 老定义缺少三项配置时读取为：会修改数据、无幂等字段、不开放MCP，不改变既有行为。 */
    public ApiDefinition {
        operationKind = operationKind == null ? ApiOperationKind.MUTATION : operationKind;
        idempotencyField = idempotencyField == null || idempotencyField.isBlank() ? null : idempotencyField;
        mcpTool = mcpTool == null ? McpToolConfig.DISABLED : mcpTool;
        employeeRequired = Boolean.TRUE.equals(employeeRequired);
        responseAdapter = responseAdapter == null ? ResponseAdapter.DIRECT : responseAdapter;
        lifecycle = lifecycle == null ? ApiLifecycle.DEFAULT : lifecycle;
        scopeCodes = scopeCodes == null ? List.of() : List.copyOf(scopeCodes);
        errorDefinitions = errorDefinitions == null ? List.of() : List.copyOf(errorDefinitions);
        mappings = mappings == null ? List.of() : List.copyOf(mappings);
    }

    /** 保存前验证完整草稿，不依赖客户端表单是否做过校验。 */
    public void validate() {
        FieldValidation checks = new FieldValidation();
        checks.inspect("/lifecycle", () -> lifecycle.validate(version));
        checks.check(description == null || description.length() <= 5000, "/description", "接口说明不能超过5000字符");
        checks.check(service != null && service.matches("[a-z][a-z0-9_]{0,63}"), "/service", "服务标识不合法");
        checks.check(method != null && method.matches("[a-z][a-z0-9_]{0,63}"), "/method", "操作标识不合法");
        checks.check(version != null && version.matches("[a-zA-Z0-9][a-zA-Z0-9._-]{0,31}"), "/version", "外部版本不合法");
        checks.check(validLabel(name), "/name", "名称必填且不超过100字符");
        checks.check(validLabel(category), "/category", "分类必填且不超过100字符");
        checks.check(validLabel(owner), "/owner", "负责人必填且不超过100字符");
        checks.check(scopeCodes.size() <= 100 && new HashSet<>(scopeCodes).size() == scopeCodes.size()
                && scopeCodes.stream().allMatch(code -> code.matches("[a-z0-9][a-z0-9_.:-]{0,63}")), "/scopeCodes", "权限组代码不合法或重复");
        checks.check(requestSchema != null && requestSchema.type() == SchemaType.OBJECT, "/requestSchema/type", "请求根结构必须为OBJECT");
        checks.check(responseSchema != null, "/responseSchema", "返回结构必须完整");
        checks.check(binding != null, "/binding", "内部绑定必须完整");
        FieldValidation structure = new FieldValidation();
        if (requestSchema != null) structure.inspect("/requestSchema", () -> requestSchema.validate(true));
        if (responseSchema != null) checks.inspect("/responseSchema", () -> responseSchema.validate(false));
        checks.inspect("/responseAdapter", responseAdapter::validate);
        if (binding != null) {
            structure.inspect("/binding", binding::validate);
            checks.check(protocol == binding.protocol(), "/binding/protocol", "绑定协议不一致");
        }
        checks.inspect("", structure::requireValid);
        checks.check(errorDefinitions.size() <= 50, "/errorDefinitions", "错误说明不能超过50项");
        HashSet<String> errorCodes = new HashSet<>();
        for (int index = 0; index < Math.min(errorDefinitions.size(), 50); index++) {
            ErrorDefinition error = errorDefinitions.get(index);
            checks.check(error.code() != null && !error.code().isBlank() && error.code().length() <= 64
                    && errorCodes.add(error.code()), "/errorDefinitions/" + index + "/code", "错误代码必填、唯一且不超过64字符");
            checks.check(error.message() != null && !error.message().isBlank() && error.message().length() <= 500,
                    "/errorDefinitions/" + index + "/message", "错误说明必填且不超过500字符");
        }
        checks.check(mappings.size() <= 100, "/mappings", "参数映射不能超过100项");
        validateIdempotency(checks, structure.valid());
        validateMcpTool(checks);
        // 映射依赖有效请求树与绑定；先报告其根因，避免坏结构引发二次异常。
        if (structure.valid() && requestSchema != null && binding != null && protocol == binding.protocol()) {
            checks.inspect("/mappings", this::validateMappings);
            if (protocol == ApiProtocol.HTTP) for (String variable : binding.http().template().variables())
                checks.check(mappings.stream().anyMatch(mapping -> mapping.effectiveLocation(binding.http()) == ParameterMapping.Location.PATH
                                && variable.equals(mapping.target())), binding.http().targetField(), "路径变量" + variable + "缺少PATH映射");
        }
        checks.requireValid();
    }

    private void validateIdempotency(FieldValidation checks, boolean structureValid) {
        if (idempotencyField == null) return;
        if (!FIELD_PATH.matcher(idempotencyField).matches()) {
            checks.check(false, "/idempotencyField", "幂等字段须为点分字段路径，最多8层");
            return;
        }
        if (!structureValid || requestSchema == null) return;
        SchemaNode field = requestSchema.atPath(idempotencyField);
        checks.check(field != null && (field.type() == SchemaType.STRING || field.type() == SchemaType.INTEGER),
                "/idempotencyField", "幂等字段须指向请求结构中的字符串或整数字段");
    }

    /** 启用条件在保存与发布时一致校验；同 service+method 其他版本的工具名冲突由应用层按批查询。 */
    private void validateMcpTool(FieldValidation checks) {
        String aiDescription = mcpTool.aiDescription();
        checks.check(aiDescription == null || aiDescription.length() <= McpToolConfig.AI_DESCRIPTION_LIMIT,
                "/mcpTool/aiDescription", "面向AI的用途说明不能超过" + McpToolConfig.AI_DESCRIPTION_LIMIT + "字符");
        if (!mcpTool.enabled()) return;
        if (validIdentity()) checks.inspect("/mcpTool/enabled", this::toolName);
        checks.check(requestSchema == null || requestSchema.type() == SchemaType.OBJECT,
                "/mcpTool/enabled", "MCP工具的请求结构根必须是对象");
        checks.check(aiDescription != null || description != null && !description.isBlank()
                        && description.length() <= McpToolConfig.AI_DESCRIPTION_LIMIT,
                "/mcpTool/aiDescription", "接口说明为空或超过" + McpToolConfig.AI_DESCRIPTION_LIMIT + "字符，开放为MCP工具时须填写面向AI的用途说明");
        checks.check(operationKind == ApiOperationKind.QUERY || idempotencyField != null,
                "/idempotencyField", "会修改数据的API开放为MCP工具时必须配置幂等字段");
    }

    /** 由API身份生成的MCP工具名；身份创建后不可修改，所以首次发布后工具名不变。 */
    public McpToolName toolName() { return McpToolName.of(service, method, version); }

    private boolean validIdentity() {
        return service != null && service.matches("[a-z][a-z0-9_]{0,63}") && method != null && method.matches("[a-z][a-z0-9_]{0,63}")
                && version != null && version.matches("[a-zA-Z0-9][a-zA-Z0-9._-]{0,31}");
    }

    private static boolean validLabel(String value) { return value != null && !value.isBlank() && value.length() <= 100; }

    private void validateMappings() {
        Map<ParameterMapping.Location, HashSet<String>> httpTargets = new java.util.EnumMap<>(ParameterMapping.Location.class);
        HashSet<String> dubboTargets = new HashSet<>();
        FieldValidation checks = new FieldValidation();
        for (int index = 0; index < Math.min(mappings.size(), 100); index++) {
            ParameterMapping mapping = mappings.get(index);
            HashSet<String> targets = protocol == ApiProtocol.HTTP
                    ? httpTargets.computeIfAbsent(mapping.effectiveLocation(binding.http()), ignored -> new HashSet<>()) : dubboTargets;
            checks.inspect("/" + index, () -> validateMapping(mapping, targets));
        }
        checks.requireValid();
    }

    private void validateMapping(ParameterMapping mapping, HashSet<String> targets) {
        String target = mapping.target();
        boolean pathMapping = protocol == ApiProtocol.HTTP && mapping.effectiveLocation(binding.http()) == ParameterMapping.Location.PATH;
        if (target == null || !(pathMapping ? binding.http().template().variables().contains(target) : FIELD_PATH.matcher(target).matches()) || mapping.source() == null)
            throw FieldValidation.invalid("/target", FieldValidation.Reason.INVALID_VALUE, pathMapping ? "PATH目标须对应当前路径模板占位" : "映射目标或来源不合法");
        if (targets.stream().anyMatch(existing -> existing.equals(target) || existing.startsWith(target + ".") || target.startsWith(existing + "."))) throw FieldValidation.invalid("/target", FieldValidation.Reason.INVALID_VALUE, "映射目标重复或相互覆盖");
        targets.add(target);
        if (protocol == ApiProtocol.DUBBO) {
            if (mapping.location() != null) throw FieldValidation.invalid("/location", FieldValidation.Reason.INVALID_VALUE, "Dubbo映射不能填写HTTP参数位置");
            String argument = target.split("\\.", 2)[0];
            if (!argument.matches("arg(?:0|[1-9][0-9]?)") || Integer.parseInt(argument.substring(3)) >= binding.dubbo().parameterTypes().size()) throw FieldValidation.invalid("/target", FieldValidation.Reason.INVALID_VALUE, "Dubbo映射目标超出参数索引范围");
        }
        if (protocol == ApiProtocol.HTTP) {
            ParameterMapping.Location location = mapping.effectiveLocation(binding.http());
            if (location == ParameterMapping.Location.BODY && !binding.http().hasJsonBody())
                throw FieldValidation.invalid("/location", FieldValidation.Reason.INVALID_VALUE, "GET/DELETE不支持BODY映射，请迁移或移除正文规则");
            if (location == ParameterMapping.Location.QUERY && binding.http().template().fixedQueryNames().contains(target.split("\\.", 2)[0]))
                throw FieldValidation.invalid("/target", FieldValidation.Reason.INVALID_VALUE, "QUERY映射与地址中的固定query同名");
            if (pathMapping && mapping.source() == ParameterMapping.Source.FIXED && !HttpUrlTemplate.validPathValue(mapping.value()))
                throw FieldValidation.invalid("/value", FieldValidation.Reason.INVALID_VALUE, "PATH固定值须为非空标量，不包含斜杠、反斜杠或独立. / ..段");
            if (pathMapping && mapping.source() == ParameterMapping.Source.REQUEST) {
                SchemaNode source = mapping.path() == null ? null : requestSchema.atPath(mapping.path());
                if (source != null && (source.type() == SchemaType.OBJECT || source.type() == SchemaType.ARRAY))
                    throw FieldValidation.invalid("/path", FieldValidation.Reason.TYPE_MISMATCH, "PATH来源必须是标量请求字段");
            }
        }
        if (mapping.source() != ParameterMapping.Source.CONTEXT
                && java.util.Arrays.stream(target.split("\\.")).anyMatch(SchemaNode::isIdentityField)) throw FieldValidation.invalid("/source", FieldValidation.Reason.INVALID_VALUE, "可信身份目标只能来自CONTEXT");
        switch (mapping.source()) {
            case REQUEST -> {
                if (mapping.path() == null || mapping.path().length() > 520 || mapping.value() != null
                        || requestSchema.atPath(mapping.path()) == null) throw FieldValidation.invalid("/path", FieldValidation.Reason.INVALID_VALUE, "REQUEST路径不存在或混入固定值");
            }
            case CONTEXT -> {
                if (mapping.path() == null || !ParameterMapping.CONTEXT_FIELDS.contains(mapping.path()) || mapping.value() != null) throw FieldValidation.invalid("/path", FieldValidation.Reason.INVALID_VALUE, "CONTEXT只能读取白名单身份");
            }
            case FIXED -> {
                if (mapping.path() != null) throw FieldValidation.invalid("/path", FieldValidation.Reason.INVALID_VALUE, "FIXED不能同时指定path");
                FieldValidation fixed = new FieldValidation();
                fixed.inspect("/value", () -> validateFixedValue(mapping.value(), 1, new int[]{0}));
                fixed.requireValid();
            }
        }
    }

    private static void validateFixedValue(Object value, int depth, int[] count) {
        if (depth > 8 || ++count[0] > 200) invalid("固定JSON值超出规模限制");
        if (value instanceof Map<?, ?> object) {
            if (object.size() > 50) invalid("固定JSON对象字段过多");
            for (Map.Entry<?, ?> field : object.entrySet()) {
                if (!(field.getKey() instanceof String key) || SchemaNode.isIdentityField(key)) invalid("固定值不能嵌入可信身份字段");
                validateFixedValue(field.getValue(), depth + 1, count);
            }
        } else if (value instanceof List<?> array) {
            for (Object item : array) validateFixedValue(item, depth + 1, count);
        } else if (value instanceof String text && text.length() > 10_000) invalid("固定JSON字符串过大");
    }

    private static void invalid(String message) { throw new PlatformException(ErrorCode.INVALID_REQUEST, message); }
}
