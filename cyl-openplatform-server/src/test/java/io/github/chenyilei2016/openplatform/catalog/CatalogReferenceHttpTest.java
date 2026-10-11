package io.github.chenyilei2016.openplatform.catalog;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;


import io.github.chenyilei2016.openplatform.application.identity.AccountAuthentication;
import io.github.chenyilei2016.openplatform.testing.TestEmployee;
import io.github.chenyilei2016.openplatform.testing.TestAccount;

import jakarta.servlet.http.Cookie;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

import java.util.Map;
import java.util.UUID;

@io.github.chenyilei2016.openplatform.testing.TestAdministrators
@SpringBootTest(
        properties = {


            "test.admin.operators[0].tenant-id=101",
            "test.admin.operators[0].employee-no=operator-1",
            "test.admin.operators[0].permissions[0]=MANAGE_APIS",
            "test.admin.operators[0].permissions[1]=MANAGE_APPLICATIONS",
            "test.admin.operators[0].permissions[2]=PUBLISH_APIS",
            "test.admin.operators[0].permissions[3]=REVIEW_APIS",
            "test.admin.operators[1].tenant-id=101",
            "test.admin.operators[1].employee-no=reviewer93",
            "test.admin.operators[1].permissions[0]=REVIEW_APIS"
})
@AutoConfigureMockMvc(print = org.springframework.boot.webmvc.test.autoconfigure.MockMvcPrint.NONE)
class CatalogReferenceHttpTest {
    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @MockitoBean AccountAuthentication login;
    @MockitoBean io.github.chenyilei2016.openplatform.domain.access.EmployeeDirectory employees;
    private final JsonMapper json = JsonMapper.builder().build();

    @BeforeEach
    void identity() throws Exception {
        TestAccount user = new TestAccount();
        user.setId(201L);
        user.setTenantId("101");
        user.setEmployeeNoStr("operator-1");
        when(login.current("test-session")).thenAnswer(invocation -> user.toAccount());
        TestEmployee employee = new TestEmployee();
        employee.setId(201L);
        employee.setUserId(201L);
        employee.setTenantId(101L);
        employee.setEmployeeNoStr("operator-1");
        employee.setName("回归维护人");
        employee.setEnabled(true);
        employee.setEmployeeStatus(4);
        when(employees.find(org.mockito.ArgumentMatchers.eq("101"), org.mockito.ArgumentMatchers.eq("operator-1")))
                .thenAnswer(invocation -> employee.toIdentity());
        send(
                post("/admin-api/apis/owners/verify")
                        .content(body(Map.of("employeeNo", "operator-1"))));
    }

    @Test
    void reviewerCanReadOwnerForSnapshotButCannotSearchOrChangeOwner() throws Exception {
        String ownerId = send(get("/admin-api/apis/owners/current")).get("id").asText();
        TestAccount reviewer = new TestAccount();
        reviewer.setId(202L);
        reviewer.setTenantId("101");
        reviewer.setEmployeeNoStr("reviewer93");
        when(login.current("test-session")).thenAnswer(invocation -> reviewer.toAccount());
        mvc.perform(auth(get("/admin-api/apis/owners/" + ownerId)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.displayName").value("回归维护人"));
        mvc.perform(auth(get("/admin-api/apis/owners"))).andExpect(status().isForbidden());
        mvc.perform(auth(get("/admin-api/apis/owners/current"))).andExpect(status().isForbidden());
        mvc.perform(auth(post("/admin-api/apis/owners/verify").content("{\"employeeNo\":\"operator-1\"}")))
                .andExpect(status().isForbidden());
    }

    @Test
    void duplicateNameIsAFieldErrorAndDoesNotConsumeRevision() throws Exception {
        String suffix=UUID.randomUUID().toString();
        JsonNode first=send(post("/admin-api/api-categories").content(body(Map.of("name","first-"+suffix))));
        send(post("/admin-api/api-categories").content(body(Map.of("name","second-"+suffix))));
        mvc.perform(auth(put("/admin-api/api-categories/"+first.get("id").asText()).content(body(Map.of("name","second-"+suffix,"expectedRevision",1)))))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.data.fieldIssues[0].path").value("/name"));
        JsonNode changed=send(put("/admin-api/api-categories/"+first.get("id").asText()).content(body(Map.of("name","third-"+suffix,"expectedRevision",1))));
        assertThat(changed.get("revision").asLong()).isEqualTo(2);
        send(post("/admin-api/api-categories/"+first.get("id").asText()+"/remove").content(body(Map.of("expectedRevision",2))));
        JsonNode recreated=send(post("/admin-api/api-categories").content(body(Map.of("name","third-"+suffix))));
        assertThat(recreated.get("id").asText()).isNotEqualTo(first.get("id").asText());
    }

    @Test
    void categoriesRenameAndMergeWithoutRewritingDraftOrPublishedSnapshot() throws Exception {
        String suffix = UUID.randomUUID().toString();
        String firstName = "原分类" + suffix;
        JsonNode first =
                send(post("/admin-api/api-categories").content(body(Map.of("name", firstName))));
        assertThat(first.get("id").asText()).matches("CAT_[0-9a-f]{32}");
        JsonNode owner = send(get("/admin-api/apis/owners/current"));
        ObjectNode definition = draft(firstName, owner.get("id").asText());
        jdbc.update("UPDATE access_scope SET public_access=true WHERE code=?", definition.at("/scopeCodes/0").asText());
        JsonNode api = send(post("/admin-api/apis").content(definition.toString()));
        String apiId = api.get("id").asText();
        JsonNode state = send(get("/admin-api/publications/apis/" + apiId + "/state"));
        JsonNode release =
                send(
                        post("/admin-api/publications/apis/" + apiId + "/submissions")
                                .content(
                                        body(
                                                Map.of(
                                                        "expectedDraftRevision",
                                                        1,
                                                        "expectedStateVersion",
                                                        state.get("stateVersion").asLong(),
                                                        "submissionKey",
                                                        UUID.randomUUID().toString(),
                                                        "comment",
                                                        "分类版本边界测试"))));
        if ("PENDING".equals(release.get("status").asText()))
            send(
                    post("/admin-api/publications/" + release.get("id").asText() + "/approve")
                            .content(body(Map.of("comment", "分类边界验证"))));
        String snapshot =
                jdbc.queryForObject(
                        "SELECT snapshot_json FROM publication_release WHERE id=?",
                        String.class,
                        release.get("id").asText());
        String draftJson =
                jdbc.queryForObject(
                        "SELECT definition_json FROM catalog_api_draft WHERE id=?",
                        String.class,
                        apiId);
        String renamed = "改名分类" + suffix;
        send(
                put("/admin-api/api-categories/" + first.get("id").asText())
                        .content(body(Map.of("name", renamed, "expectedRevision", 1))));
        assertThat(send(get("/admin-api/api-categories/resolve").param("name", firstName)).asText())
                .isEqualTo(renamed);
        mvc.perform(
                        auth(
                                put("/admin-api/api-categories/" + first.get("id").asText())
                                        .content(
                                                body(
                                                        Map.of(
                                                                "name",
                                                                "旧版本覆盖",
                                                                "expectedRevision",
                                                                1)))))
                .andExpect(status().isConflict());
        String path = "/public-api/documents/" + api.get("service").asText() + "/v1/query/view";
        assertThat(send(get(path)).get("category").asText()).isEqualTo(renamed);
        JsonNode target =
                send(
                        post("/admin-api/api-categories")
                                .content(body(Map.of("name", "目标分类" + suffix))));
        mvc.perform(
                        auth(
                                post("/admin-api/api-categories/"
                                                + first.get("id").asText()
                                                + "/remove")
                                        .content(body(Map.of("expectedRevision", 2)))))
                .andExpect(status().isConflict());
        send(
                post("/admin-api/api-categories/" + first.get("id").asText() + "/remove")
                        .content(
                                body(
                                        Map.of(
                                                "expectedRevision",
                                                2,
                                                "targetId",
                                                target.get("id").asText()))));
        assertThat(send(get(path)).get("category").asText()).isEqualTo(target.get("name").asText());
        assertThat(
                        jdbc.queryForObject(
                                "SELECT snapshot_json FROM publication_release WHERE id=?",
                                String.class,
                                release.get("id").asText()))
                .isEqualTo(snapshot);
        assertThat(
                        jdbc.queryForObject(
                                "SELECT definition_json FROM catalog_api_draft WHERE id=?",
                                String.class,
                                apiId))
                .isEqualTo(draftJson);
        assertThat(
                        send(get("/admin-api/apis").param("category", target.get("name").asText()))
                                .get("total")
                                .asLong())
                .isEqualTo(1);
        assertThat(
                        send(get("/public-api/documents/categories")
                                        .param("service", api.get("service").asText()))
                                .at("/items/0/apiCount")
                                .asLong())
                .isEqualTo(1);
    }

    @Test
    void historicalOnlyCategoryCannotBeRemovedAndRestoreKeepsVerifiedOwner() throws Exception {
        String suffix = UUID.randomUUID().toString();
        JsonNode oldCategory =
                send(
                        post("/admin-api/api-categories")
                                .content(body(Map.of("name", "历史" + suffix))));
        JsonNode currentCategory =
                send(
                        post("/admin-api/api-categories")
                                .content(body(Map.of("name", "当前" + suffix))));
        ObjectNode value =
                draft(
                        oldCategory.get("name").asText(),
                        send(get("/admin-api/apis/owners/current")).get("id").asText());
        JsonNode created = send(post("/admin-api/apis").content(value.toString()));
        String id = created.get("id").asText();
        value.put("category", currentCategory.get("name").asText()).put("expectedRevision", 1);
        send(put("/admin-api/apis/" + id).content(value.toString()));
        JsonNode detail = send(get("/admin-api/api-categories/" + oldCategory.get("id").asText()));
        assertThat(detail.get("draftApis").asLong()).isZero();
        assertThat(detail.get("publishedApis").asLong()).isZero();
        assertThat(detail.get("historicalApis").asLong()).isEqualTo(1);
        mvc.perform(
                        auth(
                                post("/admin-api/api-categories/"
                                                + oldCategory.get("id").asText()
                                                + "/remove")
                                        .content(body(Map.of("expectedRevision", 1)))))
                .andExpect(status().isConflict());
        send(
                post("/admin-api/apis/" + id + "/revisions/1/restore")
                        .content(body(Map.of("expectedRevision", 2))));
        assertThat(send(get("/admin-api/apis/" + id)).get("owner").asText())
                .isEqualTo(value.get("owner").asText());
    }

    @Test
    void unknownCategoriesAndFreeTextOwnersAreRejectedBeforeWriting() throws Exception {
        String category = "字段检查" + UUID.randomUUID();
        send(post("/admin-api/api-categories").content(body(Map.of("name", category))));
        JsonNode owner = send(get("/admin-api/apis/owners/current"));
        ObjectNode value = draft("未登记" + UUID.randomUUID(), owner.get("id").asText());
        mvc.perform(auth(post("/admin-api/apis/validate").content(value.toString())))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.valid").value(false))
                .andExpect(jsonPath("$.data.fieldIssues[0].path").value("/category"));
        mvc.perform(auth(post("/admin-api/apis").content(value.toString())))
                .andExpect(status().isBadRequest());
        value.put("category", category).put("owner", "随便输入的负责人");
        mvc.perform(auth(post("/admin-api/apis").content(value.toString())))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.data.fieldIssues[0].path").value("/owner"));
        assertThat(
                        jdbc.queryForObject(
                                "SELECT COUNT(*) FROM catalog_api_draft WHERE service=?",
                                Long.class,
                                value.get("service").asText()))
                .isZero();
    }

    @Test
    void ownerSearchReturnsStableReferenceAndVerificationRechecksDirectoryIdentity()
            throws Exception {
        JsonNode current = send(get("/admin-api/apis/owners/current"));
        assertThat(current.get("id").asText()).matches("EMP_[0-9a-f]{32}");
        assertThat(
                        send(get("/admin-api/apis/owners").param("name", "回归"))
                                .at("/items/0/id")
                                .asText())
                .isEqualTo(current.get("id").asText());
        JsonNode verified =
                send(
                        post("/admin-api/apis/owners/verify")
                                .content(
                                        body(
                                                Map.of(
                                                        "employeeNo",
                                                        "operator-1",
                                                        "expectedEmployeeId",
                                                        "201"))));
        assertThat(verified.get("id").asText()).isEqualTo(current.get("id").asText());
        mvc.perform(
                        auth(
                                post("/admin-api/apis/owners/verify")
                                        .content(
                                                body(
                                                        Map.of(
                                                                "employeeNo",
                                                                "operator-1",
                                                                "expectedEmployeeId",
                                                                "wrong")))))
                .andExpect(status().isConflict());
        mvc.perform(get("/admin-api/api-categories")).andExpect(status().isUnauthorized());
    }

    @Test
    void directoryDistinguishesLinkedOwnerFromSameNameLegacyText() throws Exception {
        String marker = "owner103_" + UUID.randomUUID();
        String category = send(post("/admin-api/api-categories").content(body(Map.of("name", marker))))
                .get("name").asText();
        JsonNode owner = send(get("/admin-api/apis/owners/current"));
        ObjectNode linked = draft(category, owner.get("id").asText()).put("name", marker);
        send(post("/admin-api/apis").content(linked.toString()));
        ObjectNode legacy = draft(category, owner.get("id").asText()).put("name", marker);
        String legacyId = send(post("/admin-api/apis").content(legacy.toString())).get("id").asText();
        // 还原历史自由文本数据；只作用于隔离H2，不增加生产兼容写入入口。
        legacy.put("owner", owner.get("displayName").asText());
        jdbc.update("UPDATE catalog_api_draft SET owner=?,definition_json=? WHERE id=?",
                legacy.get("owner").asText(), legacy.toString(), legacyId);
        JsonNode page = send(get("/admin-api/apis").param("query", marker));
        assertThat(page.get("total").asLong()).isEqualTo(2);
        for (JsonNode item : page.get("items")) {
            if (item.get("id").asText().equals(legacyId)) {
                assertThat(item.path("ownerProfileLinked").asBoolean()).isFalse();
                assertThat(item.path("ownerName").asText()).isEqualTo("回归维护人");
                assertThat(item.path("ownerEmployeeNo").isNull() || item.path("ownerEmployeeNo").isMissingNode()).isTrue();
            } else {
                assertThat(item.path("ownerProfileLinked").asBoolean()).isTrue();
                assertThat(item.path("ownerName").asText()).isEqualTo("回归维护人");
                assertThat(item.path("ownerEmployeeNo").asText()).isEqualTo("operator-1");
                assertThat(item.path("ownerTenantId").asText()).isEqualTo("101");
            }
        }
    }

    private ObjectNode draft(String category, String owner) throws Exception {
        String code = "category92." + UUID.randomUUID();
        send(
                post("/admin-api/scopes")
                        .content(
                                body(
                                        Map.of(
                                                "code",
                                                code,
                                                "name",
                                                "引用测试",
                                                "enabled",
                                                true,
                                                "defaultForNewApplication",
                                                false))));
        ObjectNode value =
                (ObjectNode)
                        json.readTree(
                                """
{"service":"placeholder","version":"v1","method":"query","name":"目录引用测试","category":"placeholder","owner":"placeholder","scopeCodes":[],
 "requestSchema":{"type":"OBJECT","properties":{}},"responseSchema":{"type":"OBJECT","properties":{}},"errorDefinitions":[],"mappings":[],
 "binding":{"protocol":"HTTP","timeoutMillis":3000,"http":{"url":"https://provider.example/orders","method":"POST"}},"description":"分类与负责人验证"}
""");
        value.put("service", "cat92_" + UUID.randomUUID().toString().replace("-", ""))
                .put("category", category)
                .put("owner", owner);
        value.set("scopeCodes", json.valueToTree(java.util.List.of(code)));
        return value;
    }

    private String body(Object value) {
        return json.writeValueAsString(value);
    }

    private JsonNode send(MockHttpServletRequestBuilder request) throws Exception {
        return json.readTree(
                        mvc.perform(auth(request))
                                .andExpect(status().isOk())
                                .andExpect(jsonPath("$.code").value(200))
                                .andReturn()
                                .getResponse()
                                .getContentAsString())
                .get("data");
    }

    private MockHttpServletRequestBuilder auth(MockHttpServletRequestBuilder request) {
        return request.session(io.github.chenyilei2016.openplatform.testing.TestSessions.session("test-session"))
                .header("X-CSRF-Token", "76832d7fdbcdbf4a72129f8b7def9016")
                .contentType("application/json");
    }
}
