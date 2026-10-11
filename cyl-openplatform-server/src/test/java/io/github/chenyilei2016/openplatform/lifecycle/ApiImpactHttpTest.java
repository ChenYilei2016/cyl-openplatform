package io.github.chenyilei2016.openplatform.lifecycle;


import io.github.chenyilei2016.openplatform.application.identity.AccountAuthentication;
import io.github.chenyilei2016.openplatform.testing.TestAccount;
import jakarta.servlet.http.Cookie;
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
          "open-platform.publish.audit.enabled=false",
        "test.admin.operators[0].tenant-id=tenant-1",
        "test.admin.operators[0].employee-no=operator-1",
        "test.admin.operators[0].permissions[0]=MANAGE_APIS",
        "test.admin.operators[0].permissions[1]=MANAGE_APPLICATIONS",
        "test.admin.operators[0].permissions[2]=PUBLISH_APIS",
        "test.admin.operators[1].tenant-id=tenant-1",
        "test.admin.operators[1].employee-no=apps-only",
        "test.admin.operators[1].permissions[0]=MANAGE_APPLICATIONS",
        "test.admin.operators[2].tenant-id=tenant-1",
        "test.admin.operators[2].employee-no=apis-only",
        "test.admin.operators[2].permissions[0]=MANAGE_APIS",
        "test.admin.operators[3].tenant-id=tenant-1",
        "test.admin.operators[3].employee-no=reviewer",
        "test.admin.operators[3].permissions[0]=MANAGE_APPLICATIONS",
        "test.admin.operators[3].permissions[1]=REVIEW_APIS"
})
@AutoConfigureMockMvc(print = MockMvcPrint.NONE)
@org.springframework.context.annotation.Import(io.github.chenyilei2016.openplatform.testing.CatalogReferenceFixture.class)
class ApiImpactHttpTest {
    @Autowired MockMvc mvc;
    @MockitoBean AccountAuthentication identityService;
    private final JsonMapper json = JsonMapper.builder().build();

    @Test
    void returnsAnyScopeCandidatesOnceWithDisabledAppsAndActiveGrantCounts() throws Exception {
        JsonNode firstScope = scope(); JsonNode secondScope = scope();
        String firstCode = firstScope.get("code").asText(); String secondCode = secondScope.get("code").asText();
        String suffix = UUID.randomUUID().toString();
        JsonNode one = application("影响_" + suffix, firstCode);
        JsonNode both = application("影响_" + suffix, firstCode, secondCode);
        String bothId = both.at("/application/id").asText();
        send(put("/admin-api/applications/" + bothId + "/status").content("{\"enabled\":false}"));
        String tenantGrant = bind(one, "tenant-a").get("id").asText();
        bind(one, "tenant-b");
        send(delete("/admin-api/tenant-grants/" + tenantGrant));
        ObjectNode source = draft(firstCode, secondCode);
        String apiId = send(post("/admin-api/apis").content(source.toString())).get("id").asText();
        String path = "/admin-api/apis/" + apiId + "/affected-applications";
        JsonNode result = send(get(path).param("basis", "DRAFT").param("query", suffix));
        assertThat(result.at("/applications/total").asInt()).isEqualTo(2);
        assertThat(result.toString()).doesNotContain("appKey", "appSecret", "secretDigest", "authorizationVersion");
        for (JsonNode app : result.at("/applications/items")) {
            if (app.get("applicationId").asText().equals(bothId)) {
                assertThat(app.get("status").asText()).isEqualTo("DISABLED");
                assertThat(app.get("matchedScopeCodes").size()).isEqualTo(2);
                assertThat(app.get("activeTenantGrantCount").asInt()).isZero();
            } else assertThat(app.get("activeTenantGrantCount").asInt()).isEqualTo(1);
        }
        JsonNode page1 = send(get(path).param("basis", "DRAFT").param("pageSize", "1").param("query", suffix));
        JsonNode page2 = send(get(path).param("basis", "DRAFT").param("pageSize", "1").param("page", "2").param("query", suffix));
        assertThat(page1.at("/applications/total").asInt()).isEqualTo(2);
        assertThat(page1.at("/applications/items/0/applicationId").asText()).isNotEqualTo(page2.at("/applications/items/0/applicationId").asText());
        assertThat(send(get(path).param("basis", "DRAFT").param("query", "影响_%" + suffix)).at("/applications/total").asInt()).isZero();
        send(put("/admin-api/scopes/" + firstScope.get("id").asText()).content("{\"name\":\"停用\",\"enabled\":false,\"defaultForNewApplication\":false}"));
        JsonNode remaining = send(get(path).param("basis", "DRAFT").param("query", suffix));
        assertThat(remaining.at("/applications/total").asInt()).isEqualTo(1);
        assertThat(remaining.at("/applications/items/0/matchedScopeCodes").size()).isEqualTo(1);
    }

    @Test
    void pinsEffectiveRevisionAndKeepsDraftAndDisabledPublicationSeparate() throws Exception {
        String code = scope().get("code").asText();
        application("版本影响", code);
        ObjectNode source = draft(code);
        String apiId = send(post("/admin-api/apis").content(source.toString())).get("id").asText();
        String path = "/admin-api/apis/" + apiId + "/affected-applications";
        mvc.perform(auth(get(path), "operator-1")).andExpect(status().isNotFound());
        JsonNode release = send(post("/admin-api/publications/apis/" + apiId + "/submissions").content("""
                {"expectedDraftRevision":1,"expectedStateVersion":0,"submissionKey":"%s","comment":"生效"}
                """.formatted(UUID.randomUUID())));
        source.put("expectedRevision", 1).putArray("scopeCodes");
        send(put("/admin-api/apis/" + apiId).content(source.toString()));
        JsonNode state = send(get("/admin-api/publications/apis/" + apiId + "/state"));
        send(put("/admin-api/publications/apis/" + apiId + "/status").content("""
                {"enabled":false,"expectedStateVersion":%s,"reason":"停用仍查影响"}
                """.formatted(state.get("stateVersion").asLong())));
        JsonNode effective = send(get(path).param("expectedRevision", "1"));
        assertThat(effective.get("basis").asText()).isEqualTo("EFFECTIVE");
        assertThat(effective.get("releaseId").asText()).isEqualTo(release.get("id").asText());
        assertThat(effective.get("enabled").asBoolean()).isFalse();
        assertThat(effective.at("/applications/total").asInt()).isEqualTo(1);
        JsonNode draft = send(get(path).param("basis", "DRAFT").param("expectedRevision", "2"));
        assertThat(draft.get("releaseId").isNull()).isTrue();
        assertThat(draft.get("enabled").asBoolean()).isFalse();
        assertThat(draft.at("/applications/total").asInt()).isZero();
        mvc.perform(auth(get(path).param("expectedRevision", "2"), "operator-1")).andExpect(status().isConflict());
        mvc.perform(auth(get(path).param("basis", "DRAFT").param("expectedRevision", "1"), "operator-1")).andExpect(status().isConflict());
    }

    @Test
    void requiresBothPermissionFamiliesAndBoundsPageAndRevision() throws Exception {
        String apiId = send(post("/admin-api/apis").content(draft().toString())).get("id").asText();
        String path = "/admin-api/apis/" + apiId + "/affected-applications";
        for (String employee : new String[]{"apps-only", "apis-only"})
            mvc.perform(auth(get(path).param("basis", "DRAFT"), employee)).andExpect(status().isForbidden());
        mvc.perform(auth(get(path).param("basis", "DRAFT"), "reviewer")).andExpect(status().isOk()).andExpect(header().string("Cache-Control", "no-store"));
        for (String[] invalid : new String[][]{{"page", "0"}, {"pageSize", "101"}, {"page", "100002"}, {"query", "x".repeat(101)}, {"basis", "UNKNOWN"}, {"expectedRevision", "0"}, {"expectedRevision", "1.5"}}) {
            var request = get(path).param(invalid[0], invalid[1]);
            if (!invalid[0].equals("basis")) request.param("basis", "DRAFT");
            mvc.perform(auth(request, "operator-1")).andExpect(status().isBadRequest());
        }
    }

    private JsonNode scope() throws Exception {
        return send(post("/admin-api/scopes").content("""
                {"code":"impact.%s","name":"影响权限组","enabled":true,"defaultForNewApplication":false}
                """.formatted(UUID.randomUUID().toString().replace("-", ""))));
    }
    private JsonNode application(String name, String... scopes) throws Exception {
        JsonNode app = send(post("/admin-api/applications").content(json.createObjectNode().put("name", name).put("ownerTenantId", "owner-tenant").toString()));
        ObjectNode update = json.createObjectNode(); var codes = update.putArray("scopeCodes");
        for (String code : scopes) codes.add(code);
        send(put("/admin-api/applications/" + app.at("/application/id").asText() + "/scopes").content(update.toString()));
        return app;
    }
    private JsonNode bind(JsonNode app, String tenant) throws Exception {
        return send(post("/admin-api/tenant-grants").content(json.createObjectNode().put("appKey", app.at("/application/appKey").asText()).put("appSecret", app.get("appSecret").asText()).put("tenantId", tenant).toString()));
    }
    private ObjectNode draft(String... scopes) {
        ObjectNode draft = (ObjectNode) json.readTree("""
                {"service":"impact_%s","version":"v1","method":"query","name":"订单查询","category":"订单","owner":"研发",
                 "scopeCodes":[],"requestSchema":{"type":"OBJECT","properties":{"orderId":{"type":"STRING"}}},
                 "responseSchema":{"type":"STRING"},"errorDefinitions":[],
                 "binding":{"protocol":"HTTP","timeoutMillis":3000,"http":{"url":"https://internal.example/orders/query","method":"POST"}},
                 "mappings":[{"target":"orderId","source":"REQUEST","path":"orderId"}]}
                """.formatted(UUID.randomUUID().toString().replace("-", "")));
        var codes = draft.putArray("scopeCodes"); for (String code : scopes) codes.add(code);
        return draft;
    }
    private MockHttpServletRequestBuilder auth(MockHttpServletRequestBuilder request, String employee) {
        TestAccount user = new TestAccount();
        user.setId(12L); user.setTenantId("tenant-1"); user.setEmployeeNoStr(employee);
        when(identityService.current("test-session")).thenAnswer(invocation -> user.toAccount());
        return request.session(io.github.chenyilei2016.openplatform.testing.TestSessions.session("test-session")).header("X-CSRF-Token", "76832d7fdbcdbf4a72129f8b7def9016").contentType("application/json");
    }
    private JsonNode send(MockHttpServletRequestBuilder request) throws Exception {
        var result = mvc.perform(auth(request, "operator-1")).andReturn();
        assertThat(result.getResponse().getStatus()).as(result.getResponse().getContentAsString()).isEqualTo(200);
        return json.readTree(result.getResponse().getContentAsString()).get("data");
    }
}
