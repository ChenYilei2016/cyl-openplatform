package io.github.chenyilei2016.openplatform.web.admin.catalog;

import io.github.chenyilei2016.openplatform.web.shared.common.JsonRequestReader;
import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.FieldValidation;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Validator;
import org.springframework.stereotype.Component;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.cfg.CoercionAction;
import tools.jackson.databind.cfg.CoercionInputShape;
import tools.jackson.databind.type.LogicalType;
import tools.jackson.databind.ObjectReader;
import java.io.IOException;

/** 草稿创建、更新与复制共用严格JSON类型和精度约束。 */
@Component
public class ApiDraftRequestReader {
    private final JsonMapper json;
    private final JsonRequestReader bodies;
    private final Validator validator;
    public ApiDraftRequestReader(JsonMapper json, JsonRequestReader bodies, Validator validator) {
        this.bodies = bodies;
        this.validator = validator;
        this.json = json.rebuild()
                .enable(tools.jackson.databind.cfg.EnumFeature.FAIL_ON_NUMBERS_FOR_ENUMS)
                .withCoercionConfig(LogicalType.Boolean, coercion -> coercion
                        .setCoercion(CoercionInputShape.Integer, CoercionAction.Fail)
                        .setCoercion(CoercionInputShape.Float, CoercionAction.Fail)
                        .setCoercion(CoercionInputShape.String, CoercionAction.Fail))
                .withCoercionConfig(LogicalType.Textual, coercion -> coercion
                        .setCoercion(CoercionInputShape.Integer, CoercionAction.Fail)
                        .setCoercion(CoercionInputShape.Float, CoercionAction.Fail)
                        .setCoercion(CoercionInputShape.Boolean, CoercionAction.Fail)).build();

    }
    public ObjectReader readerFor(Class<?> type) {
        return json.readerFor(type).with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS);
    }
    public <T> T read(HttpServletRequest request, Class<T> type) throws IOException {
        byte[] bytes = bodies.readBytes(request, 262_144);
        T body;
        try { body = readerFor(type).readValue(bytes); }
        catch (tools.jackson.core.exc.StreamConstraintsException tooLarge) {
            throw new PlatformException(ErrorCode.INVALID_REQUEST, "JSON字节、节点或嵌套规模超限，请精简样例和结构");
        }
        catch (tools.jackson.core.JacksonException invalid) {
            StringBuilder path = new StringBuilder();
            for (tools.jackson.core.JacksonException.Reference part : invalid.getPath()) {
                if (part.getPropertyName() != null) path.append('/').append(FieldValidation.segment(part.getPropertyName()));
                else if (part.getIndex() >= 0) path.append('/').append(part.getIndex());
            }
            throw FieldValidation.invalid(path.toString(), path.isEmpty() ? FieldValidation.Reason.INVALID_JSON
                    : FieldValidation.Reason.TYPE_MISMATCH, "草稿JSON格式或字段类型不合法，请检查填写内容");
        }
        if (body == null) throw FieldValidation.invalid("", FieldValidation.Reason.REQUIRED, "草稿不能为空");
        FieldValidation checks = new FieldValidation();
        validator.validate(body).stream().sorted(java.util.Comparator.comparing(value -> value.getPropertyPath().toString()))
                .forEach(value -> {
                    StringBuilder path = new StringBuilder();
                    for (jakarta.validation.Path.Node node : value.getPropertyPath()) {
                        if (node.getIndex() != null) path.append('/').append(node.getIndex());
                        if (node.getName() != null && !node.getName().startsWith("<"))
                            path.append('/').append(FieldValidation.segment(node.getName()));
                    }
                    checks.add(new FieldValidation.Issue(path.toString(), FieldValidation.Reason.INVALID_VALUE,
                            "必填字段缺失或字段内容超出限制"));
                });
        checks.requireValid();
        return body;
    }
}
