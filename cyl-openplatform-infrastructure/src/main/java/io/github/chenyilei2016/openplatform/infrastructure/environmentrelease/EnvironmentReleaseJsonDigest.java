package io.github.chenyilei2016.openplatform.infrastructure.environmentrelease;

import com.fasterxml.jackson.annotation.JsonInclude;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiDefinition;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiBinding;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiLifecycle;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiOperationKind;
import io.github.chenyilei2016.openplatform.domain.catalog.McpToolConfig;
import io.github.chenyilei2016.openplatform.domain.catalog.ResponseAdapter;
import io.github.chenyilei2016.openplatform.domain.catalog.SchemaNode;
import io.github.chenyilei2016.openplatform.domain.catalog.ParameterMapping;
import io.github.chenyilei2016.openplatform.infrastructure.catalog.ApiDefinitionJson;
import io.github.chenyilei2016.openplatform.domain.environmentrelease.EnvironmentReleaseDigest;
import io.github.chenyilei2016.openplatform.domain.environmentrelease.EnvironmentReleaseModels.SendRequest;

import org.springframework.stereotype.Component;

import tools.jackson.databind.SerializationFeature;
import tools.jackson.databind.ObjectWriter;
import tools.jackson.databind.json.JsonMapper;

import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;

@Component
public class EnvironmentReleaseJsonDigest implements EnvironmentReleaseDigest {
    private final ObjectWriter writer;

    public EnvironmentReleaseJsonDigest(JsonMapper json) {
        // 只在摘要副本省略旧契约不存在的默认属性；保留原POJO属性顺序与嵌套Map排序。
        writer = json.rebuild().addMixIn(ApiDefinition.class, DefinitionDigestMixin.class)
                .addMixIn(SchemaNode.class, SchemaDigestMixin.class)
                .addMixIn(ParameterMapping.class, ApiDefinitionJson.MappingCompatibilityMixin.class)
                .addMixIn(ApiBinding.Http.class, ApiDefinitionJson.HttpCompatibilityMixin.class)
                .addMixIn(ApiBinding.Dubbo.class, DubboDigestMixin.class).build()
                .writer().with(SerializationFeature.ORDER_MAP_ENTRIES_BY_KEYS);
    }

    private abstract static class DubboDigestMixin {
        @JsonInclude(JsonInclude.Include.NON_NULL)
        abstract String connectionId();
        @JsonInclude(JsonInclude.Include.NON_NULL)
        abstract Long connectionRevision();
        @JsonInclude(JsonInclude.Include.NON_NULL)
        abstract String providerApplication();
    }

    private abstract static class SchemaDigestMixin {
        @JsonInclude(JsonInclude.Include.NON_DEFAULT)
        abstract Boolean nullable();
    }

    private abstract static class DefinitionDigestMixin {
        @JsonInclude(value = JsonInclude.Include.CUSTOM, valueFilter = DirectResponseFilter.class)
        abstract ResponseAdapter responseAdapter();
        @JsonInclude(JsonInclude.Include.NON_EMPTY)
        abstract String description();
        @JsonInclude(JsonInclude.Include.NON_DEFAULT)
        abstract Boolean employeeRequired();
        @JsonInclude(value = JsonInclude.Include.CUSTOM, valueFilter = DefaultLifecycleFilter.class)
        abstract ApiLifecycle lifecycle();
        @JsonInclude(value = JsonInclude.Include.CUSTOM, valueFilter = MutationFilter.class)
        abstract ApiOperationKind operationKind();
        @JsonInclude(JsonInclude.Include.NON_NULL)
        abstract String idempotencyField();
        @JsonInclude(value = JsonInclude.Include.CUSTOM, valueFilter = DisabledMcpToolFilter.class)
        abstract McpToolConfig mcpTool();
    }

    public static final class MutationFilter {
        @Override public boolean equals(Object value) { return ApiOperationKind.MUTATION.equals(value); }
        @Override public int hashCode() { return 0; }
    }

    public static final class DisabledMcpToolFilter {
        @Override public boolean equals(Object value) { return McpToolConfig.DISABLED.equals(value); }
        @Override public int hashCode() { return 0; }
    }

    public static final class DirectResponseFilter {
        @Override public boolean equals(Object value) { return ResponseAdapter.DIRECT.equals(value); }
        @Override public int hashCode() { return 0; }
    }

    public static final class DefaultLifecycleFilter {
        @Override
        public boolean equals(Object value) { return value instanceof ApiLifecycle lifecycle && lifecycle.isDefault(); }
        @Override
        public int hashCode() { return 0; }
    }

    @Override
    public String preview(ApiDefinition definition, ApiDefinition before) {
        return digest(java.util.Arrays.asList(definition, before));
    }

    @Override
    public String request(SendRequest request) {
        return digest(request);
    }

    private String digest(Object value) {
        try {
            byte[] bytes = writer.writeValueAsBytes(value);
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException(impossible);
        }
    }
}
