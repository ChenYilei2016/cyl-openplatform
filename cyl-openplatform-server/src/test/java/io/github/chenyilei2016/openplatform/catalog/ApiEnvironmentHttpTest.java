package io.github.chenyilei2016.openplatform.catalog;

import io.github.chenyilei2016.openplatform.application.token.TokenVerifier;
import io.github.chenyilei2016.openplatform.domain.token.TokenContext;
import io.github.chenyilei2016.openplatform.domain.runtime.HttpApiInvoker;
import io.github.chenyilei2016.openplatform.domain.mcp.McpToolRepository;
import io.github.chenyilei2016.openplatform.infrastructure.properties.environmentrelease.EnvironmentReleaseProperties;

import io.github.chenyilei2016.openplatform.application.identity.AccountAuthentication;
import io.github.chenyilei2016.openplatform.testing.TestAccount;
import jakarta.servlet.http.Cookie;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.*;
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

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** 同一数据源，以服务器配置选择环境；只替换本地账号身份和业务提供方，不增加生产测试入口。 */
@io.github.chenyilei2016.openplatform.testing.TestAdministrators
@org.springframework.context.annotation.Import(io.github.chenyilei2016.openplatform.testing.CatalogReferenceFixture.class)
@SpringBootTest(properties={
        "test.admin.operators[0].tenant-id=tenant-1", "test.admin.operators[0].employee-no=operator-1",
        "test.admin.operators[0].permissions[0]=MANAGE_APIS", "test.admin.operators[0].permissions[1]=MANAGE_APPLICATIONS",
        "test.admin.operators[0].permissions[2]=PUBLISH_APIS", "test.admin.operators[0].permissions[3]=REVIEW_APIS"
})
@AutoConfigureMockMvc(print=MockMvcPrint.NONE)
class ApiEnvironmentHttpTest {
    @Autowired MockMvc mvc;
    @Autowired EnvironmentReleaseProperties environment;
    @Autowired org.springframework.jdbc.core.JdbcTemplate database;
    @Autowired McpToolRepository tools;
    @MockitoBean AccountAuthentication identity;
    @MockitoBean TokenVerifier tokens;
    @MockitoBean HttpApiInvoker provider;
    private final JsonMapper json = JsonMapper.builder().build();

    @BeforeEach void setup() {
        TestAccount user = new TestAccount();
        user.setId(12L); user.setTenantId("tenant-1"); user.setEmployeeNoStr("operator-1");
        when(identity.current("session")).thenAnswer(invocation -> user.toAccount());
        when(provider.invoke(any(), any(), any(), any())).thenReturn(Map.of());
        environment.setEnvironmentId("pre");
    }
    @AfterEach void reset() { environment.setEnvironmentId("local"); environment.setTrustedSources(List.of()); }

    @Test void sharedDatabaseTransferCreatesTargetCopyAndReceiptWithoutChangingSource() throws Exception {
        ObjectNode body = draft();
        String pre = send(post("/admin-api/apis").content(body.toString())).get("id").asText();
        String sourceRelease = publish(pre);
        JsonNode sourceDefinition = send(get("/admin-api/apis/" + pre));
        environment.setEnvironmentId("prod");
        String credential = "api-environment-128-test-only-credential";
        environment.setTrustedSources(List.of(new io.github.chenyilei2016.openplatform.infrastructure.environmentrelease.EnvironmentReleaseSettings.TrustedSource("pre", credential)));
        ObjectNode previewBody = json.createObjectNode().put("sourceEnvironment", "pre").put("targetEnvironment", "prod");
        previewBody.set("definition", sourceDefinition);
        String prefix = "/internal-api/environment-releases/v1";
        String previewResponse = mvc.perform(post(prefix + "/preview").header("Authorization", "Bearer " + credential)
                        .header("X-Platform-Source", "pre").contentType("application/json").content(previewBody.toString()))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        JsonNode preview = json.readTree(previewResponse).get("data");
        assertThat(preview.get("change").asText()).isEqualTo("CREATE");
        ObjectNode transfer = previewBody.deepCopy().put("transferId", UUID.randomUUID().toString())
                .put("sourceReleaseId", sourceRelease).put("operatorTenantId", "tenant-1").put("operatorEmployeeNo", "operator-1")
                .put("expectedRevision", 0).put("previewDigest", preview.get("previewDigest").asText()).put("comment", "同库传输");
        String response = mvc.perform(post(prefix + "/receive").header("Authorization", "Bearer " + credential)
                        .header("X-Platform-Source", "pre").contentType("application/json").content(transfer.toString()))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        JsonNode receipt = json.readTree(response).get("data");
        String prod = receipt.get("apiId").asText();
        assertThat(prod).isNotEqualTo(pre);
        String replay = mvc.perform(post(prefix + "/receive").header("Authorization", "Bearer " + credential)
                        .header("X-Platform-Source", "pre").contentType("application/json").content(transfer.toString()))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        assertThat(json.readTree(replay).at("/data/apiId").asText()).isEqualTo(prod);
        environment.setEnvironmentId("pre");
        assertThat(send(get("/admin-api/apis/" + pre))).isEqualTo(sourceDefinition);
        mvc.perform(auth(get("/admin-api/environment-releases/incoming/" + receipt.get("releaseId").asText())))
                .andExpect(status().isNotFound());
    }

    @Test void importIdempotencyIsIndependentAcrossEnvironments() throws Exception {
        ObjectNode body = draft();
        String key = UUID.randomUUID().toString();
        String firstId = null;
        for (String env : List.of("pre", "prod")) {
            environment.setEnvironmentId(env);
            JsonNode preview = send(post("/admin-api/api-imports/preview").content(body.toString()));
            assertThat(preview.at("/items/0/change").asText()).isEqualTo("CREATE");
            ObjectNode request = json.createObjectNode().put("documentDigest", preview.get("documentDigest").asText())
                    .put("submissionKey", key).put("sourceKind", "PLATFORM").put("sourceDigest", preview.get("documentDigest").asText());
            request.set("document", body);
            request.putArray("selections").addObject().put("index", 0).put("expectedRevision", 0);
            JsonNode result = send(post("/admin-api/api-imports/confirm").content(request.toString()));
            String apiId = result.at("/items/0/apiId").asText();
            assertThat(apiId).isNotBlank();
            if (firstId == null) firstId = apiId; else assertThat(apiId).isNotEqualTo(firstId);
            assertThat(send(get("/admin-api/api-imports/provenance/" + apiId).param("revision", "1")).get("apiId").asText()).isEqualTo(apiId);
        }
    }

    @Test void sameOperationAndMcpNameHaveIndependentDraftsReleasesAndIdBoundaries() throws Exception {
        ObjectNode body = draft();
        String pre = send(post("/admin-api/apis").content(body.toString())).get("id").asText();
        String preRelease = publish(pre);
        String setCode = "env_" + UUID.randomUUID().toString().replace("-", "");
        String setBody = "{\"code\":\"" + setCode + "\",\"name\":\"环境工具集\",\"enabled\":true,\"apiIds\":[\"" + pre + "\"]}";
        String preSet = send(post("/admin-api/mcp/tool-sets").content(setBody)).at("/toolSet/id").asText();
        assertThat(preSet).isNotBlank();
        assertThat(send(get("/admin-api/apis/" + pre + "/revisions")).get("total").asInt()).isGreaterThan(0);
        String toolName = body.get("service").asText() + "_query_v1";
        assertThat(tools.find(toolName, null).orElseThrow().apiId()).isEqualTo(pre);
        environment.setEnvironmentId("prod");
        for (String suffix : List.of("", "/workspace", "/portal-visibility", "/revisions")) {
            mvc.perform(auth(get("/admin-api/apis/" + pre + suffix))).andExpect(status().isNotFound());
        }
        mvc.perform(auth(get("/admin-api/publications/" + preRelease))).andExpect(status().isNotFound());
        mvc.perform(auth(get("/admin-api/publications/apis/" + pre + "/state"))).andExpect(status().isNotFound());
        mvc.perform(auth(put("/admin-api/apis/" + pre + "/portal-visibility").content("{\"visible\":false}"))).andExpect(status().isNotFound());
        assertThat(send(get("/admin-api/apis").param("query", body.get("service").asText())).get("total").asInt()).isZero();
        assertThat(tools.find(toolName, null)).isEmpty();
        mvc.perform(auth(get("/admin-api/mcp/tool-sets/" + preSet))).andExpect(status().isNotFound());
        mvc.perform(auth(post("/admin-api/mcp/tool-sets").content(setBody))).andExpect(status().isBadRequest());
        mvc.perform(auth(post("/admin-api/api-copies/preview").content("{\"sourceApiId\":\"" + pre + "\",\"sourceKind\":\"DRAFT\"}"))).andExpect(status().isNotFound());
        String prod = send(post("/admin-api/apis").content(body.toString())).get("id").asText();
        assertThat(prod).isNotEqualTo(pre);
        String prodRelease = publish(prod);
        String prodSet = send(post("/admin-api/mcp/tool-sets").content(setBody.replace(pre, prod))).at("/toolSet/id").asText();
        assertThat(prodSet).isNotEqualTo(preSet);
        assertThat(prodRelease).isNotEqualTo(preRelease);
        assertThat(tools.find(toolName, null).orElseThrow().apiId()).isEqualTo(prod);
        send(put("/admin-api/apis/" + prod + "/portal-visibility").content("{\"visible\":false}"));
        environment.setEnvironmentId("pre");
        assertThat(send(get("/admin-api/apis/" + pre + "/portal-visibility")).get("visible").asBoolean()).isTrue();
        assertThat(send(get("/admin-api/publications/apis/" + pre + "/state")).get("liveReleaseId").asText()).isEqualTo(preRelease);
        assertThat(send(get("/admin-api/apis").param("query", body.get("service").asText())).get("total").asInt()).isEqualTo(1);
        mvc.perform(auth(get("/admin-api/apis/" + prod))).andExpect(status().isNotFound());
    }

    @Test void portalVisibilityIsImmediateIndependentAndDoesNotBlockAuthorizedInvocation() throws Exception {
        ObjectNode body = draft();
        String id = send(post("/admin-api/apis").content(body.toString())).get("id").asText();
        String release = publish(id);
        String service = body.get("service").asText();
        JsonNode state = send(get("/admin-api/publications/apis/" + id + "/state"));
        String publicPath = "/public-api/documents/" + service + "/v1/query";
        assertThat(send(get("/admin-api/apis").param("query", service)).at("/items/0/portalVisible").asBoolean()).isTrue();
        assertThat(send(get("/admin-api/apis/" + id + "/workspace")).get("portalVisible").asBoolean()).isTrue();
        mvc.perform(get(publicPath + "/view")).andExpect(status().isOk());
        send(put("/admin-api/apis/" + id + "/portal-visibility").content("{\"visible\":false}"));
        assertThat(send(get("/admin-api/apis").param("query", service)).at("/items/0/portalVisible").asBoolean()).isFalse();
        assertThat(send(get("/admin-api/apis/" + id + "/workspace")).get("portalVisible").asBoolean()).isFalse();
        mvc.perform(get(publicPath + "/view")).andExpect(status().isNotFound());
        mvc.perform(get(publicPath + "/export").param("format", "JSON").param("releaseId", release).param("stateVersion", state.get("stateVersion").asText())).andExpect(status().isNotFound());
        String list = mvc.perform(get("/public-api/documents").param("query", service)).andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        assertThat(json.readTree(list).at("/data/total").asInt()).isZero();
        assertThat(send(get("/admin-api/publications/apis/" + id + "/state"))).isEqualTo(state);
        assertThat(send(get("/admin-api/apis/" + id)).get("draftRevision").asInt()).isEqualTo(1);
        mvc.perform(post("/api/oauth/" + service + "/v1/query").header("Authorization", "Bearer test-token").contentType("application/json").content("{}"))
                .andExpect(status().isOk());
        assertThat(tools.find(service + "_query_v1", null)).isPresent();
        body.put("name", "修订后的名称").put("expectedRevision", 1);
        send(put("/admin-api/apis/" + id).content(body.toString()));
        assertThat(send(get("/admin-api/apis/" + id + "/portal-visibility")).get("visible").asBoolean()).isFalse();
        send(put("/admin-api/apis/" + id + "/portal-visibility").content("{\"visible\":true}"));
        mvc.perform(get(publicPath + "/view")).andExpect(status().isOk());
        assertThat(database.queryForObject("SELECT COUNT(*) FROM catalog_audit WHERE api_id=? AND action IN ('HIDE_API_FROM_PORTAL','SHOW_API_IN_PORTAL')", Integer.class, id)).isEqualTo(2);
        mvc.perform(put("/admin-api/apis/" + id + "/portal-visibility").contentType("application/json").content("{\"visible\":false}"))
                .andExpect(status().isUnauthorized());
    }

    private ObjectNode draft() throws Exception {
        String code = "isolation." + UUID.randomUUID().toString().replace("-", "");
        send(post("/admin-api/scopes").content("{\"code\":\""+code+"\",\"name\":\"隔离测试\",\"enabled\":true,\"defaultForNewApplication\":false}"));
        database.update("UPDATE access_scope SET public_access=true WHERE code=?", code);
        when(tokens.verify("test-token")).thenReturn(new TokenContext("t", "app", "ak", "tenant", null, null, null, List.of(code), Instant.now().plusSeconds(300)));
        ObjectNode body = (ObjectNode)json.readTree("""
                {"version":"v1","method":"query","name":"环境独立API","category":"订单","owner":"研发",
                 "scopeCodes":[],"requestSchema":{"type":"OBJECT"},"responseSchema":{"type":"OBJECT"},"errorDefinitions":[],
                 "binding":{"protocol":"HTTP","timeoutMillis":3000,"http":{"url":"https://provider.example/query","method":"POST"}},"mappings":[],
                 "operationKind":"QUERY","mcpTool":{"enabled":true,"aiDescription":"测试环境隔离"}}
                """);
        body.put("service", "isolation_" + UUID.randomUUID().toString().replace("-", ""));
        body.putArray("scopeCodes").add(code);
        return body;
    }
    private String publish(String id) throws Exception {
        String release = send(post("/admin-api/publications/apis/"+id+"/submissions").content("{\"expectedDraftRevision\":1,\"expectedStateVersion\":0,\"submissionKey\":\""+UUID.randomUUID()+"\",\"comment\":\"验证\"}")).get("id").asText();
        send(post("/admin-api/publications/"+release+"/approve").content("{\"comment\":\"通过\"}"));
        return release;
    }
    private MockHttpServletRequestBuilder auth(MockHttpServletRequestBuilder request) {
        return request.session(io.github.chenyilei2016.openplatform.testing.TestSessions.session("session")).header("X-CSRF-Token", "21d6f40cfb511982e4424e0e250a9557").contentType("application/json");
    }
    private JsonNode send(MockHttpServletRequestBuilder request) throws Exception {
        String response = mvc.perform(auth(request)).andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        return json.readTree(response).get("data");
    }
}
