package io.github.chenyilei2016.openplatform.environmentrelease;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import io.github.chenyilei2016.openplatform.domain.catalog.ApiDefinition;
import io.github.chenyilei2016.openplatform.domain.environmentrelease.*;
import io.github.chenyilei2016.openplatform.domain.environmentrelease.EnvironmentReleaseModels.*;
import io.github.chenyilei2016.openplatform.domain.publication.ReleaseStatus;

import io.github.chenyilei2016.openplatform.application.identity.AccountAuthentication;
import io.github.chenyilei2016.openplatform.testing.TestAccount;

import jakarta.servlet.http.Cookie;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.webmvc.test.autoconfigure.MockMvcPrint;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

@io.github.chenyilei2016.openplatform.testing.TestAdministrators
@SpringBootTest(
        properties = {
            "spring.sql.init.schema-locations=classpath:db/access-schema.sql,classpath:db/mcp-schema.sql,classpath:db/administrator-schema.sql,classpath:db/catalog-schema.sql,classpath:db/dubbo-connection-schema.sql,classpath:db/token-schema.sql,classpath:db/publication-schema.sql,classpath:db/governance-schema.sql,classpath:db/observability-schema.sql,classpath:db/operations-metrics-schema.sql,classpath:db/environment-release-transfer-schema.sql,classpath:db/environment-release-receipt-schema.sql",


            "test.admin.operators[0].tenant-id=tenant-1",
            "test.admin.operators[0].employee-no=operator-1",
            "test.admin.operators[0].permissions[0]=MANAGE_APIS",
            "test.admin.operators[0].permissions[1]=MANAGE_APPLICATIONS",
            "test.admin.operators[0].permissions[2]=PUBLISH_APIS",
            "test.admin.operators[0].permissions[3]=REVIEW_APIS",
            "test.admin.operators[1].tenant-id=tenant-1",
            "test.admin.operators[1].employee-no=publisher",
            "test.admin.operators[1].permissions[0]=PUBLISH_APIS",
            "test.admin.operators[2].tenant-id=tenant-1",
            "test.admin.operators[2].employee-no=reviewer",
            "test.admin.operators[2].permissions[0]=REVIEW_APIS",
            "test.admin.operators[3].tenant-id=tenant-1",
            "test.admin.operators[3].employee-no=viewer",
            "test.admin.operators[3].permissions[0]=VIEW_AUDIT"
})
@AutoConfigureMockMvc(print = MockMvcPrint.NONE)
@org.springframework.context.annotation.Import(io.github.chenyilei2016.openplatform.testing.CatalogReferenceFixture.class)
class EnvironmentReleaseSourceHttpTest {
    @Autowired MockMvc mvc;
    @MockitoBean EnvironmentReleaseClient client;
    @MockitoBean ReleaseEnvironment releaseEnvironment;
    @Autowired org.springframework.core.env.ConfigurableEnvironment environment;
    @Autowired org.springframework.jdbc.core.JdbcTemplate database;

    @org.junit.jupiter.api.AfterEach
    void resetConfig() {
        environment.getPropertySources().remove("publication-test");
    }

    private void auditEnabled(boolean enabled) {
        environment
                .getPropertySources()
                .addFirst(
                        new org.springframework.core.env.MapPropertySource(
                                "publication-test",
                                java.util.Map.of("open-platform.publish.audit.enabled", enabled)));
    }

    @MockitoBean AccountAuthentication identityService;
    private final JsonMapper json =
            JsonMapper.builder()
                    .enable(
                            tools.jackson.databind.DeserializationFeature
                                    .USE_BIG_DECIMAL_FOR_FLOATS)
                    .build();

    @BeforeEach
    void login() {
        when(releaseEnvironment.environmentId()).thenReturn("source");
        when(releaseEnvironment.nodeId()).thenReturn("source-a");
        when(releaseEnvironment.targets())
                .thenReturn(List.of(new Target("target", "目标环境", List.of("target-a", "target-b"))));
        when(client.preview(eq("target"), any()))
                .thenAnswer(
                        invocation -> {
                            ApiDefinition definition = invocation.getArgument(1);
                            return new Preview(
                                    "target",
                                    "target-a",
                                    definition,
                                    null,
                                    "CREATE",
                                    0,
                                    List.of("binding"),
                                    "a".repeat(64),
                                    true,
                                    null);
                        });
        TestAccount user = new TestAccount();
        user.setId(12L);
        user.setTenantId("tenant-1");
        user.setEmployeeNoStr("operator-1");
        when(identityService.current("test-session"))
                .thenAnswer(invocation -> user.toAccount());
    }

    @Test
    void targetOwnerMappingAndCurrentCategoryNameDoNotRewriteSourceSnapshot() throws Exception {
        String oldName="source-"+UUID.randomUUID();
        JsonNode category=send(post("/admin-api/api-categories").content(json.writeValueAsString(java.util.Map.of("name",oldName))));
        ObjectNode source=draft();source.put("category",oldName);
        JsonNode release=applied(source);
        String currentName="renamed-"+UUID.randomUUID();
        send(put("/admin-api/api-categories/"+category.get("id").asText()).content(json.writeValueAsString(java.util.Map.of("name",currentName,"expectedRevision",1))));
        String targetOwner="EMP_00000000000000000000000000000092";
        JsonNode result=send(post(PATH+"/preview").content(json.writeValueAsString(java.util.Map.of("releaseId",release.get("id").asText(),"targetId","target","targetOwnerId",targetOwner))));
        assertThat(result.at("/definition/owner").asText()).isEqualTo(targetOwner);
        assertThat(result.at("/definition/category").asText()).isEqualTo(currentName);
        JsonNode original=send(get("/admin-api/publications/"+release.get("id").asText()));
        assertThat(original.at("/snapshot/category").asText()).isEqualTo(oldName);
    }

    private static final String PATH = "/admin-api/environment-releases";

    private JsonNode applied(ObjectNode draft) throws Exception {
        auditEnabled(false);
        String id = send(post("/admin-api/apis").content(draft.toString())).get("id").asText();
        return send(
                post("/admin-api/publications/apis/" + id + "/submissions")
                        .content(
                                "{\"expectedDraftRevision\":1,\"expectedStateVersion\":0,\"submissionKey\":\""
                                        + UUID.randomUUID()
                                        + "\",\"comment\":\"发布\"}"));
    }

    private ObjectNode transfer(JsonNode release) {
        return json.createObjectNode()
                .put("transferId", UUID.randomUUID().toString())
                .put("releaseId", release.get("id").asText())
                .put("targetId", "target")
                .putNull("binding")
                .put("expectedRevision", 0)
                .put("previewDigest", "a".repeat(64))
                .put("comment", "交付");
    }

    private Receipt receipt(SendRequest request, String node, long stateVersion) {
        return new Receipt(
                "target",
                node,
                "source",
                request.transferId(),
                "target-api",
                "target-release",
                1,
                ReleaseStatus.APPLIED,
                false,
                "target-release",
                true,
                stateVersion,
                Instant.now());
    }

    @Test
    void refusesRequiredEmployeeTransferWhenTargetDropsTheRequirement() throws Exception {
        JsonNode release = applied(draft().put("employeeRequired", true));
        when(client.preview(eq("target"), any())).thenAnswer(invocation -> {
            ApiDefinition definition = invocation.getArgument(1);
            ObjectNode oldTarget = (ObjectNode) json.valueToTree(definition);
            oldTarget.remove("employeeRequired");
            return new Preview("target", "target-a", json.treeToValue(oldTarget, ApiDefinition.class), null,
                    "CREATE", 0, List.of(), "a".repeat(64), true, null);
        });
        mvc.perform(auth(post(PATH).content(transfer(release).toString()))).andExpect(status().isConflict());
        verify(client, never()).receive(any(), any());
    }

    @Test
    void previewUsesFixedAppliedSnapshotAndExplicitTargetBinding() throws Exception {
        ObjectNode body = draft();
        body.set("responseAdapter", json.readTree("{\"mode\":\"ENVELOPE\",\"successPath\":\"code\",\"successValues\":[200],\"dataPath\":\"data\"}"));

        JsonNode release = applied(body);
        body.put("name", "之后修改的草稿").put("expectedRevision", 1);
        send(put("/admin-api/apis/" + release.get("apiId").asText()).content(body.toString()));
        ObjectNode preview =
                json.createObjectNode()
                        .put("releaseId", release.get("id").asText())
                        .put("targetId", "target");
        ObjectNode binding = ((ObjectNode) body.get("binding")).deepCopy();
        ((ObjectNode) binding.get("http")).put("url", "https://target.example/order");
        preview.set("binding", binding);
        JsonNode result = send(post(PATH + "/preview").content(preview.toString()));
        assertThat(result.at("/definition/name").asText()).isEqualTo("订单查询");
        assertThat(result.at("/definition/responseAdapter/successValues/0").asInt()).isEqualTo(200);
        assertThat(result.at("/definition/id").isNull()).isTrue();
        assertThat(result.at("/definition/draftRevision").asLong()).isZero();
        assertThat(result.at("/definition/binding/http/url").asText())
                .isEqualTo("https://target.example/order");
        auditEnabled(true);
        JsonNode pending =
                send(
                        post("/admin-api/publications/apis/"
                                        + release.get("apiId").asText()
                                        + "/submissions")
                                .content(
                                        "{\"expectedDraftRevision\":2,\"expectedStateVersion\":1,\"submissionKey\":\""
                                                + UUID.randomUUID()
                                                + "\",\"comment\":\"待审\"}"));
        preview.put("releaseId", pending.get("id").asText());
        mvc.perform(auth(post(PATH + "/preview").content(preview.toString())))
                .andExpect(status().isBadRequest());
        verify(client, times(1)).preview(eq("target"), any());
    }

    @Test
    void unknownIsPersistedAndOriginalTransferCanBeRetriedWithoutReplacingContent()
            throws Exception {
        JsonNode release = applied(draft());
        ObjectNode request = transfer(release);
        String id = request.get("transferId").asText();
        when(client.receive(eq("target"), any()))
                .thenReturn(new DeliveryResult(null, false, "网络结果未知"))
                .thenAnswer(
                        invocation ->
                                new DeliveryResult(
                                        receipt(invocation.getArgument(1), "target-a", 1),
                                        false,
                                        null));
        JsonNode unknown = send(post(PATH).content(request.toString()));
        assertThat(unknown.get("deliveryState").asText()).isEqualTo("UNKNOWN");
        assertThat(send(get(PATH + "/" + id)).at("/request/transferId").asText()).isEqualTo(id);
        JsonNode retried = send(post(PATH + "/" + id + "/retry"));
        assertThat(retried.get("deliveryState").asText()).isEqualTo("ACCEPTED");
        assertThat(retried.at("/receipt/liveReleaseId").asText()).isEqualTo("target-release");
        request.put("comment", "同号不同内容");
        mvc.perform(auth(post(PATH).content(request.toString()))).andExpect(status().isConflict());
        verify(client, times(2)).receive(eq("target"), any());
        JsonNode listing = send(get(PATH).param("query", release.get("service").asText()));
        assertThat(listing.get("total").asInt()).isEqualTo(1);
        JsonNode summary = listing.at("/items/0");
        assertThat(summary.has("request")).isFalse();
        assertThat(summary.has("requestJson")).isFalse();
        assertThat(summary.get("sourceEnvironment").asText()).isEqualTo("source");
        assertThat(summary.get("observations").isArray()).isTrue();
        assertThat(summary.get("observations").isEmpty()).isTrue();
        assertThat(summary.get("targetId").asText()).isEqualTo("target");
        JsonNode byApi = send(get(PATH).param("apiId", release.get("apiId").asText()));
        assertThat(byApi.get("total").asInt()).isEqualTo(1);
        assertThat(byApi.at("/items/0/id").asText()).isEqualTo(id);
        mvc.perform(auth(get(PATH).param("apiId", "missing-api"))).andExpect(status().isNotFound());
    }

    @Test
    void refreshRecordsPartialAndUnavailableNodesWithoutErasingLastReceipt() throws Exception {
        JsonNode release = applied(draft());
        ObjectNode request = transfer(release);
        String id = request.get("transferId").asText();
        when(client.receive(eq("target"), any()))
                .thenAnswer(
                        invocation ->
                                new DeliveryResult(
                                        receipt(invocation.getArgument(1), "target-a", 1),
                                        false,
                                        null));
        JsonNode accepted = send(post(PATH).content(request.toString()));
        SendRequest stored = json.treeToValue(accepted.get("request"), SendRequest.class);
        when(client.observe("target", id))
                .thenReturn(
                        List.of(
                                new NodeObservation(
                                        "target-a",
                                        receipt(stored, "target-a", 2),
                                        null,
                                        Instant.now()),
                                new NodeObservation("target-b", null, "目标节点不可达", Instant.now())));
        JsonNode partial = send(post(PATH + "/" + id + "/refresh"));
        assertThat(partial.at("/receipt/stateVersion").asLong()).isEqualTo(2);
        assertThat(partial.at("/observations/1/receipt").isNull()).isTrue();
        assertThat(partial.at("/observations/1/error").asText()).isEqualTo("目标节点不可达");
        JsonNode listed = send(get(PATH).param("query", release.get("service").asText())).at("/items/0");
        assertThat(listed.get("sourceEnvironment").asText()).isEqualTo("source");
        assertThat(listed.get("observations")).isEqualTo(partial.get("observations"));
        assertThat(listed.has("requestJson") || listed.has("request")).isFalse();
        when(client.observe("target", id))
                .thenReturn(
                        List.of(
                                new NodeObservation("target-a", null, "节点A未知", Instant.now()),
                                new NodeObservation("target-b", null, "节点B未知", Instant.now())));
        JsonNode unavailable = send(post(PATH + "/" + id + "/refresh"));
        assertThat(unavailable.at("/receipt/stateVersion").asLong()).isEqualTo(2);
        assertThat(unavailable.get("error").asText()).contains("本次未取得");
        assertThat(unavailable.at("/observations/0/receipt").isNull()).isTrue();
    }

    @Test
    void managementIdentityCsrfPublishPermissionAndExactRevisionAreRequired() throws Exception {
        JsonNode release = applied(draft());
        ObjectNode request = transfer(release);
        mvc.perform(get(PATH + "/targets")).andExpect(status().isUnauthorized());
        mvc.perform(
                        post(PATH)
                                .session(io.github.chenyilei2016.openplatform.testing.TestSessions.session("test-session"))
                                .contentType("application/json")
                                .content(request.toString()))
                .andExpect(status().isForbidden());
        for (JsonNode invalid :
                List.<JsonNode>of(
                        json.valueToTree(0.5), json.valueToTree("0"), json.valueToTree(-1))) {
            request.set("expectedRevision", invalid);
            mvc.perform(auth(post(PATH).content(request.toString())))
                    .andExpect(status().isBadRequest());
        }
        TestAccount reviewer = new TestAccount();
        reviewer.setId(12L);
        reviewer.setTenantId("tenant-1");
        reviewer.setEmployeeNoStr("reviewer");
        when(identityService.current("test-session"))
                .thenAnswer(invocation -> reviewer.toAccount());
        send(get(PATH + "/targets"));
        request.put("expectedRevision", 0);
        mvc.perform(auth(post(PATH).content(request.toString()))).andExpect(status().isForbidden());
        verifyNoInteractions(client);
    }

    private ObjectNode draft() throws Exception {
        String code = "scope_" + UUID.randomUUID().toString().replace("-", "");
        send(
                post("/admin-api/scopes")
                        .content(
                                "{\"code\":\""
                                        + code
                                        + "\",\"name\":\"发布权限组\",\"enabled\":true,\"defaultForNewApplication\":false}"));
        return (ObjectNode)
                json.readTree(
                        """
{"service":"orders_%s","version":"v1","method":"query","name":"订单查询","category":"订单","owner":"研发","scopeCodes":["%s"],
"requestSchema":{"type":"OBJECT","properties":{"orderId":{"type":"STRING","example":"order-001"}}},
"responseSchema":{"type":"NUMBER","example":1234567890.1234567890123456789},"errorDefinitions":[],
"binding":{"protocol":"HTTP","timeoutMillis":3000,"http":{"url":"https://internal.example/orders/query","method":"POST"}},"mappings":[]}
"""
                                .formatted(UUID.randomUUID().toString().replace("-", ""), code));
    }

    private MockHttpServletRequestBuilder auth(MockHttpServletRequestBuilder r) {
        return r.session(io.github.chenyilei2016.openplatform.testing.TestSessions.session("test-session"))
                .header("X-CSRF-Token", "76832d7fdbcdbf4a72129f8b7def9016")
                .contentType("application/json");
    }

    private JsonNode send(MockHttpServletRequestBuilder r) throws Exception {
        var response = mvc.perform(auth(r)).andReturn().getResponse();
        assertThat(response.getStatus())
                .as("HTTP response: %s", response.getContentAsString())
                .isEqualTo(200);
        return json.readTree(response.getContentAsString()).get("data");
    }
}
