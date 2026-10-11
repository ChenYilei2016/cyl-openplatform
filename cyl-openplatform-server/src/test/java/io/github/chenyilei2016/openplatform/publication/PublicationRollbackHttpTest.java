package io.github.chenyilei2016.openplatform.publication;

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
            "spring.sql.init.schema-locations=classpath:db/access-schema.sql,classpath:db/mcp-schema.sql,classpath:db/catalog-schema.sql,classpath:db/dubbo-connection-schema.sql,classpath:db/token-schema.sql,classpath:db/publication-schema.sql,classpath:db/governance-schema.sql,classpath:db/observability-schema.sql,classpath:db/operations-metrics-schema.sql,classpath:db/administrator-schema.sql",

            "open-platform.environment-release.environment-id=rollback-test",

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
            "test.admin.operators[3].permissions[0]=MANAGE_APIS"
})
@AutoConfigureMockMvc(print = MockMvcPrint.NONE)
@org.springframework.context.annotation.Import(io.github.chenyilei2016.openplatform.testing.CatalogReferenceFixture.class)
class PublicationRollbackHttpTest {
    @Autowired MockMvc mvc;
    @Autowired org.springframework.core.env.ConfigurableEnvironment environment;
    @Autowired org.springframework.jdbc.core.JdbcTemplate database;

    @org.junit.jupiter.api.AfterEach
    void resetConfig() {
        environment.getPropertySources().remove("rollback-test");
    }

    private void auditEnabled(boolean enabled) {
        environment
                .getPropertySources()
                .addFirst(
                        new org.springframework.core.env.MapPropertySource(
                                "rollback-test",
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

    @Test
    void directRollbackKeepsDraftAndDisabledStateAndReturnsOriginalRetryResult() throws Exception {
        Fixture fixture = fixture();
        setEnabled(fixture.apiId(), false);
        JsonNode draftBefore = send(get("/admin-api/apis/" + fixture.apiId()));
        ObjectNode request = rollbackRequest(fixture.apiId(), fixture.first());
        JsonNode rollback = rollback(fixture.apiId(), request);
        assertThat(rollback.get("kind").asText()).isEqualTo("ROLLBACK");
        assertThat(rollback.get("sourceReleaseId")).isEqualTo(fixture.first().get("id"));
        assertThat(rollback.get("baselineReleaseId")).isEqualTo(fixture.second().get("id"));
        assertThat(rollback.get("baselineStateVersion").asLong()).isEqualTo(request.get("expectedStateVersion").asLong());
        assertThat(rollback.get("snapshot")).isEqualTo(fixture.first().get("snapshot"));
        assertThat(rollback.at("/snapshot/responseAdapter/successValues/0").asInt()).isEqualTo(200);
        assertThat(rollback.get("status").asText()).isEqualTo("APPLIED");
        assertThat(send(get("/admin-api/apis/" + fixture.apiId()))).isEqualTo(draftBefore);
        assertThat(state(fixture.apiId()).get("enabled").asBoolean()).isFalse();
        assertThat(rollback(fixture.apiId(), request).get("id")).isEqualTo(rollback.get("id"));
        assertThat(send(get(path(fixture.apiId()) + "/submissions/" + request.get("submissionKey").asText())).get("id"))
                .isEqualTo(rollback.get("id"));
        JsonNode page = send(get(path(fixture.apiId()) + "/releases").param("pageSize", "1"));
        assertThat(page.get("total").asLong()).isEqualTo(3);
        assertThat(page.at("/items/0/kind").asText()).isEqualTo("ROLLBACK");
        assertThat(page.at("/items/0/comment").asText()).isEqualTo("恢复已验证配置");
        assertThat(page.at("/items/0").has("snapshot")).isFalse();
        assertThat(send(get(path(fixture.apiId()) + "/releases").param("pageSize", "1").param("page", "2"))
                .at("/items/0/id")).isEqualTo(fixture.second().get("id"));
        for (String field : new String[]{"sourceReleaseId", "expectedLiveReleaseId", "comment", "expectedStateVersion"}) {
            ObjectNode changed = request.deepCopy();
            if (field.equals("expectedStateVersion")) changed.put(field, request.get(field).asLong() + 1);
            else changed.put(field, field.equals("comment") ? "其他原因" : UUID.randomUUID().toString());
            expectRollback(fixture.apiId(), changed, 409);
        }
        loginAs("publisher");
        expectRollback(fixture.apiId(), request, 409);
        login();
        JsonNode later = submit(fixture.apiId(), 3);
        assertThat(rollback(fixture.apiId(), request).get("id")).isEqualTo(rollback.get("id"));
        assertThat(state(fixture.apiId()).get("liveReleaseId")).isEqualTo(later.get("id"));
        assertThat(database.queryForObject("SELECT COUNT(*) FROM publication_audit WHERE api_id=? AND action='ROLLBACK' AND outcome='SUCCESS'",
                Integer.class, fixture.apiId())).isEqualTo(1);
    }

    @Test
    void rollbackUsesExistingReviewFlowAndPendingBlocksEveryNewSubmission() throws Exception {
        Fixture fixture = fixture();
        setEnabled(fixture.apiId(), false);
        auditEnabled(true);
        ObjectNode request = rollbackRequest(fixture.apiId(), fixture.first());
        JsonNode pending = rollback(fixture.apiId(), request);
        assertThat(pending.get("status").asText()).isEqualTo("PENDING");
        assertThat(state(fixture.apiId()).get("liveReleaseId")).isEqualTo(fixture.second().get("id"));
        expectRollback(fixture.apiId(), rollbackRequest(fixture.apiId(), fixture.first()), 409);
        mvc.perform(auth(post(path(fixture.apiId()) + "/submissions")
                .content(submission(fixture.apiId(), 3).toString()))).andExpect(status().isConflict());
        JsonNode applied = decision(pending, "approve");
        assertThat(applied.get("status").asText()).isEqualTo("APPLIED");
        assertThat(state(fixture.apiId()).get("enabled").asBoolean()).isFalse();
        assertThat(send(get("/admin-api/apis/" + fixture.apiId())).get("draftRevision").asLong()).isEqualTo(3);
        ObjectNode nextRequest = rollbackRequest(fixture.apiId(), fixture.second());
        JsonNode next = rollback(fixture.apiId(), nextRequest);
        auditEnabled(false);
        assertThat(decision(next, "reject").get("status").asText()).isEqualTo("REJECTED");
        assertThat(rollback(fixture.apiId(), nextRequest).get("status").asText()).isEqualTo("REJECTED");
        assertThat(state(fixture.apiId()).get("liveReleaseId")).isEqualTo(applied.get("id"));
        assertThat(state(fixture.apiId()).get("pendingReleaseId").isNull()).isTrue();
    }

    @Test
    void staleConfirmationAndSameRevisionDifferentReleaseCannotPassApproval() throws Exception {
        Fixture fixture = fixture();
        ObjectNode stale = rollbackRequest(fixture.apiId(), fixture.first());
        setEnabled(fixture.apiId(), false);
        expectRollback(fixture.apiId(), stale, 409);
        ObjectNode wrongLive = rollbackRequest(fixture.apiId(), fixture.first()).put("expectedLiveReleaseId", fixture.first().get("id").asText());
        expectRollback(fixture.apiId(), wrongLive, 409);
        // 同一修订可再次普通发布；审批必须比较发布ID，不能仅比较草稿修订。
        JsonNode third = submit(fixture.apiId(), 3);
        JsonNode fourth = submit(fixture.apiId(), 3);
        auditEnabled(true);
        JsonNode pending = rollback(fixture.apiId(), rollbackRequest(fixture.apiId(), fixture.first()));
        database.update("UPDATE publication_state SET live_release_id=? WHERE api_id=?", third.get("id").asText(), fixture.apiId());
        mvc.perform(auth(post("/admin-api/publications/" + pending.get("id").asText() + "/approve")
                .content("{\"comment\":\"基线变更\"}"))).andExpect(status().isConflict());
        database.update("UPDATE publication_state SET live_release_id=? WHERE api_id=?", fourth.get("id").asText(), fixture.apiId());
        setEnabled(fixture.apiId(), true);
        mvc.perform(auth(post("/admin-api/publications/" + pending.get("id").asText() + "/approve")
                .content("{\"comment\":\"状态已变更\"}"))).andExpect(status().isConflict());
        assertThat(send(get("/admin-api/publications/" + pending.get("id").asText())).get("status").asText()).isEqualTo("PENDING");
        decision(pending, "reject");
    }

    @Test
    void invalidSourcesAndScopesFailWithoutChangingLiveAndInvalidApprovalIsRecorded() throws Exception {
        Fixture fixture = fixture();
        Fixture other = fixture();
        expectRollback(fixture.apiId(), rollbackRequest(fixture.apiId(), other.first()), 400);
        expectRollback(fixture.apiId(), rollbackRequest(fixture.apiId(), fixture.second()), 409);
        expectRollback(fixture.apiId(), rollbackRequest(fixture.apiId(), fixture.first()).put("sourceReleaseId", UUID.randomUUID().toString()), 404);
        expectRollback(fixture.apiId(), rollbackRequest(fixture.apiId(), fixture.first()).put("comment", " "), 400);
        auditEnabled(true);
        JsonNode pending = rollback(fixture.apiId(), rollbackRequest(fixture.apiId(), fixture.first()));
        expectRollback(fixture.apiId(), rollbackRequest(fixture.apiId(), pending), 400);
        decision(pending, "reject");
        expectRollback(fixture.apiId(), rollbackRequest(fixture.apiId(), pending), 400);
        String scope = fixture.body().at("/scopeCodes/0").asText();
        database.update("UPDATE access_scope SET enabled=FALSE WHERE code=?", scope);
        expectRollback(fixture.apiId(), rollbackRequest(fixture.apiId(), fixture.first()), 400);
        database.update("UPDATE access_scope SET enabled=TRUE WHERE code=?", scope);
        ObjectNode request = rollbackRequest(fixture.apiId(), fixture.first());
        JsonNode invalid = rollback(fixture.apiId(), request);
        database.update("UPDATE access_scope SET enabled=FALSE WHERE code=?", scope);
        JsonNode failed = decision(invalid, "approve");
        assertThat(failed.get("status").asText()).isEqualTo("FAILED");
        assertThat(failed.get("failureReason").asText()).contains("权限组");
        assertThat(rollback(fixture.apiId(), request).get("status").asText()).isEqualTo("FAILED");
        assertThat(state(fixture.apiId()).get("liveReleaseId")).isEqualTo(fixture.second().get("id"));
        assertThat(state(fixture.apiId()).get("pendingReleaseId").isNull()).isTrue();
    }

    @Test
    void historicalConnectionRevisionIsKeptAndRevalidatedAtSubmissionAndApproval() throws Exception {
        Fixture fixture = fixture();
        String connectionId = UUID.randomUUID().toString();
        database.update("INSERT INTO dubbo_connection(id,name,environment_id,description,draft_revision,active_revision,enabled,state_version) VALUES(?,?,'rollback-test','',2,2,TRUE,1)",
                connectionId, "历史连接");
        String config = """
                {"registry":{"address":"nacos://registry.example:8848","group":"TEST"},"metadata":{"type":"NONE"},
                 "discoveryMode":"INTERFACE","providerMetadataMode":"LOCAL"}
                """;
        database.update("INSERT INTO dubbo_connection_revision(id,connection_id,revision,config_json,metadata_type,discovery_mode,provider_metadata_mode) VALUES(?,?,1,?,'NONE','INTERFACE','LOCAL')",
                connectionId + ":1", connectionId, config);
        // 模拟升级前已存在的固定历史快照，当前工作草稿继续使用HTTP。
        ObjectNode historical = (ObjectNode) fixture.first().get("snapshot").deepCopy();
        historical.put("protocol", "DUBBO");
        historical.set("binding", json.readTree("""
                {"protocol":"DUBBO","timeoutMillis":3000,"dubbo":{"interfaceName":"com.example.OrderService",
                 "method":"query","version":"1.0","group":"orders","parameterTypes":[],"connectionId":"%s","connectionRevision":1}}
                """.formatted(connectionId)));
        database.update("UPDATE publication_release SET snapshot_json=? WHERE id=?", historical.toString(), fixture.first().get("id").asText());
        auditEnabled(true);
        JsonNode pending = rollback(fixture.apiId(), rollbackRequest(fixture.apiId(), fixture.first()));
        assertThat(pending.at("/snapshot/binding/dubbo/connectionRevision").asLong()).isEqualTo(1);
        database.update("UPDATE dubbo_connection SET enabled=FALSE WHERE id=?", connectionId);
        assertThat(decision(pending, "approve").get("status").asText()).isEqualTo("FAILED");
        expectRollback(fixture.apiId(), rollbackRequest(fixture.apiId(), fixture.first()), 400);
        database.update("UPDATE dubbo_connection SET enabled=TRUE WHERE id=?", connectionId);
        database.update("DELETE FROM dubbo_connection_revision WHERE connection_id=? AND revision=1", connectionId);
        expectRollback(fixture.apiId(), rollbackRequest(fixture.apiId(), fixture.first()), 400);
        assertThat(state(fixture.apiId()).get("liveReleaseId")).isEqualTo(fixture.second().get("id"));
    }

    @Test
    void historicalLifecycleIsValidatedInsteadOfSilentlyChangingTheContract() throws Exception {
        Fixture fixture = fixture();
        ObjectNode historical = (ObjectNode) fixture.first().get("snapshot").deepCopy();
        historical.set("lifecycle", json.readTree("{\"status\":\"RETIRED\",\"compatibility\":\"UNSPECIFIED\",\"deprecationNotice\":\"\"}"));
        database.update("UPDATE publication_release SET snapshot_json=? WHERE id=?", historical.toString(), fixture.first().get("id").asText());
        expectRollback(fixture.apiId(), rollbackRequest(fixture.apiId(), fixture.first()), 400);
        assertThat(state(fixture.apiId()).get("liveReleaseId")).isEqualTo(fixture.second().get("id"));
    }

    @Test
    void rollbackRequiresPublishPermissionAndApprovalRequiresReviewPermission() throws Exception {
        Fixture fixture = fixture();
        auditEnabled(true);
        ObjectNode request = rollbackRequest(fixture.apiId(), fixture.first());
        loginAs("viewer");
        expectRollback(fixture.apiId(), request, 403);
        loginAs("reviewer");
        expectRollback(fixture.apiId(), request, 403);
        loginAs("publisher");
        JsonNode pending = rollback(fixture.apiId(), request);
        mvc.perform(auth(post("/admin-api/publications/" + pending.get("id").asText() + "/approve")
                .content("{\"comment\":\"越权\"}"))).andExpect(status().isForbidden());
        loginAs("reviewer");
        assertThat(decision(pending, "approve").get("status").asText()).isEqualTo("APPLIED");
    }

    @Test
    void httpMappingLocationsSurviveSavePublishAndFixedSnapshotRollback() throws Exception {
        auditEnabled(false);
        ObjectNode body = draft();
        body.set("binding", json.readTree("""
            {"protocol":"HTTP","timeoutMillis":3000,"http":{"url":"https://internal.example/orders/{id}","method":"POST"}}
            """));
        body.set("mappings", json.readTree("""
            [{"target":"id","source":"REQUEST","path":"orderId","value":null,"location":"PATH"},
             {"target":"id","source":"FIXED","path":null,"value":"query-value","location":"QUERY"},
             {"target":"id","source":"FIXED","path":null,"value":"body-value","location":"BODY"}]
            """));
        String apiId = send(post("/admin-api/apis").content(body.toString())).get("id").asText();
        assertThat(send(get("/admin-api/apis/" + apiId)).get("mappings")).isEqualTo(body.get("mappings"));
        JsonNode first = submit(apiId, 1);
        body.put("expectedRevision", 1).put("name", "第二版");
        ((ObjectNode) body.withArray("mappings").get(1)).put("value", "changed-query");
        send(put("/admin-api/apis/" + apiId).content(body.toString()));
        JsonNode second = submit(apiId, 2);
        JsonNode restored = rollback(apiId, rollbackRequest(apiId, first));
        assertThat(restored.get("snapshot")).isEqualTo(first.get("snapshot"));
        assertThat(restored.at("/snapshot/mappings/0/location").asText()).isEqualTo("PATH");
        assertThat(restored.at("/snapshot/mappings/1/value").asText()).isEqualTo("query-value");
        assertThat(restored.at("/snapshot/mappings/2/location").asText()).isEqualTo("BODY");
        assertThat(send(get("/admin-api/apis/" + apiId)).at("/mappings/1/value").asText()).isEqualTo("changed-query");
        assertThat(second.at("/snapshot/mappings/1/value").asText()).isEqualTo("changed-query");
    }

    private record Fixture(String apiId, ObjectNode body, JsonNode first, JsonNode second) {}

    private Fixture fixture() throws Exception {
        auditEnabled(false);
        ObjectNode body = draft();
        body.set("responseAdapter", json.readTree("{\"mode\":\"ENVELOPE\",\"successPath\":\"code\",\"successValues\":[200],\"dataPath\":\"data\"}"));
        String apiId = send(post("/admin-api/apis").content(body.toString())).get("id").asText();
        JsonNode first = submit(apiId, 1);
        body.put("expectedRevision", 1).put("name", "第二次生效");
        ((ObjectNode) body.get("responseAdapter")).putArray("successValues").add(0);
        send(put("/admin-api/apis/" + apiId).content(body.toString()));
        JsonNode second = submit(apiId, 2);
        body.put("expectedRevision", 2).put("name", "未发布工作草稿");
        send(put("/admin-api/apis/" + apiId).content(body.toString()));
        return new Fixture(apiId, body, first, second);
    }

    private String path(String apiId) { return "/admin-api/publications/apis/" + apiId; }

    private JsonNode state(String apiId) throws Exception { return send(get(path(apiId) + "/state")); }

    private ObjectNode rollbackRequest(String apiId, JsonNode source) throws Exception {
        JsonNode state = state(apiId);
        return json.createObjectNode().put("sourceReleaseId", source.get("id").asText())
                .put("expectedLiveReleaseId", state.get("liveReleaseId").asText())
                .put("expectedStateVersion", state.get("stateVersion").asLong())
                .put("submissionKey", UUID.randomUUID().toString()).put("comment", "恢复已验证配置");
    }

    private JsonNode rollback(String apiId, ObjectNode request) throws Exception {
        return send(post(path(apiId) + "/rollbacks").content(request.toString()));
    }

    private void expectRollback(String apiId, ObjectNode request, int expectedStatus) throws Exception {
        mvc.perform(auth(post(path(apiId) + "/rollbacks").content(request.toString())))
                .andExpect(status().is(expectedStatus));
    }

    private JsonNode decision(JsonNode release, String decision) throws Exception {
        return send(post("/admin-api/publications/" + release.get("id").asText() + "/" + decision).content("{\"comment\":\"已核对\"}"));
    }

    private ObjectNode submission(String apiId, long revision) throws Exception {
        return json.createObjectNode().put("expectedDraftRevision", revision)
                .put("expectedStateVersion", state(apiId).get("stateVersion").asLong())
                .put("submissionKey", UUID.randomUUID().toString()).put("comment", "上线");
    }

    private JsonNode submit(String apiId, long revision) throws Exception {
        return send(post(path(apiId) + "/submissions").content(submission(apiId, revision).toString()));
    }

    private void setEnabled(String apiId, boolean enabled) throws Exception {
        send(put(path(apiId) + "/status").content(json.createObjectNode().put("enabled", enabled)
                .put("expectedStateVersion", state(apiId).get("stateVersion").asLong()).put("reason", "独立开关").toString()));
    }

    private void loginAs(String employeeNo) {
        TestAccount user = new TestAccount();
        user.setId(12L);
        user.setTenantId("tenant-1");
        user.setEmployeeNoStr(employeeNo);
        when(identityService.current("test-session")).thenAnswer(invocation -> user.toAccount());
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
        org.springframework.mock.web.MockHttpServletResponse response = mvc.perform(auth(r)).andReturn().getResponse();
        assertThat(response.getStatus())
                .as("HTTP response: %s", response.getContentAsString())
                .isEqualTo(200);
        return json.readTree(response.getContentAsString()).get("data");
    }
}
