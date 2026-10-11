package io.github.chenyilei2016.openplatform.documentation;

import io.github.chenyilei2016.openplatform.application.token.TokenVerifier;
import io.github.chenyilei2016.openplatform.domain.token.TokenContext;

import io.github.chenyilei2016.openplatform.application.identity.AccountAuthentication;
import io.github.chenyilei2016.openplatform.testing.TestAccount;
import jakarta.servlet.http.Cookie;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.webmvc.test.autoconfigure.MockMvcPrint;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@io.github.chenyilei2016.openplatform.testing.TestAdministrators
@org.springframework.context.annotation.Import(io.github.chenyilei2016.openplatform.testing.CatalogReferenceFixture.class)
@SpringBootTest(properties = {

        "test.admin.operators[0].tenant-id=tenant-1",
        "test.admin.operators[0].employee-no=operator-1",
        "test.admin.operators[0].permissions[0]=MANAGE_APIS",
        "test.admin.operators[0].permissions[1]=MANAGE_APPLICATIONS",
        "test.admin.operators[0].permissions[2]=PUBLISH_APIS",
        "test.admin.operators[0].permissions[3]=REVIEW_APIS",
        "test.admin.operators[1].tenant-id=tenant-1",
        "test.admin.operators[1].employee-no=viewer",
        "test.admin.operators[1].permissions[0]=VIEW_AUDIT"
})
@AutoConfigureMockMvc(print = MockMvcPrint.NONE)
class DocumentCatalogHttpTest {
    @Autowired MockMvc mvc;
    @Autowired io.github.chenyilei2016.openplatform.domain.catalog.ApiCategoryRepository managedCategories;
    @Autowired JdbcTemplate jdbc;
    @MockitoBean AccountAuthentication identity;
    @MockitoBean io.github.chenyilei2016.openplatform.domain.access.EmployeeDirectory employeeDirectory;
    @MockitoBean TokenVerifier tokens;
    private final JsonMapper json = JsonMapper.builder().build();

    @BeforeEach
    void identity() {
        for (String employee : List.of("operator-1", "viewer")) {
            var user = new TestAccount();
            user.setId(1L);
            user.setTenantId("tenant-1");
            user.setEmployeeNoStr(employee);
            when(identity.current(employee.equals("operator-1") ? "test-session" : employee)).thenAnswer(invocation -> user.toAccount());
        }
    }

    @Test
    void portalVisibilityFiltersListCountsDetailsAndExportsByVerifiedTenant() throws Exception {
        String service = "tenantdocs_" + UUID.randomUUID().toString().replace("-", "");
        String publicCode = scope(), privateCode = scope();
        jdbc.update("UPDATE access_scope SET public_access=true WHERE code=?", publicCode);
        publish(draft(service, "v1", "publicread", "公共订单", List.of(publicCode)));
        publish(draft(service, "v1", "privateread", "专属订单", List.of(privateCode)));
        when(employeeDirectory.find("tenant-1", "operator-1")).thenReturn(new io.github.chenyilei2016.openplatform.domain.access.EmployeeIdentity(
                "tenant-1", "1", "201", "operator-1", "门户员工", true, io.github.chenyilei2016.openplatform.domain.access.EmployeeStatus.PERMANENT));
        String privatePath = "/" + service + "/v1/privateread";
        JsonNode privateView = send(auth(get("/admin-api/documents" + privatePath + "/view")));
        assertThat(send(get("/public-api/documents").param("service", service)).path("total").asInt()).isEqualTo(1);
        assertThat(send(auth(get("/portal-api/documents").param("service", service))).path("total").asInt()).isEqualTo(1);
        mvc.perform(get("/public-api/documents" + privatePath + "/view")).andExpect(status().isNotFound());
        mvc.perform(auth(get("/portal-api/documents" + privatePath + "/view"))).andExpect(status().isNotFound());
        mvc.perform(get("/portal-api/documents")).andExpect(status().isUnauthorized());
        String scopeId = jdbc.queryForObject("SELECT id FROM access_scope WHERE code=?", String.class, privateCode);
        JsonNode grant = send(auth(post("/admin-api/scopes/" + scopeId + "/tenant-grants").content("{\"tenantId\":\"tenant-1\"}")));
        assertThat(send(auth(get("/portal-api/documents").param("service", service))).path("total").asInt()).isEqualTo(2);
        assertThat(send(auth(get("/portal-api/documents/categories").param("service", service))).path("total").asInt()).isEqualTo(2);
        assertThat(send(auth(get("/portal-api/documents" + privatePath + "/view"))).path("method").asText()).isEqualTo("privateread");
        mvc.perform(auth(get("/portal-api/documents" + privatePath + "/export").param("format", "JSON")
                .param("releaseId", privateView.get("releaseId").asText()).param("stateVersion", privateView.get("stateVersion").asText())))
                .andExpect(status().isOk());
        // 匿名地址不使用Cookie或客户端tenantId扩大范围。
        assertThat(send(auth(get("/public-api/documents").param("service", service).param("tenantId", "tenant-1"))).path("total").asInt()).isEqualTo(1);
        send(auth(delete("/admin-api/scopes/" + scopeId + "/tenant-grants/" + grant.get("id").asText())));
        mvc.perform(auth(get("/portal-api/documents" + privatePath + "/export").param("format", "JSON")
                .param("releaseId", privateView.get("releaseId").asText()).param("stateVersion", privateView.get("stateVersion").asText())))
                .andExpect(status().isNotFound());
        assertThat(send(auth(get("/portal-api/documents/categories").param("service", service))).path("total").asInt()).isEqualTo(1);
    }

    @Test
    void filtersEffectiveSnapshotsBeforePaginationAndGroupsOnlyAuthorizedVersions() throws Exception {
        String service = "docs_" + UUID.randomUUID().toString().replace("-", "");
        String allowed = scope(), hidden = scope();
        token(List.of(allowed));
        publish(draft(service, "v1", "a", "可见分类", List.of(allowed, hidden)));
        publish(draft(service, "v2", "b", "可见分类", List.of(allowed)));
        publish(draft(service, "v3", "c", "隐藏分类", List.of(hidden)));
        ObjectNode changing = draft(service, "v4", "d", "原分类", List.of(allowed));
        String id = publish(changing);
        changing.put("expectedRevision", 1).put("category", "草稿分类").put("name", "未生效名称");
        changing.putArray("scopeCodes").add(hidden);
        send(auth(put("/admin-api/apis/" + id).content(changing.toString())));

        JsonNode page = send(customer(get("/api/docs").param("service", service).param("pageSize", "1")));
        assertThat(page.get("total").asInt()).isEqualTo(3);
        assertThat(page.get("items").size()).isEqualTo(1);
        JsonNode category = send(customer(get("/api/docs/categories").param("service", service).param("category", "可见分类")));
        assertThat(category.at("/items/0/apiCount").asInt()).isEqualTo(2);
        assertThat(send(customer(get("/api/docs").param("service", service).param("version", "v2"))).at("/items/0/version").asText()).isEqualTo("v2");
        assertThat(send(customer(get("/api/docs").param("service", service).param("category", "草稿分类"))).get("total").asInt()).isZero();
        assertThat(send(customer(get("/api/docs").param("service", service).param("category", "原分类"))).at("/items/0/name").asText()).isEqualTo("生效订单");
        assertThat(page.toString()).doesNotContain("binding", "snapshot", "owner", "隐藏分类");
    }

    @Test
    void disabledScopesAndEmptyScopesExposeNeitherDocumentsNorCategoryCounts() throws Exception {
        String service = "docs_" + UUID.randomUUID().toString().replace("-", "");
        String code = scope();
        publish(draft(service, "v1", "query", "受控分类", List.of(code)));
        token(List.of(code));
        assertThat(send(customer(get("/api/docs").param("service", service))).get("total").asInt()).isEqualTo(1);
        jdbc.update("UPDATE access_scope SET enabled=false WHERE code=?", code);
        assertThat(send(customer(get("/api/docs").param("service", service))).get("total").asInt()).isZero();
        assertThat(send(customer(get("/api/docs/categories").param("service", service))).get("total").asInt()).isZero();
        token(List.of());
        assertThat(send(customer(get("/api/docs").param("service", service))).get("total").asInt()).isZero();
        assertThat(send(auth(get("/admin-api/documents").param("service", service))).get("total").asInt()).isEqualTo(1);
    }

    @Test
    void retiredDocumentationRemainsVisibleButIndependentDisableRemovesIt() throws Exception {
        String service = "docs_" + UUID.randomUUID().toString().replace("-", "");
        String code = scope();
        token(List.of(code));
        ObjectNode body = draft(service, "v1", "query", "已退出", List.of(code));
        body.set("lifecycle", json.readTree("{\"status\":\"RETIRED\",\"compatibility\":\"UNSPECIFIED\",\"deprecationNotice\":\"请迁移v2\"}"));
        String id = publish(body);
        assertThat(send(customer(get("/api/docs").param("service", service))).at("/items/0/lifecycleStatus").asText()).isEqualTo("RETIRED");
        long stateVersion = send(auth(get("/admin-api/publications/apis/" + id + "/effective"))).get("stateVersion").asLong();
        send(auth(put("/admin-api/publications/apis/" + id + "/status").content(
                "{\"enabled\":false,\"expectedStateVersion\":" + stateVersion + ",\"reason\":\"文档停用验证\"}")));
        assertThat(send(customer(get("/api/docs").param("service", service))).get("total").asInt()).isZero();
        assertThat(send(auth(get("/admin-api/documents/categories").param("service", service))).get("total").asInt()).isZero();
    }

    @Test
    void authenticatesBothSurfacesAndRejectsUnboundedQueries() throws Exception {
        mvc.perform(get("/api/docs")).andExpect(status().isUnauthorized());
        mvc.perform(get("/admin-api/documents")).andExpect(status().isUnauthorized());
        mvc.perform(get("/admin-api/documents").session(io.github.chenyilei2016.openplatform.testing.TestSessions.session("viewer"))).andExpect(status().isForbidden());
        token(List.of());
        for (String[] invalid : List.of(new String[]{"pageSize", "101"}, new String[]{"page", "100002"},
                new String[]{"category", "x".repeat(101)}, new String[]{"version", "x".repeat(33)})) {
            mvc.perform(customer(get("/api/docs").param(invalid[0], invalid[1]))).andExpect(status().isBadRequest());
        }
        mvc.perform(customer(get("/api/docs"))).andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(header().string("X-Content-Type-Options", "nosniff"));
    }

    @Test
    void incompleteLiveProjectionFailsClosedUntilBackfillButEmptyTokenStillSeesNothing() throws Exception {
        String code = scope();
        String id = publish(draft("docs_" + UUID.randomUUID().toString().replace("-", ""), "v1", "query", "迁移分类", List.of(code)));
        token(List.of(code));
        jdbc.update("UPDATE publication_release SET category=null WHERE api_id=?", id);
        try {
            mvc.perform(customer(get("/api/docs"))).andExpect(status().isServiceUnavailable());
            mvc.perform(auth(get("/admin-api/documents/categories"))).andExpect(status().isServiceUnavailable());
            mvc.perform(get("/public-api/documents")).andExpect(status().isServiceUnavailable());
            mvc.perform(get("/public-api/documents/categories")).andExpect(status().isServiceUnavailable());
            token(List.of());
            assertThat(send(customer(get("/api/docs/categories"))).get("total").asInt()).isZero();
        } finally {
            jdbc.update("UPDATE publication_release SET category='迁移分类' WHERE api_id=?", id);
        }
    }

    @Test
    void anonymousCatalogUsesEffectiveProjectionAndLiteralVersionBeforeBoundedPagination() throws Exception {
        String service = "public_" + UUID.randomUUID().toString().replace("-", "");
        String code = scope();
        jdbc.update("UPDATE access_scope SET public_access=true WHERE code=?", code);
        publish(draft(service, "v1", "query", "公共订单", List.of(code)));
        publish(draft(service, "v10", "query", "公共订单", List.of(code)));
        publish(draft(service, "v2", "query", "公共交易", List.of(code)));

        JsonNode page = send(get("/public-api/documents").param("service", service).param("pageSize", "1").param("page", "2"));
        assertThat(page.get("total").asInt()).isEqualTo(3);
        assertThat(page.get("items").size()).isEqualTo(1);
        assertThat(send(get("/public-api/documents").param("service", service).param("version", "v2"))
                .at("/items/0/version").asText()).isEqualTo("v2");
        JsonNode categories = send(get("/public-api/documents/categories").param("service", service)
                .param("category", "公共订单").param("query", "生效订单"));
        assertThat(categories.at("/items/0/apiCount").asInt()).isEqualTo(2);
        assertThat(send(get("/public-api/documents").param("service", service).param("category", "公共交易"))
                .get("total").asInt()).isEqualTo(1);
        assertThat(send(get("/public-api/documents").param("service", service).param("query", "生效%"))
                .get("total").asInt()).isZero();
        assertThat(send(get("/public-api/documents/" + service + "/v2/query/view")).toString())
                .contains("/api/oauth/", code).doesNotContain("binding", "internal.example", "mappings", "owner", "snapshotJson");
        mvc.perform(get("/public-api/documents").param("service", service))
                .andExpect(status().isOk()).andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(header().string("X-Content-Type-Options", "nosniff"));
        for (String[] invalid : List.of(new String[]{"pageSize", "101"}, new String[]{"page", "100002"},
                new String[]{"page", "0"}, new String[]{"category", "x".repeat(101)}, new String[]{"version", "x".repeat(33)})) {
            mvc.perform(get("/public-api/documents").param(invalid[0], invalid[1])).andExpect(status().isBadRequest());
            mvc.perform(get("/public-api/documents/categories").param(invalid[0], invalid[1])).andExpect(status().isBadRequest());
        }
        mvc.perform(get("/api/docs")).andExpect(status().isUnauthorized());
        mvc.perform(get("/admin-api/documents")).andExpect(status().isUnauthorized());
        jdbc.update("UPDATE access_scope SET enabled=false WHERE code=?", code);
        assertThat(send(get("/public-api/documents").param("service", service)).get("total").asInt()).isZero();
        token(List.of(code));
        mvc.perform(customer(get("/api/docs/" + service + "/v2/query/view"))).andExpect(status().isForbidden());
        assertThat(send(customer(get("/api/docs").param("service", service))).get("total").asInt()).isZero();
    }

    @Test
    void anonymousReadsOnlyAppliedLiveSnapshotAcrossPendingRetirementAndDisable() throws Exception {
        String service = "public_" + UUID.randomUUID().toString().replace("-", "");
        String code = scope();
        jdbc.update("UPDATE access_scope SET public_access=true WHERE code=?", code);
        ObjectNode body = draft(service, "v1", "query", "公共生命周期", List.of(code));
        body.set("lifecycle", json.readTree("{\"status\":\"RETIRED\",\"compatibility\":\"UNSPECIFIED\",\"deprecationNotice\":\"请迁移v2\"}"));
        String id = publish(body);
        String path = "/public-api/documents/" + service + "/v1/query";
        JsonNode first = send(get(path + "/view"));
        mvc.perform(get(path + "/export").param("format", "JSON").param("releaseId", UUID.randomUUID().toString())
                .param("stateVersion", first.get("stateVersion").asText())).andExpect(status().isConflict())
                .andExpect(header().doesNotExist("Content-Disposition"));
        mvc.perform(get(path + "/export").param("format", "PDF").param("releaseId", first.get("releaseId").asText())
                .param("stateVersion", first.get("stateVersion").asText())).andExpect(status().isBadRequest());
        mvc.perform(get(path + "/export").param("format", "JSON")).andExpect(status().isBadRequest());
        assertThat(first.at("/document/lifecycle/status").asText()).isEqualTo("RETIRED");
        token(List.of(code));
        mvc.perform(customer(post("/api/oauth/" + service + "/v1/query")).contentType("application/json").content("{}"))
                .andExpect(status().isGone());
        body.put("expectedRevision", 1).put("name", "内部待审正文").put("category", "内部待审分类");
        send(auth(put("/admin-api/apis/" + id).content(body.toString())));
        send(auth(post("/admin-api/publications/apis/" + id + "/submissions").content(
                "{\"expectedDraftRevision\":2,\"expectedStateVersion\":2,\"submissionKey\":\"" + UUID.randomUUID() + "\",\"comment\":\"内部审核说明\"}")));
        JsonNode current = send(get(path + "/view"));
        assertThat(current.get("releaseId")).isEqualTo(first.get("releaseId"));
        assertThat(current.toString()).contains("生效订单").doesNotContain("内部待审", "内部审核", "internal.example");
        assertThat(send(get("/public-api/documents").param("service", service)).at("/items/0/name").asText()).isEqualTo("生效订单");
        mvc.perform(get(path + "/export").param("format", "JSON").param("releaseId", first.get("releaseId").asText())
                .param("stateVersion", first.get("stateVersion").asText())).andExpect(status().isConflict());
        mvc.perform(get(path + "/export").param("format", "JSON").param("releaseId", current.get("releaseId").asText())
                .param("stateVersion", current.get("stateVersion").asText())).andExpect(status().isOk());
        send(auth(put("/admin-api/publications/apis/" + id + "/status").content(
                "{\"enabled\":false,\"expectedStateVersion\":" + current.get("stateVersion").asLong() + ",\"reason\":\"公开文档停用验证\"}")));
        assertThat(send(get("/public-api/documents").param("service", service)).get("total").asInt()).isZero();
        assertThat(send(get("/public-api/documents/categories").param("service", service)).get("total").asInt()).isZero();
        mvc.perform(get(path + "/view")).andExpect(status().isNotFound());
        mvc.perform(get(path + "/export").param("format", "HTML").param("releaseId", current.get("releaseId").asText())
                .param("stateVersion", current.get("stateVersion").asText())).andExpect(status().isNotFound());
    }

    @Test
    void anonymousDraftPendingAndNonAppliedPointersNeverBecomePublic() throws Exception {
        String service = "public_" + UUID.randomUUID().toString().replace("-", "");
        String code = scope();
        jdbc.update("UPDATE access_scope SET public_access=true WHERE code=?", code);
        ObjectNode body = draft(service, "v1", "query", "首次待审", List.of(code));
        String id = send(auth(post("/admin-api/apis").content(body.toString()))).get("id").asText();
        String path = "/public-api/documents/" + service + "/v1/query";
        mvc.perform(get(path + "/view")).andExpect(status().isNotFound());
        JsonNode pending = send(auth(post("/admin-api/publications/apis/" + id + "/submissions").content(
                "{\"expectedDraftRevision\":1,\"expectedStateVersion\":0,\"submissionKey\":\"" + UUID.randomUUID() + "\",\"comment\":\"待审核\"}")));
        mvc.perform(get(path + "/view")).andExpect(status().isNotFound());
        // 验证损坏的指针也不能把待审或失败快照公开，而不依赖写入流程的不变量。
        jdbc.update("UPDATE publication_state SET enabled=true,live_release_id=? WHERE api_id=?", pending.get("id").asText(), id);
        for (String releaseStatus : List.of("PENDING", "REJECTED", "FAILED")) {
            jdbc.update("UPDATE publication_release SET status=? WHERE id=?", releaseStatus, pending.get("id").asText());
            assertThat(send(get("/public-api/documents").param("service", service)).get("total").asInt()).isZero();
            assertThat(send(get("/public-api/documents/categories").param("service", service)).get("total").asInt()).isZero();
            mvc.perform(get(path + "/view")).andExpect(status().isNotFound());
            mvc.perform(get(path + "/export").param("format", "JSON").param("releaseId", pending.get("id").asText())
                    .param("stateVersion", "1")).andExpect(status().isNotFound());
        }
    }

    @Test
    void mcpBadgesAndFilterFollowEffectiveReleaseAndVisibility() throws Exception {
        String service = "mcpcatalog_" + UUID.randomUUID().toString().replace("-", "");
        String publicCode = scope(), privateCode = scope();
        jdbc.update("UPDATE access_scope SET public_access=true WHERE code=?", publicCode);
        ObjectNode mcp = draft(service, "v1", "tool", "MCP公共", List.of(publicCode));
        mcp.put("operationKind", "QUERY");
        mcp.putObject("mcpTool").put("enabled", true).put("aiDescription", "查询演示订单");
        String apiId = publish(mcp);
        publish(draft(service, "v1", "ordinary", "MCP公共", List.of(publicCode)));
        ObjectNode hidden = draft(service, "v1", "private", "MCP专属", List.of(privateCode));
        hidden.put("operationKind", "QUERY");
        hidden.putObject("mcpTool").put("enabled", true).put("aiDescription", "专属工具");
        publish(hidden);
        JsonNode result = send(get("/public-api/documents").param("service", service).param("mcpOnly", "true"));
        assertThat(result.get("total").asInt()).isEqualTo(1);
        assertThat(result.at("/items/0/mcpSupported").asBoolean()).isTrue();
        assertThat(send(get("/public-api/documents/categories").param("service", service).param("mcpOnly", "true")).at("/items/0/apiCount").asInt()).isEqualTo(1);
        String path = "/public-api/documents/" + service + "/v1/tool/view";
        assertThat(send(get(path)).at("/document/mcp/name").asText()).isEqualTo(service + "_tool_v1");
        // 只改草稿，不发布：门户继续展示生效快照的MCP能力。
        ObjectNode changed = mcp.deepCopy();
        changed.put("expectedRevision", 1);
        changed.putObject("mcpTool").put("enabled", false);
        send(auth(put("/admin-api/apis/" + apiId).content(changed.toString())));
        assertThat(send(get(path)).at("/document/mcp/name").asText()).isEqualTo(service + "_tool_v1");
        assertThat(send(get("/public-api/documents").param("service", service).param("mcpOnly", "true")).get("total").asInt()).isEqualTo(1);
    }

    private void token(List<String> scopes) {
        when(tokens.verify("document-token")).thenReturn(new TokenContext("t", "a", "ak", "tenant", null, null, null, scopes, Instant.now().plusSeconds(300)));
    }

    private String scope() throws Exception {
        String code = "doc_" + UUID.randomUUID().toString().replace("-", "");
        send(auth(post("/admin-api/scopes").content("{\"code\":\"" + code + "\",\"name\":\"文档\",\"enabled\":true,\"defaultForNewApplication\":false}")));
        return code;
    }

    private String publish(ObjectNode body) throws Exception {
        String id = send(auth(post("/admin-api/apis").content(body.toString()))).get("id").asText();
        String release = send(auth(post("/admin-api/publications/apis/" + id + "/submissions")
                .content("{\"expectedDraftRevision\":1,\"expectedStateVersion\":0,\"submissionKey\":\"" + UUID.randomUUID() + "\",\"comment\":\"文档发布\"}"))).get("id").asText();
        send(auth(post("/admin-api/publications/" + release + "/approve").content("{\"comment\":\"通过\"}")));
        return id;
    }

    private ObjectNode draft(String service, String version, String method, String category, List<String> codes) {
        if (managedCategories.availableNames(List.of(category),false).isEmpty()) managedCategories.create(new io.github.chenyilei2016.openplatform.domain.catalog.ApiCategory(io.github.chenyilei2016.openplatform.domain.common.ObjectIdType.API_CATEGORY.nextId(),category,true,1));
        var body = (ObjectNode) json.readTree("""
                {"name":"生效订单","owner":"内部研发","requestSchema":{"type":"OBJECT"},"responseSchema":{"type":"OBJECT"},
                 "errorDefinitions":[],"binding":{"protocol":"HTTP","timeoutMillis":3000,"http":{"url":"https://internal.example/query","method":"POST"}},"mappings":[]}
                """);
        body.put("service", service).put("version", version).put("method", method).put("category", category);
        codes.forEach(body.putArray("scopeCodes")::add);
        return body;
    }

    private MockHttpServletRequestBuilder auth(MockHttpServletRequestBuilder request) {
        return request.session(io.github.chenyilei2016.openplatform.testing.TestSessions.session("test-session"))
                .header("X-CSRF-Token", "76832d7fdbcdbf4a72129f8b7def9016").contentType("application/json");
    }

    private MockHttpServletRequestBuilder customer(MockHttpServletRequestBuilder request) {
        return request.header("Authorization", "Bearer document-token");
    }

    private JsonNode send(MockHttpServletRequestBuilder request) throws Exception {
        var result = mvc.perform(request).andExpect(status().isOk()).andReturn();
        return json.readTree(result.getResponse().getContentAsString()).get("data");
    }
}
