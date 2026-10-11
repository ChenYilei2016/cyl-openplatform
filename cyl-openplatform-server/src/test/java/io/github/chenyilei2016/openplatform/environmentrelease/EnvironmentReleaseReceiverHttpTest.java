package io.github.chenyilei2016.openplatform.environmentrelease;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;


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

import java.util.UUID;

@io.github.chenyilei2016.openplatform.testing.TestAdministrators
@SpringBootTest(
        properties = {
            "spring.sql.init.schema-locations=classpath:db/access-schema.sql,classpath:db/mcp-schema.sql,classpath:db/catalog-schema.sql,classpath:db/dubbo-connection-schema.sql,classpath:db/token-schema.sql,classpath:db/publication-schema.sql,classpath:db/governance-schema.sql,classpath:db/observability-schema.sql,classpath:db/operations-metrics-schema.sql,classpath:db/environment-release-receipt-schema.sql,classpath:db/administrator-schema.sql",

            "open-platform.environment-release.environment-id=target",
            "open-platform.environment-release.node-id=node-a",
            "open-platform.environment-release.trusted-sources[0].id=source",
            "open-platform.environment-release.trusted-sources[0].credential=01234567890123456789012345678901",

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
class EnvironmentReleaseReceiverHttpTest {
    @Autowired MockMvc mvc;
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
        TestAccount user = new TestAccount();
        user.setId(12L);
        user.setTenantId("tenant-1");
        user.setEmployeeNoStr("operator-1");
        when(identityService.current("test-session"))
                .thenAnswer(invocation -> user.toAccount());
    }

    private static final String INTERNAL = "/internal-api/environment-releases/v1";

    private MockHttpServletRequestBuilder machine(MockHttpServletRequestBuilder request) {
        return request.contentType("application/json")
                .header("X-Platform-Source", "source")
                .header("Authorization", "Bearer 01234567890123456789012345678901");
    }

    private JsonNode remote(MockHttpServletRequestBuilder request) throws Exception {
        var response = mvc.perform(machine(request)).andReturn().getResponse();
        assertThat(response.getStatus())
                .as("HTTP: %s", response.getContentAsString())
                .isEqualTo(200);
        return json.readTree(response.getContentAsString()).get("data");
    }

    private ObjectNode previewBody() throws Exception {
        ObjectNode definition = draft();
        definition.set("responseAdapter", json.readTree("{\"mode\":\"ENVELOPE\",\"successPath\":\"code\",\"successValues\":[200],\"dataPath\":\"data\"}"));

        definition.put("id", "untrusted-source-id");
        definition.put("draftRevision", 99);
        definition.put("protocol", "HTTP");
        return json.createObjectNode()
                .put("sourceEnvironment", "source")
                .put("targetEnvironment", "target")
                .set("definition", definition);
    }

    @Test
    void previewNamesOnlyUnavailableScopeCodes() throws Exception {
        ObjectNode input = previewBody();
        String existing = input.at("/definition/scopeCodes/0").asText();
        ((ObjectNode) input.get("definition")).set("scopeCodes", json.createArrayNode()
                .add(existing).add("missing.second").add("missing.first"));
        mvc.perform(machine(post(INTERNAL + "/preview").content(input.toString())))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.resultMsg").value("权限组不存在或已停用：missing.first、missing.second"));
    }

    private ObjectNode transfer(ObjectNode input, JsonNode preview) {
        ObjectNode request = input.deepCopy();
        request.put("transferId", UUID.randomUUID().toString())
                .put("sourceReleaseId", UUID.randomUUID().toString())
                .put("operatorTenantId", "remote-tenant")
                .put("operatorEmployeeNo", "remote-employee")
                .put("expectedRevision", preview.get("expectedRevision").asLong())
                .put("previewDigest", preview.get("previewDigest").asText())
                .put("comment", "跨环境发布");
        return request;
    }

    @Test
    void receivesTypedPublicationIdsAndRejectsAnotherObjectType() throws Exception {
        ObjectNode input = previewBody();
        JsonNode preview = remote(post(INTERNAL + "/preview").content(input.toString()));
        ObjectNode request = transfer(input, preview);
        request.put("sourceReleaseId", io.github.chenyilei2016.openplatform.domain.common.ObjectIdType.APPLICATION.nextId());
        mvc.perform(machine(post(INTERNAL + "/receive").content(request.toString()))).andExpect(status().isBadRequest());
        request.put("sourceReleaseId", io.github.chenyilei2016.openplatform.domain.common.ObjectIdType.API_RELEASE.nextId());
        JsonNode receipt = remote(post(INTERNAL + "/receive").content(request.toString()));
        assertThat(receipt.get("releaseId").asText()).startsWith("REL_");
    }

    @Test
    void requiresMachineIdentityAndMatchingEnvironment() throws Exception {
        ObjectNode request = previewBody();
        mvc.perform(
                        post(INTERNAL + "/preview")
                                .contentType("application/json")
                                .content(request.toString()))
                .andExpect(status().isUnauthorized());
        mvc.perform(
                        machine(post(INTERNAL + "/preview").content(request.toString()))
                                .header("X-Platform-Source", "other"))
                .andExpect(status().isUnauthorized());
        request.put("sourceEnvironment", "forged");
        mvc.perform(machine(post(INTERNAL + "/preview").content(request.toString())))
                .andExpect(status().isForbidden());
        request.put("sourceEnvironment", "source").put("targetEnvironment", "wrong");
        mvc.perform(machine(post(INTERNAL + "/preview").content(request.toString())))
                .andExpect(status().isForbidden());
    }

    @Test
    void previewAcceptsUnregisteredOriginButRejectsMalformedAddress() throws Exception {
        ObjectNode input = previewBody();
        ((ObjectNode) input.at("/definition/binding/http"))
                .put("url", "https://unregistered.example/orders/query");
        mvc.perform(machine(post(INTERNAL + "/preview").content(input.toString())))
                .andExpect(status().isOk());
        ((ObjectNode) input.at("/definition/binding/http"))
                .put("url", "https://user:password@unregistered.example/orders/query");
        mvc.perform(machine(post(INTERNAL + "/preview").content(input.toString())))
                .andExpect(status().isBadRequest());
    }

    @Test
    void targetConnectionDirectoryRequiresMachineIdentityAndBoundsPaging() throws Exception {
        mvc.perform(get(INTERNAL + "/dubbo-connections")).andExpect(status().isUnauthorized());
        JsonNode directory = remote(get(INTERNAL + "/dubbo-connections").param("page", "1").param("pageSize", "20"));
        assertThat(directory.get("environmentId").asText()).isEqualTo("target");
        assertThat(directory.toString()).doesNotContain("credential", "address", "namespace");
        mvc.perform(machine(get(INTERNAL + "/dubbo-connections").param("pageSize", "101")))
                .andExpect(status().isBadRequest());
    }

    @Test
    void receivesAtomicallyAndRetriesOriginalReleaseAfterApproval() throws Exception {
        ObjectNode input = previewBody();
        JsonNode preview = remote(post(INTERNAL + "/preview").content(input.toString()));
        assertThat(preview.get("change").asText()).isEqualTo("CREATE");
        ObjectNode request = transfer(input, preview);
        JsonNode received = remote(post(INTERNAL + "/receive").content(request.toString()));
        assertThat(received.get("status").asText()).isEqualTo("PENDING");
        assertThat(received.get("draftRevision").asLong()).isEqualTo(1);
        assertThat(received.get("apiId").asText()).matches("API_[0-9a-f]{32}");
        JsonNode history = send(get("/admin-api/apis/" + received.get("apiId").asText() + "/revisions/1"));
        assertThat(history.get("source").asText()).isEqualTo("ENVIRONMENT_RECEIVE_DRAFT");
        assertThat(history.at("/snapshot/responseAdapter/successValues/0").asInt()).isEqualTo(200);
        assertThat(history.get("operatorTenantId").asText()).isEqualTo("environment:source");
        assertThat(history.get("operatorEmployeeNo").asText()).isEqualTo("machine");
        String release = received.get("releaseId").asText();
        assertThat(
                        send(get("/admin-api/environment-releases/incoming/" + release))
                                .get("sourceEnvironment")
                                .asText())
                .isEqualTo("source");
        send(
                post("/admin-api/publications/" + release + "/approve")
                        .content("{\"comment\":\"通过\"}"));
        JsonNode retry = remote(post(INTERNAL + "/receive").content(request.toString()));
        assertThat(retry.get("releaseId").asText()).isEqualTo(release);
        assertThat(retry.get("liveReleaseId").asText()).isEqualTo(release);
        request.put("comment", "changed");
        mvc.perform(machine(post(INTERNAL + "/receive").content(request.toString())))
                .andExpect(status().isConflict());
    }

    @Test
    void staleConfirmationDoesNotWriteAndUnchangedCanPublishWithoutNewRevision() throws Exception {
        auditEnabled(false);
        ObjectNode input = previewBody();
        JsonNode preview = remote(post(INTERNAL + "/preview").content(input.toString()));
        JsonNode first =
                remote(post(INTERNAL + "/receive").content(transfer(input, preview).toString()));
        mvc.perform(
                        machine(
                                post(INTERNAL + "/receive")
                                        .content(transfer(input, preview).toString())))
                .andExpect(status().isConflict());
        JsonNode unchanged = remote(post(INTERNAL + "/preview").content(input.toString()));
        assertThat(unchanged.get("change").asText()).isEqualTo("UNCHANGED");
        JsonNode second =
                remote(post(INTERNAL + "/receive").content(transfer(input, unchanged).toString()));
        assertThat(second.get("draftRevision").asLong()).isEqualTo(1);
        assertThat(second.get("releaseId")).isNotEqualTo(first.get("releaseId"));
        assertThat(send(get("/admin-api/apis/" + first.get("apiId").asText() + "/revisions")).get("total").asInt()).isEqualTo(1);
        ObjectNode invalid = transfer(input, unchanged);
        invalid.put("expectedRevision", 1.5);
        mvc.perform(machine(post(INTERNAL + "/receive").content(invalid.toString())))
                .andExpect(status().isBadRequest());
    }

    @Test
    void updateAndRejectionPreserveLiveAndEmergencyDisable() throws Exception {
        auditEnabled(false);
        ObjectNode input = previewBody();
        JsonNode first =
                remote(
                        post(INTERNAL + "/receive")
                                .content(
                                        transfer(
                                                        input,
                                                        remote(
                                                                post(INTERNAL + "/preview")
                                                                        .content(input.toString())))
                                                .toString()));
        String apiId = first.get("apiId").asText();
        send(
                put("/admin-api/publications/apis/" + apiId + "/status")
                        .content(
                                "{\"enabled\":false,\"expectedStateVersion\":1,\"reason\":\"紧急停用\"}"));
        auditEnabled(true);
        ((ObjectNode) input.get("definition")).put("name", "跨环境新版本");
        JsonNode preview = remote(post(INTERNAL + "/preview").content(input.toString()));
        assertThat(preview.get("change").asText()).isEqualTo("UPDATE");
        ObjectNode request = transfer(input, preview);
        JsonNode pending = remote(post(INTERNAL + "/receive").content(request.toString()));
        assertThat(pending.get("draftRevision").asLong()).isEqualTo(2);
        assertThat(send(get("/admin-api/apis/" + apiId + "/revisions")).get("total").asInt()).isEqualTo(2);
        JsonNode history = send(get("/admin-api/apis/" + apiId + "/revisions/2"));
        assertThat(history.get("source").asText()).isEqualTo("ENVIRONMENT_RECEIVE_DRAFT");
        assertThat(history.at("/snapshot/responseAdapter/successValues/0").asInt()).isEqualTo(200);
        assertThat(history.at("/snapshot/name").asText()).isEqualTo("跨环境新版本");
        assertThat(pending.get("liveReleaseId")).isEqualTo(first.get("releaseId"));
        mvc.perform(machine(post(INTERNAL + "/preview").content(input.toString())))
                .andExpect(status().isConflict());
        send(
                post("/admin-api/publications/" + pending.get("releaseId").asText() + "/reject")
                        .content("{\"comment\":\"拒绝\"}"));
        JsonNode rejected =
                remote(get(INTERNAL + "/receipts/" + request.get("transferId").asText()));
        assertThat(rejected.get("status").asText()).isEqualTo("REJECTED");
        assertThat(rejected.get("enabled").asBoolean()).isFalse();
        assertThat(rejected.get("liveReleaseId")).isEqualTo(first.get("releaseId"));
        auditEnabled(false);
        JsonNode applied =
                remote(
                        post(INTERNAL + "/receive")
                                .content(
                                        transfer(
                                                        input,
                                                        remote(
                                                                post(INTERNAL + "/preview")
                                                                        .content(input.toString())))
                                                .toString()));
        assertThat(applied.get("status").asText()).isEqualTo("APPLIED");
        assertThat(applied.get("enabled").asBoolean()).isFalse();
        assertThat(applied.get("draftRevision").asLong()).isEqualTo(2);
    }

    @Test
    void approvalRevalidatesTargetScopesAndKeepsReceiptQueryable() throws Exception {
        ObjectNode input = previewBody();
        ObjectNode request =
                transfer(input, remote(post(INTERNAL + "/preview").content(input.toString())));
        JsonNode pending = remote(post(INTERNAL + "/receive").content(request.toString()));
        JsonNode scope =
                send(get("/admin-api/scopes")
                                .param("query", input.at("/definition/scopeCodes/0").asText()))
                        .at("/items/0");
        send(
                put("/admin-api/scopes/" + scope.get("id").asText())
                        .content(
                                "{\"name\":\"停用\",\"enabled\":false,\"defaultForNewApplication\":false}"));
        send(
                post("/admin-api/publications/" + pending.get("releaseId").asText() + "/approve")
                        .content("{\"comment\":\"检查\"}"));
        JsonNode failed = remote(post(INTERNAL + "/receive").content(request.toString()));
        assertThat(failed.get("status").asText()).isEqualTo("FAILED");
        assertThat(failed.get("liveReleaseId").isNull()).isTrue();
        mvc.perform(
                        get(
                                "/admin-api/environment-releases/incoming/"
                                        + pending.get("releaseId").asText()))
                .andExpect(status().isUnauthorized());
        mvc.perform(
                        machine(
                                post(INTERNAL + "/preview")
                                        .content("{\"padding\":\"" + "x".repeat(262144) + "\"}")))
                .andExpect(status().isPayloadTooLarge());
    }

    @Test
    void changedSourceDigestAndManualDraftRevisionBothRejectWithoutPartialWrite() throws Exception {
        auditEnabled(false);
        ObjectNode input = previewBody();
        JsonNode preview = remote(post(INTERNAL + "/preview").content(input.toString()));
        ObjectNode altered = transfer(input, preview);
        ((ObjectNode) altered.get("definition")).put("name", "预览后偷改");
        mvc.perform(machine(post(INTERNAL + "/receive").content(altered.toString())))
                .andExpect(status().isConflict());
        assertThat(
                        send(get("/admin-api/apis")
                                        .param("query", input.at("/definition/service").asText()))
                                .get("total")
                                .asInt())
                .isZero();
        JsonNode first =
                remote(post(INTERNAL + "/receive").content(transfer(input, preview).toString()));
        ((ObjectNode) input.get("definition")).put("name", "计划目标更新");
        ObjectNode stale =
                transfer(input, remote(post(INTERNAL + "/preview").content(input.toString())));
        ObjectNode manual = ((ObjectNode) input.get("definition")).deepCopy();
        manual.remove("id");
        manual.remove("draftRevision");
        manual.remove("protocol");
        manual.put("expectedRevision", 1).put("name", "人工编辑");
        send(put("/admin-api/apis/" + first.get("apiId").asText()).content(manual.toString()));
        mvc.perform(machine(post(INTERNAL + "/receive").content(stale.toString())))
                .andExpect(status().isConflict());
        assertThat(send(get("/admin-api/apis/" + first.get("apiId").asText())).get("name").asText())
                .isEqualTo("人工编辑");
        mvc.perform(machine(get(INTERNAL + "/receipts/" + stale.get("transferId").asText())))
                .andExpect(status().isNotFound());
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
