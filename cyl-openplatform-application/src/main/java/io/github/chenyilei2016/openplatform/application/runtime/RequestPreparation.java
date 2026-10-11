package io.github.chenyilei2016.openplatform.application.runtime;

import io.github.chenyilei2016.openplatform.domain.catalog.ApiDefinition;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiProtocol;
import io.github.chenyilei2016.openplatform.domain.runtime.DubboArguments;
import io.github.chenyilei2016.openplatform.domain.catalog.ParameterMapping;
import io.github.chenyilei2016.openplatform.domain.catalog.HttpUrlTemplate;
import io.github.chenyilei2016.openplatform.domain.catalog.SchemaNode;
import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.github.chenyilei2016.openplatform.domain.runtime.InvocationContext;
import io.github.chenyilei2016.openplatform.domain.runtime.HttpParameters;
import io.github.chenyilei2016.openplatform.domain.runtime.ResponseAdaptation;
import java.util.LinkedHashMap;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;

/** 预检与真实调用共用请求检查、默认值和映射；不访问提供方，不猜测类型。 */
public final class RequestPreparation {
    private RequestPreparation() {}
    public static final class InvalidInput extends PlatformException {
        private final List<ResponseAdaptation.Issue> issues;
        public InvalidInput(List<ResponseAdaptation.Issue> issues) {
            super(ErrorCode.INVALID_REQUEST, "请求参数不符合结构：" + issues.getFirst().path() + "（" + issues.getFirst().reason() + "）");
            this.issues = List.copyOf(issues);
        }
        public List<ResponseAdaptation.Issue> issues() { return issues; }
    }
    public record Prepared(Map<String, Object> dubboArguments, HttpParameters httpParameters) {
        public Object diagnosticValue() { return httpParameters == null ? dubboArguments : httpParameters; }
    }

    public static Prepared prepare(ApiDefinition definition, InvocationContext context, Map<String, Object> input) {
        inspect(definition.requestSchema(), input, true);
        Object normalized = definition.requestSchema().applyDefaults(input);
        inspect(definition.requestSchema(), normalized, false);
        Map<String, Object> parameters = new LinkedHashMap<>();
        Map<ParameterMapping.Location, Map<String, Object>> http = new EnumMap<>(ParameterMapping.Location.class);
        for (ParameterMapping.Location location : ParameterMapping.Location.values()) http.put(location, new LinkedHashMap<>());
        for (ParameterMapping mapping : definition.mappings()) {
            Object value = switch (mapping.source()) {
                case CONTEXT -> context.requireValue(mapping.path());
                case FIXED -> mapping.value();
                case REQUEST -> read(normalized, mapping.path());
            };
            if (value == Missing.VALUE) continue;
            Map<String, Object> target = definition.protocol() == ApiProtocol.HTTP
                    ? http.get(mapping.effectiveLocation(definition.binding().http())) : parameters;
            String[] path = mapping.target().split("\\.");
            for (int index = 0; index < path.length - 1; index++) {
                @SuppressWarnings("unchecked")
                Map<String, Object> nested = (Map<String, Object>) target.computeIfAbsent(path[index], ignored -> new LinkedHashMap<String, Object>());
                target = nested;
            }
            target.put(path[path.length - 1], value);
        }
        if (definition.protocol() == ApiProtocol.DUBBO) {
            DubboArguments.prepare(parameters, definition.binding().dubbo().parameterTypes());
            return new Prepared(parameters, null);
        }
        HttpParameters prepared = new HttpParameters(http.get(ParameterMapping.Location.PATH), http.get(ParameterMapping.Location.QUERY), http.get(ParameterMapping.Location.BODY));
        inspectHttpPath(definition, prepared);
        return new Prepared(Map.of(), prepared);
    }

    private static void inspectHttpPath(ApiDefinition definition, HttpParameters parameters) {
        HttpUrlTemplate template = definition.binding().http().template();
        for (String variable : template.variables()) {
            Object value = parameters.path().get(variable);
            if (HttpUrlTemplate.validPathValue(value)) continue;
            String path = definition.binding().http().targetField();
            for (int index = 0; index < definition.mappings().size(); index++) {
                ParameterMapping mapping = definition.mappings().get(index);
                if (mapping.effectiveLocation(definition.binding().http()) == ParameterMapping.Location.PATH && variable.equals(mapping.target())) {
                    path = "/mappings/" + index + "/" + (mapping.source() == ParameterMapping.Source.FIXED ? "value" : "path");
                    break;
                }
            }
            throw new InvalidInput(List.of(new ResponseAdaptation.Issue(ResponseAdaptation.Stage.REQUEST,
                    value == null ? ResponseAdaptation.Reason.REQUIRED_MISSING : ResponseAdaptation.Reason.VALUE_NOT_ALLOWED,
                    path, "非空PATH标量；不含斜杠、反斜杠及独立. / ..段", value == null ? "NULL_OR_MISSING" : value.getClass().getSimpleName())));
        }
        template.expand(parameters.path());
    }
    private enum Missing { VALUE }
    private static Object read(Object value, String path) {
        for (String segment : path.split("\\.")) {
            if (!(value instanceof Map<?, ?> object) || !object.containsKey(segment)) return Missing.VALUE;
            value = object.get(segment);
        }
        return value;
    }
    private static void inspect(SchemaNode schema, Object value, boolean beforeDefaults) {
        List<ResponseAdaptation.Issue> issues = schema.requestIssues(value, beforeDefaults);
        if (!issues.isEmpty()) throw new InvalidInput(issues);
    }
}
