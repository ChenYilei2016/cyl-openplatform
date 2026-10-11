package io.github.chenyilei2016.openplatform.catalog;

import io.github.chenyilei2016.openplatform.domain.access.AccessOperator;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiDefinition;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiOperationKind;
import io.github.chenyilei2016.openplatform.domain.catalog.McpToolConfig;

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

import java.util.List;
import java.util.UUID;
import java.util.stream.StreamSupport;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;

/** 119：调用性质、幂等字段与MCP工具配置的默认值、启用条件、工具名冲突、列表筛选，以及各写入路径的保留。 */
@io.github.chenyilei2016.openplatform.testing.TestAdministrators
@org.springframework.context.annotation.Import(io.github.chenyilei2016.openplatform.testing.CatalogReferenceFixture.class)
@SpringBootTest(properties = {
        "spring.sql.init.schema-locations=classpath:db/h2-functions.sql,classpath:db/access-schema.sql,classpath:db/catalog-schema.sql,classpath:db/api-copy-schema.sql,classpath:db/dubbo-connection-schema.sql,classpath:db/token-schema.sql,classpath:db/publication-schema.sql,classpath:db/governance-schema.sql,classpath:db/observability-schema.sql,classpath:db/operations-metrics-schema.sql,classpath:db/administrator-schema.sql",

        "open-platform.publish.audit.enabled=false",
        "test.admin.operators[0].tenant-id=tenant-1",
        "test.admin.operators[0].employee-no=operator-1",
        "test.admin.operators[0].permissions[0]=MANAGE_APIS",
        "test.admin.operators[0].permissions[1]=MANAGE_APPLICATIONS",
        "test.admin.operators[0].permissions[2]=PUBLISH_APIS"
})
@AutoConfigureMockMvc(print = MockMvcPrint.NONE)
class ApiMcpConfigHttpTest {
    private static final AccessOperator OPERATOR = new AccessOperator("tenant-1", "operator-1", "mcp-config-test", null, null);
    @Autowired MockMvc mvc;
    @Autowired org.springframework.jdbc.core.JdbcTemplate database;
    @Autowired io.github.chenyilei2016.openplatform.application.publication.PublicationService publications;
    @MockitoBean AccountAuthentication identityService;
    private final JsonMapper json = JsonMapper.builder().build();

    @BeforeEach
    void login() {
        TestAccount user = new TestAccount();
        user.setId(9007199254740993L);
        user.setTenantId("tenant-1");
        user.setEmployeeNoStr("operator-1");
        when(identityService.current("test-session")).thenAnswer(invocation -> user.toAccount());
    }

    @Test
    void legacyDefinitionsReadAsMutationWithoutIdempotencyOrMcpTool() throws Exception {
        JsonNode created = send(post("/admin-api/apis").content(draft("v1").toString()));
        assertThat(created.get("operationKind").asText()).isEqualTo("MUTATION");
        assertThat(created.get("idempotencyField").isNull()).isTrue();
        assertThat(created.get("mcpTool")).isEqualTo(json.readTree("{\"enabled\":false,\"aiDescription\":null}"));
        String id = created.get("id").asText();
        ObjectNode stored = (ObjectNode) json.readTree(database.queryForObject(
                "SELECT definition_json FROM catalog_api_draft WHERE id=?", String.class, id));
        stored.remove(List.of("operationKind", "idempotencyField", "mcpTool"));
        database.update("UPDATE catalog_api_draft SET definition_json=? WHERE id=?", stored.toString(), id);
        assertThat(send(get("/admin-api/apis/" + id))).isEqualTo(created);
    }

    @Test
    void enablementRulesRejectEachBranchAtTheFieldPath() throws Exception {
        ObjectNode mutation = mcp(draft("v1"), null);
        assertThat(issues(mutation)).containsExactly("/idempotencyField");
        assertThat(send(post("/admin-api/apis/validate").content(mutation.put("idempotencyField", "order.orderNo").toString()))
                .path("valid").asBoolean()).isTrue();
        assertThat(issues(mutation.deepCopy().put("idempotencyField", "order"))).containsExactly("/idempotencyField");
        assertThat(issues(mutation.deepCopy().put("idempotencyField", "order.paid"))).containsExactly("/idempotencyField");
        assertThat(issues(mutation.deepCopy().put("idempotencyField", "order.missing"))).containsExactly("/idempotencyField");
        assertThat(issues(mutation.deepCopy().put("idempotencyField", "a.b.c.d.e.f.g.h.i"))).containsExactly("/idempotencyField");
        assertThat(issues(mcp(draft("v1"), null).put("operationKind", "QUERY").put("idempotencyField", "count"))).isEmpty();

        ObjectNode query = mcp(draft("v1"), null).put("operationKind", "QUERY").put("description", "说".repeat(256));
        assertThat(issues(query)).containsExactly("/mcpTool/aiDescription");
        assertThat(issues(query.deepCopy().put("description", ""))).containsExactly("/mcpTool/aiDescription");
        assertThat(issues(mcp(query.deepCopy(), "用途"))).isEmpty();
        assertThat(issues(mcp(query.deepCopy(), "用".repeat(256)))).containsExactly("/mcpTool/aiDescription");

        ObjectNode longName = mcp(draft("v1"), "查询").put("operationKind", "QUERY")
                .put("service", "mcp_" + "s".repeat(40)).put("method", "m".repeat(30));
        assertThat(issues(longName)).containsExactly("/mcpTool/enabled");
        String rejected = mvc.perform(auth(post("/admin-api/apis").content(longName.toString()))).andReturn().getResponse().getContentAsString();
        assertThat(json.readTree(rejected).at("/data/fieldIssues/0/path").asText()).isEqualTo("/mcpTool/enabled");
    }

    @Test
    void normalizedToolNameConflictsAreRejectedAndListFiltersByMcpTool() throws Exception {
        String service = service();
        ObjectNode first = mcp(draft(service, "1.0"), "按订单号查询订单").put("operationKind", "QUERY");
        String firstId = send(post("/admin-api/apis").content(first.toString())).get("id").asText();
        ObjectNode second = draft(service, "1_0");
        String secondId = send(post("/admin-api/apis").content(second.toString())).get("id").asText();
        ObjectNode enabling = mcp(second, "按订单号查询订单").put("operationKind", "QUERY").put("expectedRevision", 1);
        assertThat(issues(enabling, "/admin-api/apis/" + secondId + "/validate")).containsExactly("/mcpTool/enabled");
        String rejected = mvc.perform(auth(put("/admin-api/apis/" + secondId).content(enabling.toString()))).andReturn().getResponse().getContentAsString();
        assertThat(json.readTree(rejected).at("/data/fieldIssues/0/path").asText()).isEqualTo("/mcpTool/enabled");
        assertThat(json.readTree(rejected).at("/data/fieldIssues/0/message").asText()).contains(service + "_query_1_0");
        ObjectNode third = mcp(draft(service, "1-0"), "按订单号查询订单").put("operationKind", "QUERY");
        mvc.perform(auth(post("/admin-api/apis").content(third.toString())))
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.status().isBadRequest());

        JsonNode enabled = send(get("/admin-api/apis").param("query", service).param("mcpTool", "ENABLED"));
        assertThat(enabled.path("total").asInt()).isEqualTo(1);
        assertThat(enabled.at("/items/0/id").asText()).isEqualTo(firstId);
        assertThat(enabled.at("/items/0/mcpToolEnabled").asBoolean()).isTrue();
        JsonNode disabled = send(get("/admin-api/apis").param("query", service).param("mcpTool", "DISABLED"));
        assertThat(disabled.path("total").asInt()).isEqualTo(1);
        assertThat(disabled.at("/items/0/id").asText()).isEqualTo(secondId);
        assertThat(send(get("/admin-api/apis").param("query", service).param("mcpTool", "ENABLED").param("mcpTool", "DISABLED"))
                .path("total").asInt()).isEqualTo(2);
        ObjectNode turnedOff = first.deepCopy().put("expectedRevision", 1);
        turnedOff.putObject("mcpTool").put("enabled", false).put("aiDescription", "按订单号查询订单");
        send(put("/admin-api/apis/" + firstId).content(turnedOff.toString()));
        assertThat(send(get("/admin-api/apis").param("query", service).param("mcpTool", "ENABLED")).path("total").asInt()).isZero();
    }

    @Test
    void differentServiceMethodCombinationsCannotExposeTheSameToolName() throws Exception {
        String prefix = service();
        ObjectNode first = mcp(draft(prefix + "_query", "1"), "查询").put("operationKind", "QUERY");
        send(post("/admin-api/apis").content(first.toString()));
        ObjectNode second = mcp(draft(prefix, "1"), "查询").put("method", "query_query").put("operationKind", "QUERY");
        mvc.perform(auth(post("/admin-api/apis").content(second.toString())))
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.status().isBadRequest())
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath("$.data.fieldIssues[0].path").value("/mcpTool/enabled"));
    }

    @Test
    void fieldsSurviveSaveRestorePublishCopyExportAndImport() throws Exception {
        String scope = "mcp_" + UUID.randomUUID().toString().replace("-", "").substring(0, 12);
        send(post("/admin-api/scopes").content("{\"code\":\"" + scope + "\",\"name\":\"MCP配置\",\"enabled\":true,\"defaultForNewApplication\":false}"));
        ObjectNode body = mcp(draft("v1"), "为AI提交订单").put("idempotencyField", "order.orderNo");
        body.putArray("scopeCodes").add(scope);
        JsonNode created = send(post("/admin-api/apis").content(body.toString()));
        String id = created.get("id").asText();
        assertConfigured(created);

        ObjectNode omitted = body.deepCopy().put("expectedRevision", 1);
        omitted.remove("mcpTool");
        String rejected = mvc.perform(auth(put("/admin-api/apis/" + id).content(omitted.toString()))).andReturn().getResponse().getContentAsString();
        assertThat(json.readTree(rejected).at("/data/fieldIssues/0/path").asText()).isEqualTo("/mcpTool");
        ObjectNode cleared = body.deepCopy().put("expectedRevision", 1).put("operationKind", "QUERY").put("idempotencyField", "");
        cleared.putObject("mcpTool").put("enabled", false);
        JsonNode saved = send(put("/admin-api/apis/" + id).content(cleared.toString()));
        assertThat(saved.get("changed").asBoolean()).isTrue();
        assertThat(saved.get("idempotencyField").isNull()).isTrue();
        assertThat(saved.at("/mcpTool/enabled").asBoolean()).isFalse();
        assertThat(send(get("/admin-api/apis/" + id + "/revisions/1")).get("snapshot")).isEqualTo(created);

        send(post("/admin-api/apis/" + id + "/revisions/1/restore").content("{\"expectedRevision\":2}"));
        JsonNode restored = send(get("/admin-api/apis/" + id));
        assertConfigured(restored);

        var release = publications.submit(id, 3, 0, UUID.randomUUID().toString(), "发布MCP配置", OPERATOR);
        assertConfigured(publications.find(release.id()).snapshot());
        assertConfigured(publications.effective(id).snapshot());

        JsonNode preview = send(post("/admin-api/api-copies/preview").content("{\"sourceApiId\":\"" + id + "\",\"sourceKind\":\"EFFECTIVE\"}"));
        assertConfigured(preview.get("snapshot"));
        JsonNode copied = send(post("/admin-api/api-copies").content(copyCommand(preview).toString()));
        assertConfigured(copied);

        JsonNode exported = send(get("/admin-api/api-imports/exports/" + id).param("revision", "3"));
        assertConfigured(exported.at("/apis/0"));
        ((ObjectNode) exported.at("/apis/0")).put("method", "imported");
        JsonNode importPreview = send(post("/admin-api/api-imports/preview").content(exported.toString()));
        assertConfigured(importPreview.at("/items/0/after"));
        ObjectNode confirmation = json.createObjectNode().put("documentDigest", importPreview.get("documentDigest").asText());
        confirmation.set("document", exported);
        confirmation.putArray("selections").addObject().put("index", 0).put("expectedRevision", 0);
        JsonNode imported = send(post("/admin-api/api-imports/confirm").content(confirmation.toString()));
        assertConfigured(send(get("/admin-api/apis/" + imported.at("/items/0/apiId").asText())));
    }

    private void assertConfigured(JsonNode definition) {
        assertThat(definition.get("operationKind").asText()).isEqualTo("MUTATION");
        assertThat(definition.get("idempotencyField").asText()).isEqualTo("order.orderNo");
        assertThat(definition.get("mcpTool")).isEqualTo(json.readTree("{\"enabled\":true,\"aiDescription\":\"为AI提交订单\"}"));
    }

    private void assertConfigured(ApiDefinition definition) {
        assertThat(definition.operationKind()).isEqualTo(ApiOperationKind.MUTATION);
        assertThat(definition.idempotencyField()).isEqualTo("order.orderNo");
        assertThat(definition.mcpTool()).isEqualTo(new McpToolConfig(true, "为AI提交订单"));
    }

    private ObjectNode copyCommand(JsonNode preview) {
        ObjectNode command = json.createObjectNode().put("creationKey", UUID.randomUUID().toString())
                .put("sourceApiId", preview.get("sourceApiId").asText()).put("sourceKind", preview.get("sourceKind").asText())
                .put("sourceRevision", preview.get("sourceRevision").asLong());
        command.set("sourceReleaseId", preview.get("sourceReleaseId"));
        ObjectNode definition = ((ObjectNode) preview.get("snapshot")).deepCopy();
        definition.remove(List.of("id", "protocol", "draftRevision"));
        definition.put("method", "copied");
        command.set("definition", definition);
        return command;
    }

    private List<String> issues(ObjectNode body) throws Exception { return issues(body, "/admin-api/apis/validate"); }

    private List<String> issues(ObjectNode body, String path) throws Exception {
        JsonNode validation = send(post(path).content(body.toString()));
        return StreamSupport.stream(validation.path("fieldIssues").spliterator(), false).map(issue -> issue.path("path").asText()).toList();
    }

    private static ObjectNode mcp(ObjectNode body, String aiDescription) {
        body.putObject("mcpTool").put("enabled", true).put("aiDescription", aiDescription);
        return body;
    }

    private static String service() { return "mcp_" + UUID.randomUUID().toString().replace("-", "").substring(0, 12); }

    private ObjectNode draft(String version) { return draft(service(), version); }

    /** 短标识保证 service_method_version 在64字符内；请求含嵌套字符串、布尔与整数字段。 */
    private ObjectNode draft(String service, String version) {
        return (ObjectNode) json.readTree("""
                {"service":"%s","version":"%s","method":"query","name":"订单提交","category":"订单","owner":"研发",
                 "description":"提交订单","scopeCodes":[],
                 "requestSchema":{"type":"OBJECT","required":true,"properties":{
                   "order":{"type":"OBJECT","required":true,"properties":{
                     "orderNo":{"type":"STRING","required":true,"example":"order-001"},"paid":{"type":"BOOLEAN"}}},
                   "count":{"type":"INTEGER"}}},
                 "responseSchema":{"type":"OBJECT","properties":{"orderId":{"type":"STRING","example":"order-001"}}},
                 "errorDefinitions":[],
                 "binding":{"protocol":"HTTP","timeoutMillis":3000,"http":{"url":"https://internal.example/orders/submit","method":"POST"}},
                 "mappings":[{"target":"order","source":"REQUEST","path":"order"}]}
                """.formatted(service, version));
    }

    private MockHttpServletRequestBuilder auth(MockHttpServletRequestBuilder request) {
        return request.session(io.github.chenyilei2016.openplatform.testing.TestSessions.session("test-session"))
                .header("X-CSRF-Token", "76832d7fdbcdbf4a72129f8b7def9016")
                .contentType("application/json");
    }

    private JsonNode send(MockHttpServletRequestBuilder request) throws Exception {
        var result = mvc.perform(auth(request)).andReturn();
        assertThat(result.getResponse().getStatus()).as("HTTP响应: %s; 异常: %s",
                result.getResponse().getContentAsString(), result.getResolvedException()).isEqualTo(200);
        return json.readTree(result.getResponse().getContentAsString()).get("data");
    }
}
