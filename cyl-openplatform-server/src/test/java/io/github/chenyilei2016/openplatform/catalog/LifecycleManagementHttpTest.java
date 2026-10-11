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
@SpringBootTest(properties = {
        "spring.sql.init.schema-locations=classpath:db/access-schema.sql,classpath:db/mcp-schema.sql,classpath:db/administrator-schema.sql,classpath:db/catalog-schema.sql,classpath:db/dubbo-connection-schema.sql,classpath:db/token-schema.sql,classpath:db/publication-schema.sql,classpath:db/governance-schema.sql,classpath:db/observability-schema.sql,classpath:db/operations-metrics-schema.sql",

        "test.admin.operators[0].tenant-id=tenant-1",
        "test.admin.operators[0].employee-no=operator-1",
        "test.admin.operators[0].permissions[0]=MANAGE_APIS",
        "test.admin.operators[0].permissions[1]=MANAGE_APPLICATIONS",
        "test.admin.operators[0].permissions[2]=PUBLISH_APIS",
        "test.admin.operators[0].permissions[3]=REVIEW_APIS",
        "test.admin.operators[1].tenant-id=tenant-1",
        "test.admin.operators[1].employee-no=author",
        "test.admin.operators[1].permissions[0]=MANAGE_APIS",
        "test.admin.operators[2].tenant-id=tenant-1",
        "test.admin.operators[2].employee-no=viewer",
        "test.admin.operators[2].permissions[0]=VIEW_AUDIT"
})
@AutoConfigureMockMvc(print = MockMvcPrint.NONE)
@org.springframework.context.annotation.Import(io.github.chenyilei2016.openplatform.testing.CatalogReferenceFixture.class)
class LifecycleManagementHttpTest {
    @Autowired MockMvc mvc;
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
    void oldDraftDefaultsAndExplicitLifecycleCannotBeSilentlyCleared() throws Exception {
        ObjectNode body = draft();
        JsonNode created = send(post("/admin-api/apis").content(body.toString()));
        String id = created.get("id").asText();
        assertThat(created.at("/lifecycle/status").asText()).isEqualTo("ACTIVE");
        assertThat(created.at("/lifecycle/compatibility").asText()).isEqualTo("UNSPECIFIED");
        body.put("expectedRevision", 1);
        body.set("lifecycle", json.readTree("""
                {"status":"DEPRECATED","compatibility":"BREAKING","compatibilityNotes":"金额改为分",
                 "deprecationNotice":"请迁移新版","replacementVersion":"v2","sunsetDate":"2000-01-01"}
                """));
        JsonNode changed = send(put("/admin-api/apis/" + id).content(body.toString()));
        assertThat(changed.get("draftRevision").asLong()).isEqualTo(2);
        assertThat(send(get("/admin-api/apis/" + id + "/preview")).get("lifecycle")).isEqualTo(changed.get("lifecycle"));
        body.put("expectedRevision", 2).remove("lifecycle");
        mvc.perform(auth(put("/admin-api/apis/" + id).content(body.toString()))).andExpect(status().isBadRequest());
        assertThat(send(get("/admin-api/apis/" + id)).get("draftRevision").asLong()).isEqualTo(2);
        body.set("lifecycle", json.readTree("{\"status\":\"ACTIVE\",\"compatibility\":\"UNSPECIFIED\"}"));
        assertThat(send(put("/admin-api/apis/" + id).content(body.toString())).at("/lifecycle/status").asText()).isEqualTo("ACTIVE");
    }

    @Test
    void rejectsIncompleteAndContradictoryLifecycleDeclarations() throws Exception {
        for (String lifecycle : new String[]{
                "{}", "{\"status\":\"ACTIVE\"}",
                "{\"status\":\"DEPRECATED\",\"compatibility\":\"UNSPECIFIED\"}",
                "{\"status\":\"ACTIVE\",\"compatibility\":\"BREAKING\"}",
                "{\"status\":\"ACTIVE\",\"compatibility\":\"UNSPECIFIED\",\"deprecationNotice\":\"旧版\"}",
                "{\"status\":\"RETIRED\",\"compatibility\":\"UNSPECIFIED\",\"deprecationNotice\":\"退出\",\"replacementVersion\":\"v1\"}",
                "{\"status\":\"RETIRED\",\"compatibility\":\"UNSPECIFIED\",\"deprecationNotice\":\"退出\",\"sunsetDate\":\"2026-02-30\"}"
        }) {
            ObjectNode body = draft();
            body.set("lifecycle", json.readTree(lifecycle));
            mvc.perform(auth(post("/admin-api/apis").content(body.toString()))).andExpect(status().isBadRequest());
        }
    }

    @Test
    void importPreviewsAndCommitsLifecycleAsAnExplicitWholeContractDifference() throws Exception {
        ObjectNode body = draft();
        JsonNode created = send(post("/admin-api/apis").content(body.toString()));
        body.set("lifecycle", json.readTree("{\"status\":\"RETIRED\",\"compatibility\":\"UNSPECIFIED\",\"deprecationNotice\":\"请使用v2\"}"));
        JsonNode preview = send(post("/admin-api/api-imports/preview").content(body.toString()));
        assertThat(preview.at("/items/0/change").asText()).isEqualTo("UPDATE");
        assertThat(preview.at("/items/0/changedFields").toString()).contains("lifecycle");
        assertThat(send(get("/admin-api/apis/" + created.get("id").asText())).at("/lifecycle/status").asText()).isEqualTo("ACTIVE");
        ObjectNode confirmation = json.createObjectNode();
        confirmation.set("document", body);
        confirmation.put("documentDigest", preview.get("documentDigest").asText());
        confirmation.putArray("selections").addObject().put("index", 0).put("expectedRevision", 1);
        assertThat(send(post("/admin-api/api-imports/confirm").content(confirmation.toString())).get("committed").asBoolean()).isTrue();
        assertThat(send(get("/admin-api/apis/" + created.get("id").asText())).at("/lifecycle/status").asText()).isEqualTo("RETIRED");
        body.remove("lifecycle");
        JsonNode reset = send(post("/admin-api/api-imports/preview").content(body.toString()));
        assertThat(reset.at("/items/0/changedFields").toString()).contains("lifecycle");
        assertThat(reset.at("/items/0/after/lifecycle/status").asText()).isEqualTo("ACTIVE");
    }

    @Test
    void pendingAndRejectedLifecycleNeverOverwriteTheEffectiveSnapshot() throws Exception {
        ObjectNode body = draft();
        String scope = "life_" + UUID.randomUUID().toString().replace("-", "");
        send(post("/admin-api/scopes").content("{\"code\":\"" + scope + "\",\"name\":\"生命周期\",\"enabled\":true,\"defaultForNewApplication\":false}"));
        body.putArray("scopeCodes").add(scope);
        String id = send(post("/admin-api/apis").content(body.toString())).get("id").asText();
        JsonNode first = send(post("/admin-api/publications/apis/" + id + "/submissions").content(
                "{\"expectedDraftRevision\":1,\"expectedStateVersion\":0,\"submissionKey\":\"" + UUID.randomUUID() + "\",\"comment\":\"首次发布\"}"));
        send(post("/admin-api/publications/" + first.get("id").asText() + "/approve").content("{\"comment\":\"通过\"}"));
        body.put("expectedRevision", 1);
        body.set("lifecycle", json.readTree("{\"status\":\"DEPRECATED\",\"compatibility\":\"UNSPECIFIED\",\"deprecationNotice\":\"迁移计划待确认\"}"));
        send(put("/admin-api/apis/" + id).content(body.toString()));
        JsonNode pending = send(post("/admin-api/publications/apis/" + id + "/submissions").content(
                "{\"expectedDraftRevision\":2,\"expectedStateVersion\":2,\"submissionKey\":\"" + UUID.randomUUID() + "\",\"comment\":\"废弃公告\"}"));
        body.put("expectedRevision", 2);
        ((ObjectNode) body.get("lifecycle")).put("status", "RETIRED");
        send(put("/admin-api/apis/" + id).content(body.toString()));
        assertThat(send(get("/admin-api/publications/" + pending.get("id").asText())).at("/snapshot/lifecycle/status").asText()).isEqualTo("DEPRECATED");
        assertThat(send(get("/admin-api/publications/apis/" + id + "/effective")).at("/snapshot/lifecycle/status").asText()).isEqualTo("ACTIVE");
        send(post("/admin-api/publications/" + pending.get("id").asText() + "/reject").content("{\"comment\":\"迁移方案未确认\"}"));
        assertThat(send(get("/admin-api/publications/apis/" + id + "/effective")).at("/snapshot/lifecycle/status").asText()).isEqualTo("ACTIVE");
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
        var result = mvc.perform(auth(request)).andReturn();
        assertThat(result.getResponse().getStatus()).as("HTTP响应: %s; 异常: %s",
                result.getResponse().getContentAsString(), result.getResolvedException()).isEqualTo(200);
        return json.readTree(result.getResponse().getContentAsString()).get("data");
    }
}
