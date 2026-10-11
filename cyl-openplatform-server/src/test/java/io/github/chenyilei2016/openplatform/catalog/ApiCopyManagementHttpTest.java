package io.github.chenyilei2016.openplatform.catalog;


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

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@io.github.chenyilei2016.openplatform.testing.TestAdministrators
@org.springframework.context.annotation.Import(io.github.chenyilei2016.openplatform.testing.CatalogReferenceFixture.class)
@SpringBootTest(properties = {
        "spring.sql.init.schema-locations=classpath:db/access-schema.sql,classpath:db/mcp-schema.sql,classpath:db/catalog-schema.sql,classpath:db/api-copy-schema.sql,classpath:db/dubbo-connection-schema.sql,classpath:db/token-schema.sql,classpath:db/publication-schema.sql,classpath:db/governance-schema.sql,classpath:db/observability-schema.sql,classpath:db/operations-metrics-schema.sql",

        "test.admin.operators[0].tenant-id=tenant-1",
        "test.admin.operators[0].employee-no=operator-1",
        "test.admin.operators[0].permissions[0]=MANAGE_APIS",
        "test.admin.operators[0].permissions[1]=MANAGE_APPLICATIONS",
        "test.admin.operators[0].permissions[2]=PUBLISH_APIS",
        "open-platform.publish.audit.enabled=false",
        "test.admin.operators[1].tenant-id=tenant-1",
        "test.admin.operators[1].employee-no=author",
        "test.admin.operators[1].permissions[0]=MANAGE_APIS",
        "test.admin.operators[2].tenant-id=tenant-1",
        "test.admin.operators[2].employee-no=viewer",
        "test.admin.operators[2].permissions[0]=VIEW_AUDIT"
})
@AutoConfigureMockMvc(print = MockMvcPrint.NONE)
class ApiCopyManagementHttpTest {
    @Autowired MockMvc mvc;
    @Autowired org.springframework.jdbc.core.JdbcTemplate database;
    @Autowired io.github.chenyilei2016.openplatform.application.catalog.ApiCatalogService catalog;
    @Autowired org.springframework.transaction.PlatformTransactionManager transactions;
    @org.springframework.test.context.bean.override.mockito.MockitoSpyBean
    io.github.chenyilei2016.openplatform.infrastructure.catalog.dal.mapper.ApiRevisionMapper revisions;
    @MockitoBean AccountAuthentication identityService;
    private final JsonMapper json = JsonMapper.builder().enable(tools.jackson.databind.DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS).build();

    @BeforeEach
    void login() {
        TestAccount user = new TestAccount();
        user.setId(9007199254740993L);
        user.setTenantId("tenant-1");
        user.setEmployeeNoStr("operator-1");
        when(identityService.current("test-session")).thenAnswer(invocation -> user.toAccount());
    }

    @Test
    void previewDoesNotWriteAndClearsOnlySensitiveValues() throws Exception {
        ObjectNode source = draft();
        ((ObjectNode) source.at("/binding/http")).put("url", "https://internal.example/orders?region=cn&access_token=private-query");
        ObjectNode fields = (ObjectNode) source.at("/requestSchema/properties");
        fields.putObject("password").put("type", "STRING").put("defaultValue", "private-default").put("example", "private-example");
        fields.putObject("amount").put("type", "NUMBER").put("defaultValue", new java.math.BigDecimal("123.1234567890123456789"));
        ((tools.jackson.databind.node.ArrayNode) source.get("mappings")).addObject().put("target", "payload").put("source", "FIXED")
                .putObject("value").put("secret", "private-fixed").put("country", "CN").put("id", new java.math.BigInteger("9007199254740993"));
        source.set("lifecycle", json.readTree("{\"status\":\"DEPRECATED\",\"compatibility\":\"UNSPECIFIED\",\"deprecationNotice\":\"旧接口\",\"replacementVersion\":\"v2\"}"));
        String id = send(post("/admin-api/apis").content(source.toString())).get("id").asText();
        Long drafts = count("catalog_api_draft");
        Long histories = count("catalog_api_revision");
        Long audits = count("catalog_audit");
        Long requests = count("catalog_api_copy_request");
        JsonNode preview = preview(id, "DRAFT");
        assertThat(count("catalog_api_draft")).isEqualTo(drafts);
        assertThat(count("catalog_api_revision")).isEqualTo(histories);
        assertThat(count("catalog_audit")).isEqualTo(audits);
        assertThat(count("catalog_api_copy_request")).isEqualTo(requests);
        assertThat(preview.toString()).doesNotContain("private-query", "private-default", "private-example", "private-fixed");
        assertThat(preview.at("/snapshot/binding/http/url").asText()).isEqualTo("https://internal.example/orders?region=cn");
        assertThat(preview.at("/snapshot/requestSchema/properties/orderId/example").asText()).isEqualTo("order-001");
        assertThat(preview.at("/snapshot/requestSchema/properties/amount/defaultValue").decimalValue()).isEqualByComparingTo("123.1234567890123456789");
        assertThat(preview.at("/snapshot/mappings/1/value/country").asText()).isEqualTo("CN");
        assertThat(preview.at("/snapshot/mappings/1/value/id").asText()).isEqualTo("9007199254740993");
        assertThat(preview.at("/snapshot/lifecycle/status").asText()).isEqualTo("ACTIVE");
        assertThat(preview.at("/snapshot/owner").asText()).matches("EMP_[0-9a-f]{32}");
        assertThat(preview.at("/snapshot/lifecycle/replacementVersion").isNull()).isTrue();
        assertThat(preview.get("warnings").size()).isPositive();
    }

    @Test
    void sameCommandReturnsOriginalResultAndOtherOperatorCannotReadIt() throws Exception {
        ObjectNode body = draft();
        ((ObjectNode) body.at("/binding/http")).put("sourceClass", "com.example.CopySearch").put("sourceMethod", "lookup");
        body.set("responseAdapter", json.readTree("{\"mode\":\"ENVELOPE\",\"successPath\":\"code\",\"successValues\":[200],\"dataPath\":\"data\"}"));
        String source = send(post("/admin-api/apis").content(body.toString())).get("id").asText();
        ObjectNode command = command(preview(source, "DRAFT"));
        JsonNode created = send(post("/admin-api/api-copies").content(command.toString()));
        String id = created.get("id").asText();
        assertThat(id).matches("API_[0-9a-f]{32}");
        assertThat(id).isNotEqualTo(source);
        assertThat(created.get("draftRevision").asLong()).isEqualTo(1);
        assertThat(created.at("/responseAdapter/successValues/0").asInt()).isEqualTo(200);
        JsonNode matches = send(get("/admin-api/apis").param("query", body.path("service").asText())
                .param("internalClass", "com.example.CopySearch").param("internalMatch", "EXACT").param("internalMethod", "lookup"));
        assertThat(matches.path("total").asInt()).isEqualTo(2);
        assertThat(matches.path("items").toString()).contains(id, source);
        assertThat(send(post("/admin-api/api-copies").content(command.toString()))).isEqualTo(created);
        assertThat(send(get("/admin-api/api-copies/requests/" + command.get("creationKey").asText()))).isEqualTo(created);
        assertThat(database.queryForObject("SELECT COUNT(*) FROM catalog_audit WHERE api_id=? AND action='COPY_API_DRAFT'", Long.class, id)).isEqualTo(1);
        assertThat(database.queryForObject("SELECT COUNT(*) FROM catalog_api_revision WHERE api_id=?", Long.class, id)).isEqualTo(1);
        ObjectNode edit = ((ObjectNode) command.get("definition")).deepCopy();
        edit.put("expectedRevision", 1).put("name", "创建后的修改");
        send(put("/admin-api/apis/" + id).content(edit.toString()));
        assertThat(send(get("/admin-api/api-copies/requests/" + command.get("creationKey").asText()))).isEqualTo(created);
        ((ObjectNode) command.get("definition")).put("name", "同键不同内容");
        mvc.perform(auth(post("/admin-api/api-copies").content(command.toString()))).andExpect(status().isConflict());
        TestAccount other = new TestAccount(); other.setId(13L); other.setTenantId("tenant-1"); other.setEmployeeNoStr("author");
        when(identityService.current("test-session")).thenAnswer(invocation -> other.toAccount());
        mvc.perform(auth(get("/admin-api/api-copies/requests/" + command.get("creationKey").asText()))).andExpect(status().isNotFound());
        other.setEmployeeNoStr("viewer");
        mvc.perform(auth(post("/admin-api/api-copies/preview").content("{\"sourceApiId\":\"" + source + "\",\"sourceKind\":\"DRAFT\"}"))).andExpect(status().isForbidden());
    }

    @Test
    void identityConflictAndInvalidScopeRollBackReservationAndSourceDriftConflicts() throws Exception {
        ObjectNode source = draft();
        String id = send(post("/admin-api/apis").content(source.toString())).get("id").asText();
        ObjectNode command = command(preview(id, "DRAFT"));
        ObjectNode definition = (ObjectNode) command.get("definition");
        definition.put("method", source.get("method").asText());
        mvc.perform(auth(post("/admin-api/api-copies").content(command.toString()))).andExpect(status().isBadRequest());
        definition.put("method", "another");
        send(post("/admin-api/apis").content(definition.toString()));
        mvc.perform(auth(post("/admin-api/api-copies").content(command.toString()))).andExpect(status().isConflict());
        assertThat(database.queryForObject("SELECT COUNT(*) FROM catalog_api_copy_request WHERE creation_key=?", Long.class, command.get("creationKey").asText())).isZero();
        definition.put("method", "third").putArray("scopeCodes").add("missing_scope");
        mvc.perform(auth(post("/admin-api/api-copies").content(command.toString()))).andExpect(status().isBadRequest());
        definition.putArray("scopeCodes");
        source.put("expectedRevision", 1).put("name", "已更新来源");
        send(put("/admin-api/apis/" + id).content(source.toString()));
        mvc.perform(auth(post("/admin-api/api-copies").content(command.toString()))).andExpect(status().isConflict());
        assertThat(database.queryForObject("SELECT COUNT(*) FROM catalog_api_copy_request WHERE creation_key=?", Long.class, command.get("creationKey").asText())).isZero();
    }

    @Test
    void effectiveSourceUsesPublishedSnapshotAndStrictCopyTypes() throws Exception {
        ObjectNode source = draft();
        String scope = "copy_" + UUID.randomUUID().toString().replace("-", "");
        ObjectNode scopeBody = json.createObjectNode().put("code", scope).put("name", "复制生效版本测试组")
                .put("enabled", true).put("defaultForNewApplication", false);
        send(post("/admin-api/scopes").content(scopeBody.toString()));
        source.putArray("scopeCodes").add(scope);
        String id = send(post("/admin-api/apis").content(source.toString())).get("id").asText();
        JsonNode release = send(post("/admin-api/publications/apis/" + id + "/submissions").content("{\"expectedDraftRevision\":1,\"expectedStateVersion\":0,\"submissionKey\":\"" + UUID.randomUUID() + "\",\"comment\":\"复制测试发布\"}"));
        source.put("expectedRevision", 1).put("name", "尚未发布的工作草稿");
        send(put("/admin-api/apis/" + id).content(source.toString()));
        JsonNode preview = preview(id, "EFFECTIVE");
        assertThat(preview.at("/snapshot/name").asText()).isEqualTo("订单查询");
        assertThat(preview.get("sourceRevision").asLong()).isEqualTo(1);
        assertThat(preview.get("sourceReleaseId").asText()).isEqualTo(release.get("id").asText());
        ObjectNode command = command(preview);
        ObjectNode definition = (ObjectNode) command.get("definition");
        definition.put("name", 123);
        mvc.perform(auth(post("/admin-api/api-copies").content(command.toString()))).andExpect(status().isBadRequest());
        definition.put("name", "复制生效版本");
        assertThat(send(post("/admin-api/api-copies").content(command.toString())).get("name").asText()).isEqualTo("复制生效版本");
    }

    @Test
    void directCopyCannotBypassSensitiveValueBoundary() throws Exception {
        String source = send(post("/admin-api/apis").content(draft().toString())).get("id").asText();
        ObjectNode command = command(preview(source, "DRAFT"));
        ((ObjectNode) command.at("/definition/binding/http")).put("url", "https://internal.example/?access_token=must-not-copy");
        mvc.perform(auth(post("/admin-api/api-copies").content(command.toString()))).andExpect(status().isBadRequest());
        assertThat(database.queryForObject("SELECT COUNT(*) FROM catalog_api_copy_request WHERE creation_key=?", Long.class, command.get("creationKey").asText())).isZero();
    }

    @Test
    void historyWriteFailureRollsBackDraftAuditAndCopyReceipt() throws Exception {
        String source = send(post("/admin-api/apis").content(draft().toString())).get("id").asText();
        ObjectNode command = command(preview(source, "DRAFT"));
        Long drafts = count("catalog_api_draft");
        Long history = count("catalog_api_revision");
        Long audits = count("catalog_audit");
        org.mockito.Mockito.doThrow(new org.springframework.dao.DataIntegrityViolationException("test history write failure"))
                .when(revisions).insertAll(org.mockito.ArgumentMatchers.anyList());
        mvc.perform(auth(post("/admin-api/api-copies").content(command.toString()))).andExpect(status().is5xxServerError());
        assertThat(count("catalog_api_draft")).isEqualTo(drafts);
        assertThat(count("catalog_api_revision")).isEqualTo(history);
        assertThat(count("catalog_audit")).isEqualTo(audits);
        assertThat(database.queryForObject("SELECT COUNT(*) FROM catalog_api_copy_request WHERE creation_key=?", Long.class, command.get("creationKey").asText())).isZero();
    }

    @Test
    void concurrentSameKeyCreatesExactlyOneDraft() throws Exception {
        String source = send(post("/admin-api/apis").content(draft().toString())).get("id").asText();
        ObjectNode command = command(preview(source, "DRAFT"));
        String body = command.toString();
        try (java.util.concurrent.ExecutorService workers = java.util.concurrent.Executors.newFixedThreadPool(2)) {
            java.util.concurrent.Callable<JsonNode> save = () -> send(post("/admin-api/api-copies").content(body));
            java.util.List<java.util.concurrent.Future<JsonNode>> results = workers.invokeAll(java.util.List.of(save, save));
            JsonNode first = results.get(0).get(10, java.util.concurrent.TimeUnit.SECONDS);
            assertThat(results.get(1).get(10, java.util.concurrent.TimeUnit.SECONDS)).isEqualTo(first);
            assertThat(database.queryForObject("SELECT COUNT(*) FROM catalog_audit WHERE api_id=?", Long.class, first.get("id").asText())).isEqualTo(1);
            assertThat(database.queryForObject("SELECT COUNT(*) FROM catalog_api_copy_request WHERE creation_key=?", Long.class, command.get("creationKey").asText())).isEqualTo(1);
        }
    }

    @Test
    void copyKeepsPathTemplateAndFixedQueryLocationWhileRemovingSecrets() throws Exception {
        ObjectNode source = draft();
        ((ObjectNode) source.at("/binding/http")).put("url", "https://internal.example/orders/{id}?region=cn&token=private-query");
        source.set("mappings", json.readTree("""
            [{"target":"id","source":"REQUEST","path":"orderId","location":"PATH"},
             {"target":"view","source":"FIXED","value":"detail","location":"QUERY"}]
            """));
        String id = send(post("/admin-api/apis").content(source.toString())).get("id").asText();
        JsonNode exported = send(get("/admin-api/api-imports/exports/" + id).param("revision", "1"));
        assertThat(exported.at("/apis/0/binding/http/url").asText()).isEqualTo("https://internal.example/orders/{id}?region=cn");
        assertThat(exported.at("/apis/0/mappings/1/location").asText()).isEqualTo("QUERY");
        JsonNode preview = preview(id, "DRAFT");
        assertThat(preview.at("/snapshot/binding/http/url").asText()).isEqualTo("https://internal.example/orders/{id}?region=cn");
        assertThat(preview.at("/snapshot/mappings/1/location").asText()).isEqualTo("QUERY");
        JsonNode created = send(post("/admin-api/api-copies").content(command(preview).toString()));
        assertThat(created.at("/binding/http/url")).isEqualTo(preview.at("/snapshot/binding/http/url"));
        assertThat(created.at("/mappings/1/location").asText()).isEqualTo("QUERY");
        assertThat(created.toString()).doesNotContain("private-query");
    }

    private Long count(String table) { return database.queryForObject("SELECT COUNT(*) FROM " + table, Long.class); }
    private JsonNode preview(String id, String kind) throws Exception {
        return send(post("/admin-api/api-copies/preview").content("{\"sourceApiId\":\"" + id + "\",\"sourceKind\":\"" + kind + "\"}"));
    }
    private ObjectNode command(JsonNode preview) {
        ObjectNode command = json.createObjectNode().put("creationKey", UUID.randomUUID().toString())
                .put("sourceApiId", preview.get("sourceApiId").asText()).put("sourceKind", preview.get("sourceKind").asText())
                .put("sourceRevision", preview.get("sourceRevision").asLong());
        command.set("sourceReleaseId", preview.get("sourceReleaseId"));
        ObjectNode definition = ((ObjectNode) preview.get("snapshot")).deepCopy();
        definition.remove(java.util.List.of("id", "protocol", "draftRevision"));
        definition.put("method", "copy_" + UUID.randomUUID().toString().replace("-", ""));
        command.set("definition", definition);
        return command;
    }

    private ObjectNode draft() {
        return (ObjectNode) json.readTree(definition("orders_" + UUID.randomUUID().toString().replace("-", "")));
    }

    private String definition(String service) {
        return """
                {"service":"%s","version":"v1","method":"query","name":"订单查询","category":"订单","owner":"研发",
                 "scopeCodes":[],
                 "requestSchema":{"type":"OBJECT","required":true,"properties":{"orderId":{"type":"STRING","required":true,"example":"order-001"}}},
                 "responseSchema":{"type":"OBJECT","properties":{"orderId":{"type":"STRING","example":"order-001"}}},
                 "errorDefinitions":[{"code":"ORDER_NOT_FOUND","message":"订单不存在"}],
                 "binding":{"protocol":"HTTP","timeoutMillis":3000,"http":{"url":"https://internal.example/orders/query","method":"POST"}},
                 "mappings":[{"target":"orderId","source":"REQUEST","path":"orderId"}]}
                """.formatted(service);
    }

    private MockHttpServletRequestBuilder auth(MockHttpServletRequestBuilder request) {
        return request.session(io.github.chenyilei2016.openplatform.testing.TestSessions.session("test-session"))
                .header("X-CSRF-Token", "76832d7fdbcdbf4a72129f8b7def9016")
                .contentType("application/json");
    }

    private JsonNode send(MockHttpServletRequestBuilder request) throws Exception {
        org.springframework.test.web.servlet.MvcResult result = mvc.perform(auth(request)).andReturn();
        assertThat(result.getResponse().getStatus()).as("HTTP响应: %s; 异常: %s",
                result.getResponse().getContentAsString(), result.getResolvedException()).isEqualTo(200);
        return json.readTree(result.getResponse().getContentAsString()).get("data");
    }
}
