package io.github.chenyilei2016.openplatform.environmentrelease;

import io.github.chenyilei2016.openplatform.domain.catalog.ApiDefinition;
import io.github.chenyilei2016.openplatform.domain.environmentrelease.EnvironmentReleaseModels.SendRequest;
import io.github.chenyilei2016.openplatform.infrastructure.environmentrelease.EnvironmentReleaseJsonDigest;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;
import static org.assertj.core.api.Assertions.assertThat;

class LifecycleDigestCompatibilityTest {
    // 任务13 ApiDefinition/SendRequest 的完整旧POJO字段顺序；不通过待测摘要器生成期望值。
    private static final String OLD_DEFINITION = "{\"id\":null,\"service\":\"orders\",\"version\":\"v1\",\"method\":\"query\",\"name\":\"订单\",\"category\":\"订单\",\"owner\":\"owner\",\"protocol\":\"HTTP\",\"draftRevision\":0,\"scopeCodes\":[],\"requestSchema\":null,\"responseSchema\":null,\"errorDefinitions\":[],\"binding\":null,\"mappings\":[]}";
    private static final String OLD_REQUEST = "{\"transferId\":\"transfer-1\",\"sourceEnvironment\":\"dev\",\"targetEnvironment\":\"test\",\"sourceReleaseId\":\"release-1\",\"operatorTenantId\":\"tenant-1\",\"operatorEmployeeNo\":\"operator-1\",\"expectedRevision\":0,\"previewDigest\":\"old-preview\",\"definition\":" + OLD_DEFINITION + ",\"comment\":\"发布\"}";
    private final JsonMapper json = JsonMapper.builder().build();
    private final EnvironmentReleaseJsonDigest digests = new EnvironmentReleaseJsonDigest(json);

    @Test
    void oldStoredDefinitionAndSendRequestRetainTheirExactPreviewAndIdempotencyDigest() throws Exception {
        ApiDefinition definition = json.readValue(OLD_DEFINITION, ApiDefinition.class);
        SendRequest request = json.readValue(OLD_REQUEST, SendRequest.class);
        assertThat(digests.preview(definition, null)).isEqualTo(sha256("[" + OLD_DEFINITION + ",null]"));
        assertThat(digests.request(request)).isEqualTo(sha256(OLD_REQUEST));
        var serialized = json.readTree(json.writeValueAsString(definition));
        assertThat(serialized.at("/lifecycle/status").asText()).isEqualTo("ACTIVE");
        assertThat(serialized.get("lifecycle").has("default")).isFalse();
        assertThat(json.readValue(json.writeValueAsString(definition), ApiDefinition.class)).isEqualTo(definition);
    }

    @Test
    void historicalMappingDigestOmitsAbsentLocationButSignsExplicitLocation() throws Exception {
        String legacy = OLD_DEFINITION.replace("\"mappings\":[]", "\"mappings\":[{\"target\":\"id\",\"source\":\"REQUEST\",\"path\":\"orderId\",\"value\":null}]");
        ApiDefinition definition = json.readValue(legacy, ApiDefinition.class);
        String encoded = new io.github.chenyilei2016.openplatform.infrastructure.catalog.ApiDefinitionJson(json).encode(definition);
        assertThat(json.readTree(encoded).get("mappings").toString()).isEqualTo("[{\"target\":\"id\",\"source\":\"REQUEST\",\"path\":\"orderId\",\"value\":null}]");
        assertThat(digests.preview(definition, null)).isEqualTo(sha256("[" + legacy + ",null]"));
        tools.jackson.databind.node.ObjectNode explicit = (tools.jackson.databind.node.ObjectNode) json.readTree(legacy);
        ((tools.jackson.databind.node.ObjectNode) explicit.at("/mappings/0")).put("location", "QUERY");
        assertThat(digests.preview(json.treeToValue(explicit, ApiDefinition.class), null)).isNotEqualTo(digests.preview(definition, null));
    }

    @Test
    void employeeRequirementPreservesOldFalseDigestButSignsTrue() {
        var changed = (tools.jackson.databind.node.ObjectNode) json.readTree(OLD_DEFINITION);
        String old = digests.preview(json.readValue(OLD_DEFINITION, ApiDefinition.class), null);
        for (Boolean value : new Boolean[]{null, false}) {
            if (value == null) changed.putNull("employeeRequired"); else changed.put("employeeRequired", value);
            assertThat(digests.preview(json.treeToValue(changed, ApiDefinition.class), null)).isEqualTo(old);
        }
        changed.put("employeeRequired", true);
        assertThat(digests.preview(json.treeToValue(changed, ApiDefinition.class), null)).isNotEqualTo(old);
    }

    @Test
    void nonDefaultLifecycleMustParticipateInTheTransferDigest() {
        var changed = (tools.jackson.databind.node.ObjectNode) json.readTree(OLD_REQUEST);
        ((tools.jackson.databind.node.ObjectNode) changed.get("definition")).set("lifecycle", json.readTree("""
                {"status":"DEPRECATED","compatibility":"UNSPECIFIED","deprecationNotice":"请迁移v2"}
                """));
        assertThat(digests.request(json.treeToValue(changed, SendRequest.class)))
                .isNotEqualTo(digests.request(json.readValue(OLD_REQUEST, SendRequest.class)));
    }

    @Test
    void digestKeepsBusinessPropertiesNamedLifecycleAndSortsTheirMaps() {
        var first = (tools.jackson.databind.node.ObjectNode) json.readTree(OLD_DEFINITION);
        first.set("responseSchema", json.readTree("""
                {"type":"OBJECT","properties":{"z":{"type":"STRING"},"lifecycle":{"type":"STRING","description":"业务字段"}}}
                """));
        var second = first.deepCopy();
        second.set("responseSchema", json.readTree("""
                {"type":"OBJECT","properties":{"lifecycle":{"type":"STRING","description":"业务字段"},"z":{"type":"STRING"}}}
                """));
        String before = digests.preview(json.treeToValue(first, ApiDefinition.class), null);
        assertThat(digests.preview(json.treeToValue(second, ApiDefinition.class), null)).isEqualTo(before);
        ((tools.jackson.databind.node.ObjectNode) second.at("/responseSchema/properties/lifecycle")).put("description", "业务字段变更");
        assertThat(digests.preview(json.treeToValue(second, ApiDefinition.class), null)).isNotEqualTo(before);
    }

    @Test
    void oldNestedDubboBindingsKeepNullAndEmptyGroupDigests() throws Exception {
        for (String group : new String[]{"null", "\"\""}) {
            String binding = "{\"protocol\":\"DUBBO\",\"timeoutMillis\":1000,\"http\":null,\"dubbo\":{\"interfaceName\":\"com.example.OrderService\",\"method\":\"query\",\"version\":\"1.0\",\"group\":" + group + ",\"parameterTypes\":[\"java.lang.String\"]}}";
            String oldDefinition = OLD_DEFINITION.replace("\"binding\":null", "\"binding\":" + binding);
            ApiDefinition definition = json.readValue(oldDefinition, ApiDefinition.class);
            assertThat(digests.preview(definition, null)).isEqualTo(sha256("[" + oldDefinition + ",null]"));
            String oldRequest = OLD_REQUEST.replace(OLD_DEFINITION, oldDefinition);
            assertThat(digests.request(json.readValue(oldRequest, SendRequest.class))).isEqualTo(sha256(oldRequest));
            var updated = (tools.jackson.databind.node.ObjectNode) json.readTree(oldDefinition);
            var dubbo = (tools.jackson.databind.node.ObjectNode) updated.at("/binding/dubbo");
            dubbo.put("connectionId", "connection-a").put("connectionRevision", 1);
            String first = digests.preview(json.treeToValue(updated, ApiDefinition.class), null);
            assertThat(first).isNotEqualTo(digests.preview(definition, null));
            dubbo.put("connectionRevision", 2);
            assertThat(digests.preview(json.treeToValue(updated, ApiDefinition.class), null)).isNotEqualTo(first);
        }
    }

    @Test
    void descriptionChangesDigestButAbsentOrEmptyDescriptionPreservesHistoricalDigest() {
        ApiDefinition original = json.readValue(OLD_DEFINITION, ApiDefinition.class);
        tools.jackson.databind.node.ObjectNode definition = (tools.jackson.databind.node.ObjectNode) json.readTree(OLD_DEFINITION);
        definition.put("description", "");
        assertThat(digests.preview(json.treeToValue(definition, ApiDefinition.class), null))
                .isEqualTo(digests.preview(original, null));
        definition.put("description", "接口用途\n适用范围");
        assertThat(digests.preview(json.treeToValue(definition, ApiDefinition.class), null))
                .isNotEqualTo(digests.preview(original, null));
    }

    @Test
    void oldHttpBindingOmitsOptionalTargetFieldsAndExplicitSourceChangesSnapshot() throws Exception {
        String binding = "{\"protocol\":\"HTTP\",\"timeoutMillis\":1000,\"http\":{\"url\":\"https://provider.example/orders\",\"method\":\"POST\"},\"dubbo\":null}";
        String legacy = OLD_DEFINITION.replace("\"binding\":null", "\"binding\":" + binding);
        ApiDefinition original = json.readValue(legacy, ApiDefinition.class);
        assertThat(digests.preview(original, null)).isEqualTo(sha256("[" + legacy + ",null]"));
        String encoded = new io.github.chenyilei2016.openplatform.infrastructure.catalog.ApiDefinitionJson(json).encode(original);
        assertThat(json.readTree(encoded).at("/binding/http").toString()).isEqualTo("{\"url\":\"https://provider.example/orders\",\"method\":\"POST\"}");
        tools.jackson.databind.node.ObjectNode changed = (tools.jackson.databind.node.ObjectNode) json.readTree(legacy);
        ((tools.jackson.databind.node.ObjectNode) changed.at("/binding/http")).put("sourceClass", "com.example.OrderFeignClient").put("sourceMethod", "lookup");
        assertThat(digests.preview(json.treeToValue(changed, ApiDefinition.class), null)).isNotEqualTo(digests.preview(original, null));
    }

    private String sha256(String value) throws Exception {
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));
    }
}
