package io.github.chenyilei2016.openplatform.config;

import org.springframework.beans.factory.config.ConfigurableBeanFactory;
import org.springframework.boot.jackson.autoconfigure.JsonMapperBuilderCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Scope;
import tools.jackson.core.StreamReadConstraints;
import tools.jackson.core.StreamReadFeature;
import tools.jackson.core.json.JsonFactory;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.json.JsonMapper;

import java.util.List;

/** 使用Jackson原生边界限制契约JSON规模，保留Boot模块及定制器。 */
@Configuration(proxyBeanMethods = false)
public class JsonConfiguration {
    @Bean
    @Scope(ConfigurableBeanFactory.SCOPE_PROTOTYPE)
    public JsonMapper.Builder jsonMapperBuilder(List<JsonMapperBuilderCustomizer> customizers) {
        var factory = JsonFactory.builder().streamReadConstraints(StreamReadConstraints.builder()
                .maxDocumentLength(262_144).maxTokenCount(20_000).maxNestingDepth(64)
                .maxStringLength(65_536).maxNumberLength(128).build()).build();
        var builder = JsonMapper.builder(factory);
        customizers.forEach(customizer -> customizer.customize(builder));
        // 修订、超时、分页等整数契约不能把1.5静默截断成1；Map中的业务小数仍保留BigDecimal。
        builder.withCoercionConfig(tools.jackson.databind.type.LogicalType.Integer, coercion ->
                coercion.setCoercion(tools.jackson.databind.cfg.CoercionInputShape.String,
                        tools.jackson.databind.cfg.CoercionAction.Fail));
        return builder.disable(DeserializationFeature.ACCEPT_FLOAT_AS_INT)
                .enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
                .enable(DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS)
                .enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION);
    }
}
