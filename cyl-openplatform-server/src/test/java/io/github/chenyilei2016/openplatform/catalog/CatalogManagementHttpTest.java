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
        "spring.sql.init.schema-locations=classpath:db/h2-functions.sql,classpath:db/access-schema.sql,classpath:db/mcp-schema.sql,classpath:db/catalog-schema.sql,classpath:db/dubbo-connection-schema.sql,classpath:db/token-schema.sql,classpath:db/publication-schema.sql,classpath:db/governance-schema.sql,classpath:db/observability-schema.sql,classpath:db/operations-metrics-schema.sql,classpath:db/administrator-schema.sql",

        "test.admin.operators[0].tenant-id=tenant-1",
        "test.admin.operators[0].employee-no=operator-1",
        "test.admin.operators[0].permissions[0]=MANAGE_APIS",
        "test.admin.operators[0].permissions[1]=MANAGE_APPLICATIONS",
        "test.admin.operators[0].permissions[2]=MANAGE_CONNECTIONS",
        "test.admin.operators[1].tenant-id=tenant-1",
        "test.admin.operators[1].employee-no=author",
        "test.admin.operators[1].permissions[0]=MANAGE_APIS",
        "test.admin.operators[2].tenant-id=tenant-1",
        "test.admin.operators[2].employee-no=viewer",
        "test.admin.operators[2].permissions[0]=VIEW_AUDIT"
})
@AutoConfigureMockMvc(print = MockMvcPrint.NONE)
class CatalogManagementHttpTest {
    @Autowired MockMvc mvc;
    @Autowired org.springframework.jdbc.core.JdbcTemplate database;
    @Autowired io.github.chenyilei2016.openplatform.application.catalog.ApiCatalogService catalog;
    @Autowired org.springframework.transaction.PlatformTransactionManager transactions;
    @Autowired io.github.chenyilei2016.openplatform.application.publication.PublicationService publications;
    @MockitoBean AccountAuthentication identityService;
    @org.springframework.test.context.bean.override.mockito.MockitoSpyBean
    io.github.chenyilei2016.openplatform.domain.access.ScopeRepository scopeRepository;
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
    void unsavedValidationReportsTheSameFieldsAsSaveWithoutCreatingADraft() throws Exception {
        ObjectNode body = draft().put("name", "");
        ((ObjectNode) body.at("/binding/http")).put("url", "not-a-url");
        JsonNode validation = send(post("/admin-api/apis/validate").content(body.toString()));
        assertThat(validation.path("valid").asBoolean()).isFalse();
        assertThat(java.util.stream.StreamSupport.stream(validation.path("fieldIssues").spliterator(), false)
                .map(issue -> issue.path("path").asText()).toList())
                .contains("/name", "/binding/http/url");
        String rejected = mvc.perform(auth(post("/admin-api/apis").content(body.toString())))
                .andExpect(status().isBadRequest()).andReturn().getResponse().getContentAsString();
        assertThat(json.readTree(rejected).at("/data/fieldIssues")).isEqualTo(validation.path("fieldIssues"));
        assertThat(send(get("/admin-api/apis").param("query", body.path("service").asText())).path("total").asInt()).isZero();
    }

    @Test
    void copiedServiceMethodSearchUsesDatabasePagingAndLiteralMatching() throws Exception {
        ObjectNode body = draft();
        String service = "s" + UUID.randomUUID().toString().replace("-", "") + "x".repeat(31);
        String method = "m".repeat(64);
        body.put("service", service).put("method", method);
        send(post("/admin-api/apis").content(body.toString()));
        body.put("version", "v2");
        send(post("/admin-api/apis").content(body.toString()));
        JsonNode page = send(get("/admin-api/apis").param("query", service + "." + method).param("pageSize", "1"));
        assertThat(page.get("total").asLong()).isEqualTo(2);
        assertThat(page.get("items").size()).isEqualTo(1);
        assertThat(page.at("/items/0/service").asText()).isEqualTo(service);
        assertThat(send(get("/admin-api/apis").param("query", service + "." + method).param("page", "2").param("pageSize", "1"))
                .at("/items/0/id").asText()).isNotEqualTo(page.at("/items/0/id").asText());
        assertThat(send(get("/admin-api/apis").param("query", service + ".%")).get("total").asLong()).isZero();
        assertThat(send(get("/admin-api/apis").param("query", service + "." + method).param("protocol", "DUBBO"))
                .get("total").asLong()).isZero();
        mvc.perform(auth(get("/admin-api/apis").param("query", "s".repeat(130)))).andExpect(status().isBadRequest());
    }

    @Test
    void internalClassAndMethodFiltersUseDatabasePagingAndLiteralMatching() throws Exception {
        String simple = "Search_" + UUID.randomUUID().toString().replace("-", "");
        for (String prefix : java.util.List.of("com.first.", "com.second.")) {
            ObjectNode body = draft();
            ((ObjectNode) body.at("/binding/http")).put("sourceClass", prefix + simple).put("sourceMethod", "find_order");
            send(post("/admin-api/apis").content(body.toString()));
        }
        JsonNode first = send(get("/admin-api/apis").param("internalClass", simple).param("internalMatch", "EXACT").param("pageSize", "1"));
        assertThat(first.path("total").asInt()).isEqualTo(2);
        assertThat(first.path("items").size()).isEqualTo(1);
        assertThat(first.at("/items/0/internalClass").asText()).endsWith(simple);
        JsonNode second = send(get("/admin-api/apis").param("internalClass", "com.first." + simple).param("internalMatch", "EXACT"));
        assertThat(second.path("total").asInt()).isEqualTo(1);
        String id = second.at("/items/0/id").asText();
        assertThat(send(get("/admin-api/apis").param("internalClass", simple).param("internalMethod", "find_order")).path("total").asInt()).isEqualTo(2);
        assertThat(send(get("/admin-api/apis").param("internalClass", "%")).path("total").asInt()).isZero();
        ObjectNode update = (ObjectNode) send(get("/admin-api/apis/" + id));
        update.remove(java.util.List.of("id", "protocol", "draftRevision")); update.put("expectedRevision", 1);
        ((ObjectNode) update.at("/binding/http")).putNull("sourceClass").put("sourceMethod", "changed");
        send(put("/admin-api/apis/" + id).content(update.toString()));
        assertThat(send(get("/admin-api/apis").param("internalClass", "com.first." + simple).param("internalMatch", "EXACT")).path("total").asInt()).isZero();
        assertThat(send(get("/admin-api/apis").param("internalMethod", "find").param("internalMatch", "EXACT")).path("total").asInt()).isZero();
        assertThat(send(get("/admin-api/apis").param("internalMethod", "changed")).path("total").asInt()).isGreaterThanOrEqualTo(1);
        send(post("/admin-api/apis/" + id + "/revisions/1/restore").content("{\"expectedRevision\":2}"));
        JsonNode restored = send(get("/admin-api/apis").param("internalClass", "com.first." + simple).param("internalMatch", "EXACT"));
        assertThat(restored.path("total").asInt()).isEqualTo(1);
        assertThat(restored.at("/items/0/id").asText()).isEqualTo(id);
        assertThat(restored.at("/items/0/internalMethod").asText()).isEqualTo("find_order");
    }

    @Test
    void listSortsByCurrentRevisionTimeOrNameAndReportsUpdatedAt() throws Exception {
        String marker = "排序样例" + UUID.randomUUID().toString().substring(0, 8);
        ObjectNode first = draft(); first.put("name", marker + "-B");
        String firstId = send(post("/admin-api/apis").content(first.toString())).path("id").asText();
        ObjectNode second = draft(); second.put("name", marker + "-A");
        String secondId = send(post("/admin-api/apis").content(second.toString())).path("id").asText();
        // 再次保存第一条，使其成为最近更新。
        ObjectNode update = (ObjectNode) send(get("/admin-api/apis/" + firstId));
        update.remove(java.util.List.of("id", "protocol", "draftRevision")); update.put("expectedRevision", 1).put("name", marker + "-C");
        send(put("/admin-api/apis/" + firstId).content(update.toString()));
        JsonNode recent = send(get("/admin-api/apis").param("query", marker).param("sort", "UPDATED_DESC"));
        assertThat(recent.at("/items/0/id").asText()).isEqualTo(firstId);
        assertThat(recent.at("/items/0/updatedAt").asText()).isNotBlank();
        assertThat(send(get("/admin-api/apis").param("query", marker).param("sort", "UPDATED_ASC")).at("/items/0/id").asText()).isEqualTo(secondId);
        assertThat(send(get("/admin-api/apis").param("query", marker).param("sort", "NAME_ASC")).at("/items/0/id").asText()).isEqualTo(secondId);
        assertThat(send(get("/admin-api/apis").param("query", marker).param("sort", "NAME_DESC")).at("/items/0/id").asText()).isEqualTo(firstId);
        mvc.perform(auth(get("/admin-api/apis").param("sort", "DROP TABLE"))).andExpect(status().isBadRequest());
    }

    @Test
    void ownerFiltersUseStableProfileAndCombineWithOtherDimensions() throws Exception {
        ObjectNode body = draft(); body.put("name", "人员检索唯一字样");
        JsonNode created = send(post("/admin-api/apis").content(body.toString()));
        String owner = created.path("owner").asText();
        ObjectNode other = draft(); other.put("name", "人员检索唯一字样");
        send(post("/admin-api/apis").content(other.toString()));
        JsonNode exact = send(get("/admin-api/apis").param("query", "人员检索唯一字样").param("ownerId", owner));
        assertThat(exact.path("total").asInt()).isEqualTo(2);
        assertThat(exact.at("/items/0/owner").asText()).isEqualTo(owner);
        assertThat(send(get("/admin-api/apis").param("query", "绝不匹配").param("ownerId", owner)).path("total").asInt()).isZero();
        assertThat(send(get("/admin-api/apis").param("query", "人员检索唯一字样").param("ownerId", "EMP_11111111111111111111111111111111")).path("total").asInt()).isZero();
    }

    @Test
    void candidateValidationKeepsSavedRevisionAndWorkspaceUsesPublicationBaseline() throws Exception {
        ObjectNode body = draft();
        ((ObjectNode) body.at("/binding/http")).put("url", "http://127.0.0.1:9/no-provider");
        assertThat(send(post("/admin-api/apis/validate").content(body.toString())).path("valid").asBoolean()).isTrue();
        String id = send(post("/admin-api/apis").content(body.toString())).path("id").asText();
        body.put("expectedRevision", 1).put("name", "未保存输入");
        JsonNode result = send(post("/admin-api/apis/" + id + "/validate").content(body.toString()));
        assertThat(result.path("valid").asBoolean()).isTrue();
        assertThat(result.path("checkedDraftRevision").asLong()).isEqualTo(1);
        JsonNode workspace = send(get("/admin-api/apis/" + id + "/workspace"));
        assertThat(workspace.at("/definition/name").asText()).isEqualTo("订单查询");
        assertThat(workspace.at("/definition/draftRevision").asLong()).isEqualTo(1);
        assertThat(workspace.at("/publication/stateVersion").asLong()).isZero();
        assertThat(workspace.path("liveDraftRevision").isNull()).isTrue();
        assertThat(send(get("/admin-api/apis/" + id + "/revisions")).path("total").asInt()).isEqualTo(1);
        send(put("/admin-api/apis/" + id).content(body.toString()));
        mvc.perform(auth(post("/admin-api/apis/" + id + "/validate").content(body.toString())))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.data").doesNotExist());
        mvc.perform(post("/admin-api/apis/" + id + "/validate").contentType("application/json").content(body.toString()))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void validationLocatesNestedTypesAndReferencesWithoutEchoingInput() throws Exception {
        ObjectNode body = draft();
        ((ObjectNode) body.at("/requestSchema/properties/orderId")).put("example", 42);
        JsonNode result = send(post("/admin-api/apis/validate").content(body.toString()));
        assertThat(result.at("/fieldIssues/0/path").asText()).isEqualTo("/requestSchema/properties/orderId/example");
        ((ObjectNode) body.at("/requestSchema/properties/orderId")).put("example", "ok");
        body.put("employeeRequired", "SECRET_SHOULD_NOT_APPEAR");
        String rejected = mvc.perform(auth(post("/admin-api/apis/validate").content(body.toString())))
                .andExpect(status().isBadRequest()).andReturn().getResponse().getContentAsString();
        assertThat(json.readTree(rejected).at("/data/fieldIssues/0/path").asText()).isEqualTo("/employeeRequired");
        assertThat(rejected).doesNotContain("SECRET_SHOULD_NOT_APPEAR");
        body.put("employeeRequired", false).putArray("scopeCodes").add("absent_scope");
        result = send(post("/admin-api/apis/validate").content(body.toString()));
        assertThat(result.at("/fieldIssues/0/path").asText()).isEqualTo("/scopeCodes");
        assertThat(result.at("/fieldIssues/0/reason").asText()).isEqualTo("REFERENCE_UNAVAILABLE");
    }

    @Test
    void employeeRequirementNormalizesDefaultsAndSurvivesHistoryPreviewAndRestore() throws Exception {
        ObjectNode body = draft();
        JsonNode created = send(post("/admin-api/apis").content(body.toString()));
        String id = created.get("id").asText();
        assertThat(created.get("employeeRequired").asBoolean()).isFalse();
        body.put("expectedRevision", 1).putNull("employeeRequired");
        assertThat(send(put("/admin-api/apis/" + id).content(body.toString())).get("changed").asBoolean()).isFalse();
        body.put("employeeRequired", true);
        JsonNode changed = send(put("/admin-api/apis/" + id).content(body.toString()));
        assertThat(changed.get("draftRevision").asLong()).isEqualTo(2);
        assertThat(send(get("/admin-api/apis/" + id + "/preview")).get("employeeRequired").asBoolean()).isTrue();
        assertThat(send(get("/admin-api/apis/" + id + "/revisions/2")).at("/snapshot/employeeRequired").asBoolean()).isTrue();
        body.put("expectedRevision", 2).put("employeeRequired", "true");
        mvc.perform(auth(put("/admin-api/apis/" + id).content(body.toString()))).andExpect(status().isBadRequest());
        body.put("employeeRequired", false);
        send(put("/admin-api/apis/" + id).content(body.toString()));
        send(post("/admin-api/apis/" + id + "/revisions/2/restore").content("{\"expectedRevision\":3}"));
        assertThat(send(get("/admin-api/apis/" + id)).get("employeeRequired").asBoolean()).isTrue();
    }

    @Test
    void revisionHistoryIsImmutablePagedAndScopedToApiMaintenancePermission() throws Exception {
        ObjectNode body = draft().put("description", "第一版说明");
        JsonNode created = send(post("/admin-api/apis").content(body.toString()));
        String id = created.get("id").asText();
        body.put("expectedRevision", 1).put("name", "第二版名称");
        send(put("/admin-api/apis/" + id).content(body.toString()));
        body.put("expectedRevision", 2);
        send(put("/admin-api/apis/" + id).content(body.toString()));
        JsonNode page = send(get("/admin-api/apis/" + id + "/revisions").param("pageSize", "1"));
        assertThat(page.get("total").asInt()).isEqualTo(2);
        assertThat(page.at("/items/0/revision").asLong()).isEqualTo(2);
        assertThat(page.at("/items/0/source").asText()).isEqualTo("UPDATE_API_DRAFT");
        assertThat(page.at("/items/0/summary").asText()).isEqualTo("编辑保存");
        assertThat(page.at("/items/0/operatorEmployeeNo").asText()).isEqualTo("operator-1");
        assertThat(page.at("/items/0/contentDigest").asText()).hasSize(64);
        assertThat(page.at("/items/0/digestVersion").asText()).isEqualTo("snapshot-json-sha256-v1");
        assertThat(page.at("/items/0").has("snapshot")).isFalse();
        assertThat(page.toString()).doesNotContain("internal.example", "第一版说明");
        JsonNode firstPage = send(get("/admin-api/apis/" + id + "/revisions").param("page", "2").param("pageSize", "1"));
        assertThat(firstPage.at("/items/0/revision").asLong()).isEqualTo(1);
        JsonNode first = send(get("/admin-api/apis/" + id + "/revisions/1"));
        assertThat(first.get("snapshot")).isEqualTo(created);
        assertThat(first.get("source").asText()).isEqualTo("CREATE_API_DRAFT");
        assertThat(first.get("historyStart").asBoolean()).isFalse();
        // GET仅需登录身份，不要求写操作CSRF头。
        mvc.perform(get("/admin-api/apis/" + id + "/revisions/1").session(io.github.chenyilei2016.openplatform.testing.TestSessions.session("test-session")))
                .andExpect(status().isOk());
        mvc.perform(auth(get("/admin-api/apis/" + id + "/revisions/3"))).andExpect(status().isNotFound());
        mvc.perform(auth(get("/admin-api/apis/" + id + "/revisions/0"))).andExpect(status().isBadRequest());
        mvc.perform(auth(get("/admin-api/apis/" + id + "/revisions").param("pageSize", "101")))
                .andExpect(status().isBadRequest());
        mvc.perform(auth(get("/admin-api/apis/absent/revisions/1"))).andExpect(status().isNotFound());
        mvc.perform(auth(get("/admin-api/apis/absent/revisions"))).andExpect(status().isNotFound());
        mvc.perform(get("/admin-api/apis/" + id + "/revisions")).andExpect(status().isUnauthorized());
        TestAccount viewer = new TestAccount();
        viewer.setId(13L); viewer.setTenantId("tenant-1"); viewer.setEmployeeNoStr("viewer");
        when(identityService.current("test-session")).thenAnswer(invocation -> viewer.toAccount());
        mvc.perform(auth(get("/admin-api/apis/" + id + "/revisions"))).andExpect(status().isForbidden());
        mvc.perform(auth(get("/admin-api/apis/" + id + "/revisions/1"))).andExpect(status().isForbidden());
    }

    @Test
    void legacyDraftKeepsExplicitBaselineAndTransactionRollbackCannotLeaveHistory() throws Exception {
        ObjectNode body = draft();
        String id = send(post("/admin-api/apis").content(body.toString())).get("id").asText();
        // 仅删除此测试新建对象的归档，以复现上线前已有草稿的缺失历史状态。
        database.update("DELETE FROM catalog_api_revision WHERE api_id=?", id);
        body.put("expectedRevision", 1).put("name", "旧稿首次更新");
        send(put("/admin-api/apis/" + id).content(body.toString()));
        JsonNode baseline = send(get("/admin-api/apis/" + id + "/revisions/1"));
        assertThat(baseline.get("source").asText()).isEqualTo("HISTORY_BASELINE");
        assertThat(baseline.get("historyStart").asBoolean()).isTrue();
        assertThat(baseline.path("operatorEmployeeNo").isNull() || baseline.path("operatorEmployeeNo").isMissingNode()).isTrue();
        assertThat(baseline.at("/snapshot/name").asText()).isEqualTo("订单查询");
        ObjectNode next = (ObjectNode) send(get("/admin-api/apis/" + id));
        next.put("draftRevision", 3).put("name", "事务必须回滚");
        io.github.chenyilei2016.openplatform.domain.catalog.ApiDefinition definition = json.treeToValue(next,
                io.github.chenyilei2016.openplatform.domain.catalog.ApiDefinition.class);
        new org.springframework.transaction.support.TransactionTemplate(transactions).executeWithoutResult(status -> {
            catalog.update(definition, 2, "tenant-1", "operator-1", "history-rollback-test");
            status.setRollbackOnly();
        });
        assertThat(send(get("/admin-api/apis/" + id)).get("draftRevision").asLong()).isEqualTo(2);
        assertThat(send(get("/admin-api/apis/" + id + "/revisions")).get("total").asInt()).isEqualTo(2);
        assertThat(database.queryForObject("SELECT COUNT(*) FROM catalog_audit WHERE api_id=?", Long.class, id)).isEqualTo(2);
    }

    @Test
    void restoresFullHistoricalContentWithoutChangingPendingReleaseOrDisabledState() throws Exception {
        String code = "restore_" + UUID.randomUUID().toString().replace("-", "");
        send(post("/admin-api/scopes").content("{\"code\":\"" + code
                + "\",\"name\":\"历史恢复组\",\"enabled\":true,\"defaultForNewApplication\":false}"));
        ObjectNode body = draft();
        body.putArray("scopeCodes").add(code);
        JsonNode original = send(post("/admin-api/apis").content(body.toString()));
        String id = original.get("id").asText();
        body.put("expectedRevision", 1).put("name", "修改后名称").put("description", "后补接口说明")
                .put("category", "新分类").put("owner", "新负责人");
        ((ObjectNode) body.at("/requestSchema/properties/orderId")).put("example", "NEW-ORDER");
        send(put("/admin-api/apis/" + id).content(body.toString()));
        io.github.chenyilei2016.openplatform.domain.access.AccessOperator operator =
                new io.github.chenyilei2016.openplatform.domain.access.AccessOperator("tenant-1", "operator-1", "restore-test", null, null);
        publications.submit(id, 2, 0, UUID.randomUUID().toString(), "保持原发布记录", operator);
        io.github.chenyilei2016.openplatform.domain.publication.PublicationState state = publications.state(id);
        state = publications.status(id, false, state.stateVersion(), "保持独立停用", operator);
        String restore = "/admin-api/apis/" + id + "/revisions/1/restore";
        JsonNode result = send(post(restore).content("{\"expectedRevision\":2}"));
        assertThat(result.get("changed").asBoolean()).isTrue();
        ObjectNode expected = ((ObjectNode) original).deepCopy().put("draftRevision", 3);
        assertThat(send(get("/admin-api/apis/" + id))).isEqualTo(expected);
        assertThat(publications.state(id)).isEqualTo(state);
        JsonNode history = send(get("/admin-api/apis/" + id + "/revisions/3"));
        assertThat(history.get("source").asText()).isEqualTo("RESTORE_API_DRAFT");
        assertThat(history.get("restoredFromRevision").asLong()).isEqualTo(1);
        assertThat(history.get("summary").asText()).isEqualTo("从 r1 恢复草稿");
        assertThat(history.get("snapshot")).isEqualTo(expected);
        assertThat(send(get("/admin-api/apis/" + id + "/revisions/1")).get("snapshot")).isEqualTo(original);
        JsonNode unchanged = send(post(restore).content("{\"expectedRevision\":3}"));
        assertThat(unchanged.get("changed").asBoolean()).isFalse();
        assertThat(unchanged.get("draftRevision").asLong()).isEqualTo(3);
        assertThat(database.queryForObject("SELECT COUNT(*) FROM catalog_api_revision WHERE api_id=?", Long.class, id)).isEqualTo(3);
        assertThat(database.queryForObject("SELECT COUNT(*) FROM catalog_audit WHERE api_id=? AND action='RESTORE_API_DRAFT'", Long.class, id)).isEqualTo(1);
        mvc.perform(auth(post(restore).content("{\"expectedRevision\":2}"))).andExpect(status().isConflict());
        mvc.perform(auth(post(restore).content("{\"expectedRevision\":0}"))).andExpect(status().isBadRequest());
        mvc.perform(auth(post(restore).content("{\"expectedRevision\":9223372036854775807}"))).andExpect(status().isBadRequest());
        mvc.perform(auth(post("/admin-api/apis/" + id + "/revisions/99/restore").content("{\"expectedRevision\":3}")))
                .andExpect(status().isNotFound());
        mvc.perform(post(restore).session(io.github.chenyilei2016.openplatform.testing.TestSessions.session("test-session")).contentType("application/json")
                .content("{\"expectedRevision\":3}")).andExpect(status().isForbidden());
        database.update("UPDATE access_scope SET enabled=FALSE WHERE code=?", code);
        mvc.perform(auth(post(restore).content("{\"expectedRevision\":3}"))).andExpect(status().isBadRequest());
        assertThat(publications.state(id)).isEqualTo(state);
        assertThat(send(get("/admin-api/apis/" + id))).isEqualTo(expected);
        TestAccount viewer = new TestAccount();
        viewer.setId(13L); viewer.setTenantId("tenant-1"); viewer.setEmployeeNoStr("viewer");
        when(identityService.current("test-session")).thenAnswer(invocation -> viewer.toAccount());
        mvc.perform(auth(post(restore).content("{\"expectedRevision\":3}"))).andExpect(status().isForbidden());
    }

    @Test
    void unchangedSaveKeepsFlatResponseRevisionStoredContentAndAudit() throws Exception {
        ObjectNode body = draft();
        String firstCode = "first_" + UUID.randomUUID().toString().replace("-", "");
        String secondCode = "second_" + UUID.randomUUID().toString().replace("-", "");
        for (String code : java.util.List.of(firstCode, secondCode)) {
            send(post("/admin-api/scopes").content("{\"code\":\"" + code
                    + "\",\"name\":\"保存比较组\",\"enabled\":true,\"defaultForNewApplication\":false}"));
        }
        body.putArray("scopeCodes").add(firstCode).add(secondCode);
        ObjectNode fixed = body.putArray("mappings").addObject().put("target", "payload").put("source", "FIXED");
        fixed.putObject("value").put("amount", new java.math.BigDecimal("123.1234567890123456789"))
                .put("id", new java.math.BigInteger("9007199254740993"));
        JsonNode created = send(post("/admin-api/apis").content(body.toString()));
        String id = created.get("id").asText();
        String stored = database.queryForObject("SELECT definition_json FROM catalog_api_draft WHERE id=?", String.class, id);
        java.sql.Timestamp auditedAt = database.queryForObject("SELECT occurred_at FROM catalog_audit WHERE api_id=?", java.sql.Timestamp.class, id);
        body.put("expectedRevision", 1);
        body.putArray("scopeCodes").add(secondCode).add(firstCode);
        fixed.putObject("value").put("id", new java.math.BigInteger("9007199254740993"))
                .put("amount", new java.math.BigDecimal("123.1234567890123456789"));
        JsonNode saved = send(put("/admin-api/apis/" + id).content(body.toPrettyString()));
        assertThat(saved.get("changed").asBoolean()).isFalse();
        assertThat(saved.get("id").asText()).isEqualTo(id);
        assertThat(saved.get("draftRevision").asLong()).isEqualTo(1);
        assertThat(saved.has("definition")).isFalse();
        assertThat(saved.size()).isEqualTo(created.size() + 1);
        assertThat(database.queryForObject("SELECT definition_json FROM catalog_api_draft WHERE id=?", String.class, id)).isEqualTo(stored);
        assertThat(database.queryForObject("SELECT COUNT(*) FROM catalog_audit WHERE api_id=?", Long.class, id)).isEqualTo(1);
        assertThat(database.queryForObject("SELECT occurred_at FROM catalog_audit WHERE api_id=?", java.sql.Timestamp.class, id)).isEqualTo(auditedAt);
        body.put("name", "真正的新内容");
        JsonNode changed = send(put("/admin-api/apis/" + id).content(body.toString()));
        assertThat(changed.get("changed").asBoolean()).isTrue();
        assertThat(changed.get("draftRevision").asLong()).isEqualTo(2);
        // 过期页面即使提交的内容已与当前草稿相同，也必须冲突。
        mvc.perform(auth(put("/admin-api/apis/" + id).content(body.toString()))).andExpect(status().isConflict());
        body.put("expectedRevision", 2);
        assertThat(send(put("/admin-api/apis/" + id).content(body.toString())).get("changed").asBoolean()).isFalse();
        assertThat(database.queryForObject("SELECT COUNT(*) FROM catalog_audit WHERE api_id=?", Long.class, id)).isEqualTo(2);
    }

    @Test
    void schemaDisplayOrderArraysNullEmptyAndPreciseNumbersRemainContentChanges() throws Exception {
        ObjectNode body = draft();
        ObjectNode properties = (ObjectNode) body.at("/requestSchema/properties");
        properties.putObject("count").put("type", "INTEGER");
        ObjectNode fixed = body.putArray("mappings").addObject().put("target", "payload").put("source", "FIXED");
        fixed.putObject("value").putArray("ordered").add(1).add(2);
        String id = send(post("/admin-api/apis").content(body.toString())).get("id").asText();
        body.put("expectedRevision", 1);
        ObjectNode reordered = json.createObjectNode();
        reordered.set("count", properties.get("count")); reordered.set("orderId", properties.get("orderId"));
        ((ObjectNode) body.get("requestSchema")).set("properties", reordered);
        assertThat(send(put("/admin-api/apis/" + id).content(body.toString())).get("changed").asBoolean()).isTrue();
        body.put("expectedRevision", 2);
        ((ObjectNode) fixed.get("value")).putArray("ordered").add(2).add(1);
        assertThat(send(put("/admin-api/apis/" + id).content(body.toString())).get("draftRevision").asLong()).isEqualTo(3);
        body.put("expectedRevision", 3);
        ((ObjectNode) fixed.get("value")).putNull("optional");
        assertThat(send(put("/admin-api/apis/" + id).content(body.toString())).get("draftRevision").asLong()).isEqualTo(4);
        body.put("expectedRevision", 4);
        ((ObjectNode) fixed.get("value")).put("optional", "");
        assertThat(send(put("/admin-api/apis/" + id).content(body.toString())).get("draftRevision").asLong()).isEqualTo(5);
        body.put("expectedRevision", 5);
        ((ObjectNode) fixed.get("value")).put("number", new java.math.BigDecimal("1.00000000000000000001"));
        assertThat(send(put("/admin-api/apis/" + id).content(body.toString())).get("draftRevision").asLong()).isEqualTo(6);
        body.put("expectedRevision", 6);
        ((ObjectNode) fixed.get("value")).put("number", new java.math.BigDecimal("1.00000000000000000002"));
        assertThat(send(put("/admin-api/apis/" + id).content(body.toString())).get("draftRevision").asLong()).isEqualTo(7);
    }

    @Test
    void strictEditorValidationPreservesPrecisionAndRejectsAmbiguousOrOversizeInput() throws Exception {
        String value = "{\"integer\":9007199254740993,\"decimal\":123.1234567890123456789,\"nil\":null}";
        String normalized = mvc.perform(auth(post("/admin-api/apis/validate-json").content(value)))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        assertThat(normalized).contains("9007199254740993", "123.1234567890123456789", "\"nil\":null");
        for (String invalid : java.util.List.of("{\"a\":1,\"a\":2}", "{} []", "null true", "", "[1,]")) {
            mvc.perform(auth(post("/admin-api/apis/validate-json").content(invalid))).andExpect(status().isBadRequest());
        }
        mvc.perform(auth(post("/admin-api/apis/validate-json").content(" ".repeat(262_145))))
                .andExpect(status().isPayloadTooLarge());
        mvc.perform(post("/admin-api/apis/validate-json").contentType("application/json").content("{}"))
                .andExpect(status().isUnauthorized());
        mvc.perform(auth(post("/admin-api/apis/validate-json?kind=schema&request=true")
                .content("{\"type\":\"STRING\"}"))).andExpect(status().isBadRequest());
        mvc.perform(auth(post("/admin-api/apis/validate-json?kind=schema")
                .content("{\"type\":\"INTEGER\",\"example\":1.5}"))).andExpect(status().isBadRequest());
        mvc.perform(auth(post("/admin-api/apis/validate-json?kind=schema")
                .content("{\"type\":\"STRING\",\"typo\":true}"))).andExpect(status().isBadRequest());
        for (String invalidSchema : java.util.List.of("{\"type\":0}", "{\"type\":\"OBJECT\",\"required\":1}",
                "{\"type\":\"OBJECT\",\"required\":\"false\"}", "{\"type\":\"STRING\",\"description\":123}")) {
            mvc.perform(auth(post("/admin-api/apis/validate-json?kind=schema").content(invalidSchema)))
                    .andExpect(status().isBadRequest());
        }
        JsonNode schema = send(post("/admin-api/apis/validate-json?kind=schema&request=true")
                .content("{\"type\":\"OBJECT\",\"properties\":{\"count\":{\"type\":\"INTEGER\",\"example\":9007199254740993}}}"));
        assertThat(schema.at("/properties/count/example").asText()).isEqualTo("9007199254740993");
    }

    @Test
    void descriptionIsExplicitlyPreservedAndCatalogFiltersRunBeforePagination() throws Exception {
        ObjectNode body = draft().put("description", "查询订单\n包含公开字段说明");
        String category = "分类_" + UUID.randomUUID();
        send(post("/admin-api/api-categories").content(json.createObjectNode().put("name",category).toString()));
        body.put("category", category);
        JsonNode created = send(post("/admin-api/apis").content(body.toString()));
        String id = created.get("id").asText();
        assertThat(send(get("/admin-api/apis/" + id + "/preview")).get("description").asText())
                .isEqualTo(body.get("description").asText());
        body.remove("description"); body.put("expectedRevision", 1);
        mvc.perform(auth(put("/admin-api/apis/" + id).content(body.toString()))).andExpect(status().isBadRequest());
        assertThat(send(get("/admin-api/apis/" + id)).get("draftRevision").asInt()).isEqualTo(1);
        JsonNode selected = send(get("/admin-api/apis").param("category", category).param("protocol", "HTTP", "DUBBO")
                .param("review", "NOT_SUBMITTED", "APPROVED").param("publication", "UNPUBLISHED")
                .param("access", "DISABLED").param("pageSize", "1"));
        assertThat(selected.get("total").asLong()).isEqualTo(1);
        assertThat(selected.at("/items/0/latestReviewStatus").asText()).isEqualTo("NOT_SUBMITTED");
        assertThat(send(get("/admin-api/apis").param("category", category).param("publication", "PUBLISHED"))
                .get("total").asLong()).isZero();
        assertThat(send(get("/admin-api/apis/categories").param("query", category)).at("/items/0").asText()).isEqualTo(category);
        mvc.perform(auth(get("/admin-api/apis").param("review", "invalid"))).andExpect(status().isBadRequest());
        ObjectNode invalid = body.deepCopy().put("description", "");
        ((ObjectNode) invalid.get("requestSchema")).put("required", 1);
        mvc.perform(auth(put("/admin-api/apis/" + id).content(invalid.toString()))).andExpect(status().isBadRequest());
        body.put("description", "");
        assertThat(send(put("/admin-api/apis/" + id).content(body.toString())).get("description").asText()).isEmpty();
    }

    @Test
    void createsHttpDraftAndGeneratesControlledDocumentFromTheSameContract() throws Exception {
        String body = definition("orders_" + UUID.randomUUID().toString().replace("-", ""));
        JsonNode created = send(post("/admin-api/apis").content(body));
        String id = created.get("id").asText();
        assertThat(created.get("protocol").asText()).isEqualTo("HTTP");
        assertThat(created.get("draftRevision").asLong()).isEqualTo(1);
        JsonNode preview = send(get("/admin-api/apis/" + id + "/preview"));
        assertThat(preview.get("title").asText()).contains("草稿预览");
        assertThat(preview.get("httpMethod").asText()).isEqualTo("POST");
        assertThat(preview.at("/requestExample/orderId").asText()).isEqualTo("order-001");
        assertThat(preview.toString()).doesNotContain("internal.example", "binding");
        assertThat(send(get("/admin-api/apis/" + id)).at("/binding/http/url").asText())
                .isEqualTo("https://internal.example/orders/query");
        mvc.perform(get("/admin-api/apis/" + id + "/preview")).andExpect(status().isUnauthorized());
    }

    @Test
    void savesOnlyExpectedRevisionAndKeepsOperationIdentityImmutable() throws Exception {
        ObjectNode body = draft();
        String id = send(post("/admin-api/apis").content(body.toString())).get("id").asText();
        mvc.perform(auth(post("/admin-api/apis").content(body.toString()))).andExpect(status().isConflict());
        body.put("expectedRevision", 1).put("name", "新版草稿");
        assertThat(send(put("/admin-api/apis/" + id).content(body.toString())).get("draftRevision").asLong()).isEqualTo(2);
        body.put("name", "过期提交");
        mvc.perform(auth(put("/admin-api/apis/" + id).content(body.toString()))).andExpect(status().isConflict());
        assertThat(send(get("/admin-api/apis/" + id + "/preview")).get("title").asText()).contains("新版草稿");
        body.put("expectedRevision", 2).put("service", "different_service");
        mvc.perform(auth(put("/admin-api/apis/" + id).content(body.toString()))).andExpect(status().isBadRequest());
        assertThat(send(get("/admin-api/apis/" + id)).get("draftRevision").asLong()).isEqualTo(2);
    }

    @Test
    void operationVersionsAreCaseSensitiveAndKeepIndependentRevisions() throws Exception {
        ObjectNode body = draft();
        JsonNode lower = send(post("/admin-api/apis").content(body.toString()));
        body.put("version", "V1");
        JsonNode upper = send(post("/admin-api/apis").content(body.toString()));
        assertThat(upper.get("id").asText()).isNotEqualTo(lower.get("id").asText());
        assertThat(send(get("/admin-api/apis/" + lower.get("id").asText())).get("version").asText()).isEqualTo("v1");
        assertThat(send(get("/admin-api/apis/" + upper.get("id").asText())).get("version").asText()).isEqualTo("V1");
    }

    @Test
    void acceptedWideDraftRemainsReadableAndNormalizedOversizeIsRejected() throws Exception {
        ObjectNode body = draft();
        ObjectNode response = json.createObjectNode().put("type", "OBJECT");
        ObjectNode fields = response.putObject("properties");
        for (int i = 0; i < 40; i++) fields.putObject("field" + i).put("type", "STRING").put("example", "x".repeat(5000));
        body.set("responseSchema", response);
        JsonNode created = send(post("/admin-api/apis").content(body.toString()));
        assertThat(send(get("/admin-api/apis/" + created.get("id").asText())).at("/responseSchema/properties/field39/example").asText())
                .hasSize(5000);
        assertThat(send(get("/admin-api/apis/" + created.get("id").asText() + "/preview")).at("/responseExample/field39").asText())
                .hasSize(5000);
        body.put("service", "oversize_draft");
        for (int i = 0; i < 40; i++) ((ObjectNode)fields.get("field" + i)).put("example", "x".repeat(6200));
        // 保持请求在读入上限内，大量可选节点补全的字段使持久化形式超过上限。
        ObjectNode requests = (ObjectNode)body.get("requestSchema").get("properties");
        for (int i = 0; i < 4; i++) {
            ObjectNode group = requests.putObject("group" + i).put("type", "OBJECT").putObject("properties");
            for (int j = 0; j < 45; j++) group.putObject("value" + j).put("type", "INTEGER");
        }
        assertThat(body.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8).length).isLessThan(262_144);
        mvc.perform(auth(post("/admin-api/apis").content(body.toString()))).andExpect(status().isBadRequest());
        assertThat(send(get("/admin-api/apis").param("query", "oversize_draft")).get("total").asLong()).isZero();
    }

    @Test
    void decimalExamplesKeepTheirDeclaredPrecisionAcrossSaveAndPreview() throws Exception {
        ObjectNode body = draft();
        String value = "1234567890.1234567890123456789";
        body.set("responseSchema", json.createObjectNode().put("type", "NUMBER").put("example", new java.math.BigDecimal(value)));
        String id = send(post("/admin-api/apis").content(body.toString())).get("id").asText();
        String preview = mvc.perform(auth(get("/admin-api/apis/" + id + "/preview"))).andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        assertThat(preview).contains("\"responseExample\":" + value);
    }

    @Test
    void acceptsDubboOrderedArgumentsAndProtectsContextTargets() throws Exception {
        JsonNode connection = send(post("/admin-api/dubbo-connections").content("""
                {"name":"订单连接","description":"测试","config":{
                "registry":{"address":"nacos://registry.example:8848","namespace":"test","group":"TEST"},
                "metadata":{"type":"NONE"},"discoveryMode":"INTERFACE","providerMetadataMode":"LOCAL"}}
                """)).get("connection");
        String connectionId = connection.get("id").asText();
        send(post("/admin-api/dubbo-connections/" + connectionId + "/activate")
                .content("{\"expectedStateVersion\":1,\"revision\":1}"));
        ObjectNode body = draft();
        body.set("binding", json.readTree("""
                {"protocol":"DUBBO","timeoutMillis":1000,"dubbo":{"interfaceName":"com.example.OrderService","method":"query","version":"1.0","parameterTypes":["com.example.OrderQuery","java.lang.String"]}}
                """));
        ((ObjectNode) body.at("/binding/dubbo")).put("connectionId", connectionId).put("connectionRevision", 1);
        body.set("mappings", json.readTree("""
                [{"target":"arg0.orderId","source":"REQUEST","path":"orderId"},{"target":"arg0.tenantId","source":"CONTEXT","path":"tenantId"},{"target":"arg1","source":"FIXED","value":"web"}]
                """));
        JsonNode saved = send(post("/admin-api/apis").content(body.toString()));
        assertThat(saved.get("protocol").asText()).isEqualTo("DUBBO");
        assertThat(send(get("/admin-api/apis/" + saved.get("id").asText())).at("/binding/dubbo/parameterTypes/1").asText())
                .isEqualTo("java.lang.String");
        assertThat(send(get("/admin-api/apis/" + saved.get("id").asText() + "/preview")).toString())
                .doesNotContain("connectionId", "connectionRevision", "registry.example", "orders\"}");
        ObjectNode fractional = body.deepCopy().put("service", "fractional_" + UUID.randomUUID().toString().replace("-", ""));
        ((ObjectNode) fractional.at("/binding/dubbo")).put("connectionRevision", 1.5);
        mvc.perform(auth(post("/admin-api/apis").content(fractional.toString()))).andExpect(status().isBadRequest());
        ((ObjectNode) fractional.at("/binding/dubbo")).put("connectionRevision", "1");
        mvc.perform(auth(post("/admin-api/apis").content(fractional.toString()))).andExpect(status().isBadRequest());
        ObjectNode erased = body.deepCopy().put("expectedRevision", 1);
        ((ObjectNode) erased.at("/binding/dubbo")).remove("connectionId");
        ((ObjectNode) erased.at("/binding/dubbo")).remove("connectionRevision");
        mvc.perform(auth(put("/admin-api/apis/" + saved.get("id").asText()).content(erased.toString())))
                .andExpect(status().isBadRequest());
        assertThat(send(get("/admin-api/apis/" + saved.get("id").asText())).at("/binding/dubbo/connectionId").asText())
                .isEqualTo(connectionId);
        ObjectNode connectionDraft = json.createObjectNode().put("name", "订单连接第二版")
                .put("description", "隔离修订").put("expectedStateVersion", 2);
        connectionDraft.set("config", send(get("/admin-api/dubbo-connections/" + connectionId)).at("/draft/config"));
        send(put("/admin-api/dubbo-connections/" + connectionId + "/draft").content(connectionDraft.toString()));
        ObjectNode unactivated = body.deepCopy().put("service", "unactivated_" + UUID.randomUUID().toString().replace("-", ""));
        ((ObjectNode) unactivated.at("/binding/dubbo")).put("connectionRevision", 2);
        mvc.perform(auth(post("/admin-api/apis").content(unactivated.toString()))).andExpect(status().isBadRequest());
        send(post("/admin-api/dubbo-connections/" + connectionId + "/activate")
                .content("{\"expectedStateVersion\":3,\"revision\":2}"));
        body.put("expectedRevision", 1).put("name", "保留旧连接修订");
        send(put("/admin-api/apis/" + saved.get("id").asText()).content(body.toString()));
        JsonNode references = send(get("/admin-api/dubbo-connections/" + connectionId + "/references"));
        assertThat(references.at("/items/0/revision").asLong()).isEqualTo(1);
        assertThat(references.at("/items/0/kind").asText()).isEqualTo("DRAFT");
        ObjectNode oldSelection = body.deepCopy().put("service", "old_selection_" + UUID.randomUUID().toString().replace("-", ""));
        oldSelection.remove("expectedRevision");
        mvc.perform(auth(post("/admin-api/apis").content(oldSelection.toString()))).andExpect(status().isBadRequest());
        send(put("/admin-api/dubbo-connections/" + connectionId + "/status")
                .content("{\"expectedStateVersion\":4,\"enabled\":false}"));
        body.put("expectedRevision", 2);
        mvc.perform(auth(put("/admin-api/apis/" + saved.get("id").asText()).content(body.toString())))
                .andExpect(status().isBadRequest());
        body.remove("expectedRevision");
        body.put("service", "bad_" + UUID.randomUUID().toString().replace("-", ""));
        ((ObjectNode)body.get("mappings").get(0)).put("target", "arg2.orderId");
        mvc.perform(auth(post("/admin-api/apis").content(body.toString()))).andExpect(status().isBadRequest());
    }

    @Test
    void rejectsNestedIdentityInjectionUnknownPathsAndOverlappingTargets() throws Exception {
        for (String mappings : new String[]{
                "[{\"target\":\"nested.tenantId\",\"source\":\"REQUEST\",\"path\":\"orderId\"}]",
                "[{\"target\":\"query\",\"source\":\"FIXED\",\"value\":{\"nested\":{\"user_id\":\"spoofed\"}}}]",
                "[{\"target\":\"orderId\",\"source\":\"REQUEST\",\"path\":\"absent\"}]",
                "[{\"target\":\"tenantId\",\"source\":\"CONTEXT\",\"path\":\"unknown\"}]",
                "[{\"target\":\"query\",\"source\":\"FIXED\",\"value\":{}},{\"target\":\"query.orderId\",\"source\":\"REQUEST\",\"path\":\"orderId\"}]"}) {
            ObjectNode body = draft();
            body.set("mappings", json.readTree(mappings));
            mvc.perform(auth(post("/admin-api/apis").content(body.toString()))).andExpect(status().isBadRequest());
        }
        ObjectNode body = draft();
        body.set("requestSchema", json.readTree("""
                {"type":"OBJECT","properties":{"nested":{"type":"ARRAY","items":{"type":"OBJECT","properties":{"tenant_id":{"type":"STRING"}}}}}}
                """));
        mvc.perform(auth(post("/admin-api/apis").content(body.toString()))).andExpect(status().isBadRequest());
    }

    @Test
    void validatesJsonTypesRequiredFieldsEnumsAndNestedArrayExamples() throws Exception {
        ObjectNode body = draft();
        body.set("responseSchema", json.readTree("""
                {"type":"ARRAY","items":{"type":"OBJECT","properties":{"count":{"type":"INTEGER","required":true},"status":{"type":"STRING","enumValues":["ready","done"]}}},"example":[{"count":2,"status":"ready"}]}
                """));
        JsonNode saved = send(post("/admin-api/apis").content(body.toString()));
        assertThat(send(get("/admin-api/apis/" + saved.get("id").asText() + "/preview")).at("/responseExample/0/count").asInt()).isEqualTo(2);
        for (String schema : new String[]{
                "{\"type\":\"INTEGER\",\"defaultValue\":1.5}",
                "{\"type\":\"STRING\",\"enumValues\":[\"ready\"],\"example\":\"other\"}",
                "{\"type\":\"OBJECT\",\"properties\":{\"id\":{\"type\":\"STRING\",\"required\":true}},\"example\":{}}",
                "{\"type\":\"ARRAY\",\"items\":{\"type\":\"BOOLEAN\"},\"example\":[\"true\"]}",
                "{\"type\":\"STRING\",\"properties\":{\"nested\":{\"type\":\"INTEGER\"}}}"}) {
            ObjectNode invalid = draft();
            invalid.set("responseSchema", json.readTree(schema));
            mvc.perform(auth(post("/admin-api/apis").content(invalid.toString()))).andExpect(status().isBadRequest());
        }
    }

    @Test
    void rejectsNullElementsDuplicateKeysAndOversizedStructuresAsBadRequests() throws Exception {
        for (String field : new String[]{"scopeCodes", "errorDefinitions", "mappings"}) {
            ObjectNode body = draft();
            body.set(field, json.readTree("[null]"));
            mvc.perform(auth(post("/admin-api/apis").content(body.toString()))).andExpect(status().isBadRequest());
        }
        ObjectNode nullEnum = draft();
        nullEnum.set("responseSchema", json.readTree("{\"type\":\"STRING\",\"enumValues\":[null]}"));
        mvc.perform(auth(post("/admin-api/apis").content(nullEnum.toString()))).andExpect(status().isBadRequest());
        String duplicate = definition("duplicate_fields").replace("\"orderId\":{\"type\":\"STRING\",\"required\":true,\"example\":\"order-001\"}",
                "\"orderId\":{\"type\":\"STRING\"},\"orderId\":{\"type\":\"INTEGER\"}");
        mvc.perform(auth(post("/admin-api/apis").content(duplicate))).andExpect(status().isBadRequest());
        ObjectNode huge = draft();
        ((ObjectNode)huge.get("requestSchema")).put("description", "x".repeat(70_000));
        mvc.perform(auth(post("/admin-api/apis").content(huge.toString()))).andExpect(status().isBadRequest());
        ObjectNode deep = draft();
        String nested = "{\"type\":\"STRING\"}";
        for (int i = 0; i < 9; i++) nested = "{\"type\":\"ARRAY\",\"items\":" + nested + "}";
        deep.set("responseSchema", json.readTree(nested));
        mvc.perform(auth(post("/admin-api/apis").content(deep.toString()))).andExpect(status().isBadRequest());
    }

    @Test
    void reusesScopesWithReadOnlyCatalogPermissionAndLiteralPagination() throws Exception {
        String code = "catalog_" + UUID.randomUUID().toString().replace("-", "");
        send(post("/admin-api/scopes").content("{\"code\":\"" + code + "\",\"name\":\"测试组\",\"enabled\":true,\"defaultForNewApplication\":false}"));
        TestAccount author = new TestAccount();
        author.setId(12L); author.setTenantId("tenant-1"); author.setEmployeeNoStr("author");
        when(identityService.current("test-session")).thenAnswer(invocation -> author.toAccount());
        assertThat(send(get("/admin-api/apis/scopes").param("query", code)).get("total").asInt()).isEqualTo(1);
        mvc.perform(auth(get("/admin-api/scopes"))).andExpect(status().isForbidden());
        ObjectNode body = draft();
        body.put("name", "精确%_字符");
        body.set("scopeCodes", json.readTree("[\"" + code + "\"]"));
        JsonNode created = send(post("/admin-api/apis").content(body.toString()));
        JsonNode page = send(get("/admin-api/apis").param("query", "%_").param("pageSize", "1"));
        assertThat(page.get("total").asInt()).isEqualTo(1);
        assertThat(page.at("/items/0/id").asText()).isEqualTo(created.get("id").asText());
        assertThat(page.at("/items/0").has("binding")).isFalse();
        body.put("service", "unknown_scope"); body.set("scopeCodes", json.readTree("[\"unknown_scope\"]"));
        mvc.perform(auth(post("/admin-api/apis").content(body.toString()))).andExpect(status().isBadRequest());
        mvc.perform(auth(get("/admin-api/apis").param("pageSize", "101"))).andExpect(status().isBadRequest());
        mvc.perform(post("/admin-api/apis").session(io.github.chenyilei2016.openplatform.testing.TestSessions.session("test-session")).contentType("application/json").content(body.toString()))
                .andExpect(status().isForbidden());
    }

    @Test
    void scopeDrawerListsDraftAndLiveApisAndChangesOnlyDraftScopeCodes() throws Exception {
        String code = "drawer_" + UUID.randomUUID().toString().replace("-", "");
        JsonNode scope = send(post("/admin-api/scopes").content("{\"code\":\"" + code
                + "\",\"name\":\"抽屉组\",\"enabled\":true,\"defaultForNewApplication\":false}"));
        String scopeId = scope.get("id").asText();
        ObjectNode included = draft();
        included.putArray("scopeCodes").add(code);
        String liveId = send(post("/admin-api/apis").content(included.toString())).get("id").asText();
        ObjectNode other = draft();
        other.put("name", "待加入接口");
        String draftId = send(post("/admin-api/apis").content(other.toString())).get("id").asText();
        var release = publications.submit(liveId, 1, 0, UUID.randomUUID().toString(), "发布含权限组版本",
                new io.github.chenyilei2016.openplatform.domain.access.AccessOperator("tenant-1", "operator-1", "scope-test", null, null));
        if (release.status().name().equals("PENDING"))
            publications.approve(release.id(), "通过",
                    new io.github.chenyilei2016.openplatform.domain.access.AccessOperator("tenant-1", "reviewer", "scope-test", null, null));
        send(post("/admin-api/applications").content(json.writeValueAsString(java.util.Map.of(
                "name", "抽屉凭据", "ownerTenantId", "tenant-1", "scopeCodes", java.util.List.of(code)))));

        JsonNode listed = send(get("/admin-api/scopes").param("code", code)).at("/items/0");
        assertThat(listed.get("apiCount").asLong()).isEqualTo(1);
        assertThat(listed.get("credentialCount").asLong()).isEqualTo(1);
        JsonNode apis = send(get("/admin-api/scopes/" + scopeId + "/apis"));
        assertThat(apis.get("total").asInt()).isEqualTo(1);
        assertThat(apis.at("/items/0/id").asText()).isEqualTo(liveId);
        assertThat(apis.at("/items/0/draftIncluded").asBoolean()).isTrue();
        assertThat(apis.at("/items/0/liveIncluded").asBoolean()).isTrue();
        assertThat(apis.at("/items/0/liveDraftRevision").asLong()).isEqualTo(1);

        JsonNode before = send(get("/admin-api/apis/" + draftId));
        JsonNode added = send(put("/admin-api/apis/" + draftId + "/scope-codes").content(
                "{\"expectedRevision\":1,\"scopeCode\":\"" + code + "\",\"included\":true}"));
        assertThat(added.get("changed").asBoolean()).isTrue();
        assertThat(added.get("draftRevision").asLong()).isEqualTo(2);
        assertThat(added.get("scopeCodes").toString()).isEqualTo("[\"" + code + "\"]");
        // 其余草稿内容原样保留，只改 scopeCodes 并生成新修订。
        ObjectNode expected = ((ObjectNode) before).deepCopy().put("draftRevision", 2);
        expected.putArray("scopeCodes").add(code);
        assertThat(send(get("/admin-api/apis/" + draftId))).isEqualTo(expected);
        send(put("/admin-api/apis/" + liveId + "/scope-codes").content(
                "{\"expectedRevision\":1,\"scopeCode\":\"" + code + "\",\"included\":false}"));
        // 过期修订不覆盖他人保存。
        mvc.perform(auth(put("/admin-api/apis/" + draftId + "/scope-codes").content(
                "{\"expectedRevision\":1,\"scopeCode\":\"" + code + "\",\"included\":false}"))).andExpect(status().isConflict());
        mvc.perform(auth(put("/admin-api/apis/" + draftId + "/scope-codes").content(
                "{\"expectedRevision\":2,\"scopeCode\":\"BAD CODE\",\"included\":true}"))).andExpect(status().isBadRequest());

        JsonNode pending = send(get("/admin-api/scopes/" + scopeId + "/apis"));
        assertThat(pending.get("total").asInt()).isEqualTo(2);
        java.util.Map<String, JsonNode> rows = new java.util.HashMap<>();
        pending.get("items").forEach(row -> rows.put(row.get("id").asText(), row));
        assertThat(rows.get(liveId).get("draftIncluded").asBoolean()).isFalse();
        assertThat(rows.get(liveId).get("liveIncluded").asBoolean()).isTrue();
        assertThat(rows.get(liveId).get("draftRevision").asLong()).isEqualTo(2);
        assertThat(rows.get(draftId).get("draftIncluded").asBoolean()).isTrue();
        assertThat(rows.get(draftId).get("liveIncluded").asBoolean()).isFalse();
        assertThat(rows.get(draftId).get("liveDraftRevision").isNull()).isTrue();
        assertThat(send(get("/admin-api/scopes/" + scopeId + "/apis").param("query", "待加入")).get("total").asInt()).isEqualTo(1);
        // API 数只计已发布生效版本，草稿增删发布后才计入。
        assertThat(send(get("/admin-api/scopes/" + scopeId)).get("apiCount").asLong()).isEqualTo(1);
    }

    @Test
    void scopeListAggregatesUsageOncePerPage() throws Exception {
        String prefix = "usage_" + UUID.randomUUID().toString().replace("-", "").substring(0, 12);
        for (int index = 0; index < 3; index++)
            send(post("/admin-api/scopes").content("{\"code\":\"" + prefix + index
                    + "\",\"name\":\"统计组\",\"enabled\":true,\"defaultForNewApplication\":false}"));
        org.mockito.Mockito.clearInvocations(scopeRepository);
        JsonNode page = send(get("/admin-api/scopes").param("query", prefix));
        assertThat(page.get("items").size()).isEqualTo(3);
        assertThat(page.at("/items/0/apiCount").asLong()).isZero();
        // 每页一次批量统计（实现为固定两次分组查询），与权限组数量无关。
        org.mockito.Mockito.verify(scopeRepository, org.mockito.Mockito.times(1)).usage(org.mockito.ArgumentMatchers.argThat(codes -> codes.size() == 3));
    }

    @Test
    void quickCreateMinimalDefaultsAreCompleteDraftsAndValidationReportsTakenOperation() throws Exception {
        String service = "quick_" + UUID.randomUUID().toString().replace("-", "").substring(0, 20);
        ObjectNode http = (ObjectNode) json.readTree("""
                {"service":"%s","version":"v1","method":"detail","name":"快速创建HTTP","category":"订单","owner":"研发","description":"",
                 "scopeCodes":[],"employeeRequired":false,"responseAdapter":{"mode":"DIRECT"},
                 "requestSchema":{"type":"OBJECT","properties":{"orderNo":{"type":"STRING","required":true}}},
                 "responseSchema":{"type":"OBJECT","properties":{}},
                 "binding":{"protocol":"HTTP","timeoutMillis":3000,"http":{"targetMode":"URL","url":"http://order-svc/internal/orders/{orderNo}","method":"POST"}},
                 "mappings":[{"target":"orderNo","source":"REQUEST","path":"orderNo","location":"PATH"}],"errorDefinitions":[]}
                """.formatted(service));
        assertThat(send(post("/admin-api/apis/validate").content(http.toString())).path("valid").asBoolean()).isTrue();
        JsonNode created = send(post("/admin-api/apis").content(http.toString()));
        assertThat(created.path("draftRevision").asLong()).isEqualTo(1);
        assertThat(created.at("/responseAdapter/mode").asText()).isEqualTo("DIRECT");
        assertThat(send(post("/admin-api/apis/validate").content(http.toString())).path("valid").asBoolean())
                .as("导入更新已有 API 的候选仍按原语义校验").isTrue();
        JsonNode taken = send(post("/admin-api/apis/validate").param("newOperation", "true").content(http.toString()));
        assertThat(taken.path("valid").asBoolean()).isFalse();
        assertThat(taken.at("/fieldIssues/0/path").asText()).isEqualTo("/method");
        assertThat(taken.at("/fieldIssues/0/message").asText()).contains("快速创建HTTP");
        ObjectNode incomplete = http.deepCopy().put("category", "").put("name", "");
        JsonNode early = send(post("/admin-api/apis/validate").param("newOperation", "true").content(incomplete.toString()));
        assertThat(java.util.stream.StreamSupport.stream(early.path("fieldIssues").spliterator(), false)
                .map(issue -> issue.path("path").asText()).toList()).as("其他字段未填完时也提前提示标识占用").contains("/method", "/name", "/category");
        ObjectNode renamed = http.deepCopy().put("method", "detail_v2");
        assertThat(send(post("/admin-api/apis/validate").param("newOperation", "true").content(renamed.toString())).path("valid").asBoolean()).isTrue();

        JsonNode connection = send(post("/admin-api/dubbo-connections").content("""
                {"name":"快速创建连接","description":"测试","config":{
                "registry":{"address":"nacos://registry.example:8848","namespace":"test","group":"TEST"},
                "metadata":{"type":"NONE"},"discoveryMode":"INTERFACE","providerMetadataMode":"LOCAL"}}
                """)).get("connection");
        String connectionId = connection.get("id").asText();
        send(post("/admin-api/dubbo-connections/" + connectionId + "/activate").content("{\"expectedStateVersion\":1,\"revision\":1}"));
        ObjectNode dubbo = (ObjectNode) json.readTree("""
                {"service":"%s","version":"v1","method":"query_order","name":"快速创建Dubbo","category":"订单","owner":"研发","description":"",
                 "scopeCodes":[],"employeeRequired":false,"responseAdapter":{"mode":"DIRECT"},
                 "requestSchema":{"type":"OBJECT","properties":{"arg0":{"type":"STRING","required":true},"arg1":{"type":"INTEGER","required":true}}},
                 "responseSchema":{"type":"OBJECT","properties":{}},
                 "binding":{"protocol":"DUBBO","timeoutMillis":3000,"dubbo":{"interfaceName":"com.example.order.OrderQueryFacade","method":"queryOrder",
                   "parameterTypes":["java.lang.String","int"],"version":"","group":"","connectionId":"%s","connectionRevision":1,"providerApplication":null}},
                 "mappings":[{"target":"arg0","source":"REQUEST","path":"arg0"},{"target":"arg1","source":"REQUEST","path":"arg1"}],"errorDefinitions":[]}
                """.formatted(service + "_dubbo", connectionId));
        assertThat(send(post("/admin-api/apis/validate").content(dubbo.toString())).path("valid").asBoolean()).isTrue();
        JsonNode dubboCreated = send(post("/admin-api/apis").content(dubbo.toString()));
        assertThat(dubboCreated.path("protocol").asText()).isEqualTo("DUBBO");
        assertThat(send(get("/admin-api/apis/" + dubboCreated.path("id").asText() + "/preview")).at("/requestSchema/properties/arg1/type").asText())
                .isEqualTo("INTEGER");
    }

    private ObjectNode draft() {
        return (ObjectNode) json.readTree(definition("orders_" + UUID.randomUUID().toString().replace("-", "")));
    }


    @Test
    void responseRulesRoundTripThroughSaveNoChangeHistoryRestoreAndPublicDocument() throws Exception {
        ObjectNode body = draft();
        body.set("responseAdapter", json.readTree("{\"mode\":\"ENVELOPE\",\"successPath\":\"code\",\"successValues\":[200],\"dataPath\":\"data\"}"));
        ((ObjectNode) body.at("/responseSchema/properties/orderId")).put("nullable", true);
        JsonNode created = send(post("/admin-api/apis").content(body.toString()));
        String id = created.get("id").asText();
        body.put("expectedRevision", 1);
        assertThat(send(put("/admin-api/apis/" + id).content(body.toString())).get("changed").asBoolean()).isFalse();
        ((ObjectNode) body.get("responseAdapter")).putArray("successValues").add(0);
        assertThat(send(put("/admin-api/apis/" + id).content(body.toString())).get("changed").asBoolean()).isTrue();
        assertThat(send(get("/admin-api/apis/" + id + "/revisions/1")).at("/snapshot/responseAdapter/successValues/0").asInt()).isEqualTo(200);
        send(post("/admin-api/apis/" + id + "/revisions/1/restore").content("{\"expectedRevision\":2}"));
        assertThat(send(get("/admin-api/apis/" + id)).get("responseAdapter")).isEqualTo(created.get("responseAdapter"));
        JsonNode document = send(get("/admin-api/apis/" + id + "/preview"));
        assertThat(document.has("responseAdapter")).isFalse();
        assertThat(document.at("/responseSchema/properties/orderId/nullable").asBoolean()).isTrue();
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
