package io.github.chenyilei2016.openplatform.documentation;


import io.github.chenyilei2016.openplatform.application.identity.AccountAuthentication;
import io.github.chenyilei2016.openplatform.testing.TestAccount;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
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
        "spring.sql.init.schema-locations=classpath:db/access-schema.sql,classpath:db/mcp-schema.sql,classpath:db/catalog-schema.sql,classpath:db/dubbo-connection-schema.sql,classpath:db/token-schema.sql,classpath:db/publication-schema.sql,classpath:db/governance-schema.sql,classpath:db/observability-schema.sql,classpath:db/operations-metrics-schema.sql",
        "open-platform.gateway-base-url=https://gateway.example.test/",

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
class DocumentExportHttpTest {
    @Autowired MockMvc mvc;
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

    @ParameterizedTest
    @ValueSource(strings = {"/admin-api/documents/", "/public-api/documents/"})
    void downloadsTheExactPublicSnapshotWithSafeHtmlAndLosslessJson(String surface) throws Exception {
        ObjectNode draft = draft();
        draft.put("name", "订单 <script>alert(1)</script> & 文档");
        draft.set("responseSchema", json.readTree("""
                {"type":"OBJECT","properties":{
                  "rows":{"type":"ARRAY","example":[],"items":{"type":"OBJECT","properties":{
                    "amount":{"type":"NUMBER","defaultValue":0,"example":9007199254740993.123456789},
                    "enabled":{"type":"BOOLEAN","defaultValue":false,"enumValues":[false,true]}
                  }}}
                }}
                """));
        JsonNode view = publish(draft);
        assertThat(view.at("/document/baseUrl").asText()).isEqualTo("https://gateway.example.test");
        String path = operation(draft);
        var jsonResponse = mvc.perform(exportRequest(surface, path)
                        .param("format", "JSON").param("releaseId", view.get("releaseId").asText())
                        .param("stateVersion", view.get("stateVersion").asText()))
                .andExpect(status().isOk()).andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(header().string("X-Content-Type-Options", "nosniff")).andReturn().getResponse();
        assertThat(jsonResponse.getHeader("Content-Disposition")).contains("attachment", ".json");
        assertThat(jsonResponse.getContentAsByteArray().length).isEqualTo(Integer.parseInt(jsonResponse.getHeader("Content-Length")));
        String exported = jsonResponse.getContentAsString(java.nio.charset.StandardCharsets.UTF_8);
        assertThat(json.readTree(exported)).isEqualTo(view);
        assertThat(exported).contains("9007199254740993.123456789").doesNotContain("internal.example", "binding", "mappings", "owner");
        var htmlResponse = mvc.perform(exportRequest(surface, path)
                        .param("format", "HTML").param("releaseId", view.get("releaseId").asText())
                        .param("stateVersion", view.get("stateVersion").asText()))
                .andExpect(status().isOk()).andReturn().getResponse();
        String html = htmlResponse.getContentAsString(java.nio.charset.StandardCharsets.UTF_8);
        assertThat(html).contains("&lt;script&gt;", "rows[]", "false", "9007199254740993.123456789", "[]", "default-src", "release")
                .contains("https://gateway.example.test/api/oauth/" + path)
                .doesNotContain("<script", "internal.example", "<iframe", "<img");
        assertThat(htmlResponse.getHeader("Content-Disposition")).contains("attachment", ".html").doesNotContain("订单");
    }

    @Test
    void refusesStaleReleaseAndMissingOrMalformedSelectorsWithoutDownloadingAnError() throws Exception {
        ObjectNode draft = draft();
        JsonNode view = publish(draft);
        String path = "/admin-api/documents/" + operation(draft) + "/export";
        mvc.perform(auth(get(path).param("format", "JSON"))).andExpect(status().isBadRequest());
        mvc.perform(auth(get(path).param("format", "PDF").param("releaseId", view.get("releaseId").asText())
                .param("stateVersion", view.get("stateVersion").asText()))).andExpect(status().isBadRequest());
        mvc.perform(auth(get(path).param("format", "HTML").param("releaseId", UUID.randomUUID().toString())
                .param("stateVersion", view.get("stateVersion").asText())))
                .andExpect(status().isConflict()).andExpect(header().doesNotExist("Content-Disposition"));
        mvc.perform(auth(get(path).param("format", "JSON").param("releaseId", view.get("releaseId").asText())
                .param("stateVersion", "1.0"))).andExpect(status().isBadRequest());
        mvc.perform(get(path).param("format", "JSON").param("releaseId", view.get("releaseId").asText())
                .param("stateVersion", view.get("stateVersion").asText())).andExpect(status().isUnauthorized());
    }

    @Test
    void pendingDraftDoesNotEnterTheEffectiveDownload() throws Exception {
        ObjectNode draft = draft();
        JsonNode first = publish(draft);
        String id = first.at("/document/id").asText();
        draft.put("expectedRevision", 1).put("name", "未生效的绝密草稿");
        send(put("/admin-api/apis/" + id).content(draft.toString()));
        send(post("/admin-api/publications/apis/" + id + "/submissions").content(
                "{\"expectedDraftRevision\":2,\"expectedStateVersion\":2,\"submissionKey\":\"" + UUID.randomUUID() + "\",\"comment\":\"待审核\"}"));
        JsonNode current = send(get("/admin-api/documents/" + operation(draft) + "/view"));
        var response = mvc.perform(auth(get("/admin-api/documents/" + operation(draft) + "/export")
                .param("format", "JSON").param("releaseId", current.get("releaseId").asText())
                .param("stateVersion", current.get("stateVersion").asText())))
                .andExpect(status().isOk()).andReturn().getResponse();
        assertThat(response.getContentAsString(java.nio.charset.StandardCharsets.UTF_8)).contains("订单查询").doesNotContain("绝密草稿");
        assertThat(current.get("releaseId")).isEqualTo(first.get("releaseId"));
    }

    @Test
    void operationNamedAnnouncementsDoesNotCollideWithExistingAnnouncementRoute() throws Exception {
        ObjectNode draft = draft().put("method", "announcements");
        JsonNode view = publish(draft);
        JsonNode app = send(post("/admin-api/applications").content("{\"name\":\"文档读者\",\"ownerTenantId\":\"101\"}"));
        send(put("/admin-api/applications/" + app.at("/application/id").asText() + "/scopes")
                .content(json.createObjectNode().set("scopeCodes", draft.get("scopeCodes")).toString()));
        ObjectNode credentials = json.createObjectNode().put("appKey", app.at("/application/appKey").asText())
                .put("appSecret", app.get("appSecret").asText()).put("tenantId", "101");
        send(post("/admin-api/tenant-grants").content(credentials.toString()));
        String token = json.readTree(mvc.perform(post("/api/token").contentType("application/json").content(credentials.toString()))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString()).at("/data/accessToken").asText();
        String path = "/api/docs/" + operation(draft);
        mvc.perform(get(path + "/view").header("Authorization", "Bearer " + token)).andExpect(status().isOk())
                .andExpect(jsonPath("$.data.method").value("announcements"))
                .andExpect(jsonPath("$.data.document.baseUrl").value("https://gateway.example.test"));
        mvc.perform(get(path + "/announcements").header("Authorization", "Bearer " + token)).andExpect(status().isOk())
                .andExpect(jsonPath("$.data.method").value("announcements"));
        mvc.perform(get(path + "/export").header("Authorization", "Bearer " + token).param("format", "JSON")
                .param("releaseId", view.get("releaseId").asText()).param("stateVersion", view.get("stateVersion").asText()))
                .andExpect(status().isOk()).andExpect(jsonPath("$.method").value("announcements"));
    }

    private MockHttpServletRequestBuilder exportRequest(String surface, String operation) {
        MockHttpServletRequestBuilder request = get(surface + operation + "/export");
        return surface.startsWith("/admin-api/") ? auth(request) : request;
    }

    private JsonNode publish(ObjectNode draft) throws Exception {
        String scope = "doc_" + UUID.randomUUID().toString().replace("-", "");
        send(post("/admin-api/scopes").content("{\"code\":\"" + scope + "\",\"name\":\"文档权限\",\"enabled\":true,\"defaultForNewApplication\":false,\"publicAccess\":true}"));
        draft.putArray("scopeCodes").add(scope);
        String id = send(post("/admin-api/apis").content(draft.toString())).get("id").asText();
        JsonNode release = send(post("/admin-api/publications/apis/" + id + "/submissions").content(
                "{\"expectedDraftRevision\":1,\"expectedStateVersion\":0,\"submissionKey\":\"" + UUID.randomUUID() + "\",\"comment\":\"文档发布\"}"));
        send(post("/admin-api/publications/" + release.get("id").asText() + "/approve").content("{\"comment\":\"通过\"}"));
        return send(get("/admin-api/documents/" + operation(draft) + "/view"));
    }

    private String operation(ObjectNode draft) {
        return draft.get("service").asText() + "/" + draft.get("version").asText() + "/" + draft.get("method").asText();
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
