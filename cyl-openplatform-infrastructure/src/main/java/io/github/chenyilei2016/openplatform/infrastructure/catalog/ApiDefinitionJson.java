package io.github.chenyilei2016.openplatform.infrastructure.catalog;

import io.github.chenyilei2016.openplatform.domain.catalog.ApiDefinition;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiDefinitionCodec;
import io.github.chenyilei2016.openplatform.domain.catalog.ParameterMapping;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiBinding;
import com.fasterxml.jackson.annotation.JsonInclude;
import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import org.springframework.stereotype.Component;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.core.exc.StreamConstraintsException;
import tools.jackson.databind.ObjectWriter;
import java.nio.charset.StandardCharsets;

/** 草稿和提交快照共享同一JSON精度及可读规模边界。 */
@Component
public class ApiDefinitionJson implements ApiDefinitionCodec {
    private final JsonMapper json;
    private final ObjectWriter writer;

    public ApiDefinitionJson(JsonMapper json) {
        this.json = json;
        writer = json.rebuild().addMixIn(ParameterMapping.class, MappingCompatibilityMixin.class)
                .addMixIn(ApiBinding.Http.class, HttpCompatibilityMixin.class).build().writer();
    }

    /** 不为旧配置补入location:null，保留复制重试及已存摘要的规范化正文。 */
    public abstract static class MappingCompatibilityMixin {
        @JsonInclude(JsonInclude.Include.NON_NULL)
        abstract ParameterMapping.Location location();
    }

    public abstract static class HttpCompatibilityMixin {
        @JsonInclude(JsonInclude.Include.NON_NULL) abstract ApiBinding.HttpTargetMode targetMode();
        @JsonInclude(JsonInclude.Include.NON_NULL) abstract String serviceName();
        @JsonInclude(JsonInclude.Include.NON_NULL) abstract String path();
        @JsonInclude(JsonInclude.Include.NON_NULL) abstract String sourceClass();
        @JsonInclude(JsonInclude.Include.NON_NULL) abstract String sourceMethod();
    }

    @Override
    public ApiDefinition decode(String text) { return json.readValue(text, ApiDefinition.class); }

    @Override
    public String encode(ApiDefinition definition) {
        byte[] encoded = writer.writeValueAsBytes(definition);
        try {
            json.tokenStreamFactory().streamReadConstraints().validateDocumentLength(encoded.length);
            // 规范化补全字段后也必须满足同一读取限制，不能保存随后无法读取的草稿。
            try (var parser = json.createParser(encoded)) {
                while (parser.nextToken() != null) { /* 原生解析器同时验证token数与嵌套限制。 */ }
            }
        } catch (StreamConstraintsException exception) {
            throw new PlatformException(ErrorCode.INVALID_REQUEST, "草稿规范化后的JSON超出规模限制，请精简结构或示例");
        }
        return new String(encoded, StandardCharsets.UTF_8);
    }
}
