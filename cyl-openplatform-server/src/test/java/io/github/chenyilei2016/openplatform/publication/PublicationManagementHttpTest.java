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
            "test.admin.operators[3].permissions[0]=VIEW_AUDIT"
})
@AutoConfigureMockMvc(print = MockMvcPrint.NONE)
@org.springframework.context.annotation.Import(io.github.chenyilei2016.openplatform.testing.CatalogReferenceFixture.class)
class PublicationManagementHttpTest {
    @Autowired MockMvc mvc;
    @Autowired org.springframework.core.env.ConfigurableEnvironment environment;
    @Autowired org.springframework.jdbc.core.JdbcTemplate database;

    @org.junit.jupiter.api.AfterEach
    void resetConfig() {
        environment.getPropertySources().remove("publication-test");
    }

    private void auditEnabled(boolean enabled) {
        environment
                .getPropertySources()
                .addFirst(
                        new org.springframework.core.env.MapPropertySource(
                                "publication-test",
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
    void restoredPublishedContentHasNoUnpublishedChangesDespiteNewRevision() throws Exception {
        auditEnabled(false);
        ObjectNode body = draft();
        String originalName = body.get("name").asText();
        String service = body.get("service").asText();
        String id = send(post("/admin-api/apis").content(body.toString())).get("id").asText();
        submit(id, 1, UUID.randomUUID().toString());
        body.put("expectedRevision", 1).put("name", "临时编辑");
        send(put("/admin-api/apis/" + id).content(body.toString()));
        assertThat(send(get("/admin-api/apis").param("query", service)).at("/items/0/hasUnpublishedChanges").asBoolean()).isTrue();
        body.put("expectedRevision", 2).put("name", originalName);
        send(put("/admin-api/apis/" + id).content(body.toString()));
        JsonNode summary = send(get("/admin-api/apis").param("query", service)).at("/items/0");
        assertThat(summary.get("draftRevision").asLong()).isEqualTo(3);
        assertThat(summary.get("liveDraftRevision").asLong()).isEqualTo(1);
        assertThat(summary.get("hasUnpublishedChanges").asBoolean()).isFalse();
    }

    @Test
    void historyListsShowOperatorNamesFromAdministratorsAndFallBackWhenUnregistered() throws Exception {
        auditEnabled(false);
        String id = send(post("/admin-api/apis").content(draft().toString())).get("id").asText();
        submit(id, 1, UUID.randomUUID().toString());
        assertThat(send(get("/admin-api/publications/apis/" + id + "/releases")).at("/items/0/submittedByName").isNull()).isTrue();
        database.update("INSERT INTO platform_administrator (id, tenant_id, user_id, employee_id, employee_no, display_name,"
                + " enabled, super_administrator, revision) VALUES ('admin-names', 'tenant-1', '12', 'e-1', 'operator-1', '审核示例人员', TRUE, FALSE, 1)");
        try {
            JsonNode release = send(get("/admin-api/publications/apis/" + id + "/releases")).at("/items/0");
            assertThat(release.get("submittedByEmployeeNo").asText()).isEqualTo("operator-1");
            assertThat(release.get("submittedByName").asText()).isEqualTo("审核示例人员");
            assertThat(send(get("/admin-api/publications").param("query", release.get("service").asText()))
                    .at("/items/0/submittedByName").asText()).isEqualTo("审核示例人员");
            // 审核详情与列表一致显示提交人姓名（116 实页发现详情只有工号）。
            JsonNode detail = send(get("/admin-api/publications/" + release.get("id").asText()));
            assertThat(detail.get("submittedByEmployeeNo").asText()).isEqualTo("operator-1");
            assertThat(detail.get("submittedByName").asText()).isEqualTo("审核示例人员");
            assertThat(detail.get("reviewedByName").isNull()).isTrue();
            assertThat(send(get("/admin-api/publications/apis/" + id + "/audit")).at("/items/0/operatorName").asText()).isEqualTo("审核示例人员");
            JsonNode revision = send(get("/admin-api/apis/" + id + "/revisions")).at("/items/0");
            assertThat(revision.get("revision").asLong()).isEqualTo(1);
            assertThat(revision.get("operatorName").asText()).isEqualTo("审核示例人员");
        } finally {
            database.update("DELETE FROM platform_administrator WHERE id = 'admin-names'");
        }
    }

    @Test
    void catalogListsKeepDraftLivePendingAndDisabledFactsIndependent() throws Exception {
        auditEnabled(true);
        ObjectNode body = draft();
        String service = body.get("service").asText();
        String id = send(post("/admin-api/apis").content(body.toString())).get("id").asText();
        assertSummary(service, id, 1, null, false, null);
        JsonNode first = submit(id, 1, UUID.randomUUID().toString());
        String firstId = first.get("id").asText();
        assertSummary(service, id, 1, null, true, firstId);
        send(post("/admin-api/publications/" + firstId + "/approve").content("{\"comment\":\"通过\"}"));
        assertSummary(service, id, 1, 1L, true, null);
        String literalName = "新版%_!" + service;
        body.put("expectedRevision", 1).put("name", literalName);
        send(put("/admin-api/apis/" + id).content(body.toString()));
        assertSummary(service, id, 2, 1L, true, null);
        String pendingId = submit(id, 2, UUID.randomUUID().toString()).get("id").asText();
        assertSummary(service, id, 2, 1L, true, pendingId);
        JsonNode pendingPage = send(get("/admin-api/apis").param("query", service).param("publication", "PUBLISHED")
                .param("review", "PENDING_REVIEW", "REJECTED").param("access", "ENABLED"));
        assertThat(pendingPage.get("total").asLong()).isEqualTo(1);
        assertThat(pendingPage.at("/items/0/latestReviewStatus").asText()).isEqualTo("PENDING_REVIEW");
        assertThat(pendingPage.at("/items/0/latestReviewDraftRevision").asLong()).isEqualTo(2);
        assertThat(pendingPage.at("/items/0/liveDraftRevision").asLong()).isEqualTo(1);
        assertThat(send(get("/admin-api/apis").param("query", service).param("review", "APPROVED"))
                .get("total").asLong()).isZero();
        send(post("/admin-api/publications/" + pendingId + "/reject").content("{\"comment\":\"保持线上\"}"));
        assertSummary(service, id, 2, 1L, true, null);
        assertThat(send(get("/admin-api/apis").param("query", service).param("review", "REJECTED"))
                .at("/items/0/latestReviewStatus").asText()).isEqualTo("REJECTED");
        pendingId = submit(id, 2, UUID.randomUUID().toString()).get("id").asText();
        long stateVersion = send(get("/admin-api/publications/apis/" + id + "/state")).get("stateVersion").asLong();
        send(put("/admin-api/publications/apis/" + id + "/status").content(statusBody(false, stateVersion)));
        assertSummary(service, id, 2, 1L, false, pendingId);
        JsonNode literalPage = send(get("/admin-api/apis").param("query", literalName).param("pageSize", "1"));
        assertThat(literalPage.get("total").asLong()).isEqualTo(1);
        assertThat(literalPage.at("/items/0/id").asText()).isEqualTo(id);
        assertThat(send(get("/admin-api/publications/apis").param("query", literalName).param("pageSize", "1")))
                .isEqualTo(literalPage);
        assertThat(send(get("/admin-api/apis").param("query", literalName).param("page", "2").param("pageSize", "1"))
                .get("items").isEmpty()).isTrue();
    }

    @Test
    void catalogSummaryPaginationKeepsLiteralSearchAndStableVersionOrder() throws Exception {
        ObjectNode body = draft();
        String search = "分页%_!" + UUID.randomUUID();
        body.put("name", search).put("version", "v2");
        String secondId = send(post("/admin-api/apis").content(body.toString())).get("id").asText();
        body.put("version", "v1");
        String firstId = send(post("/admin-api/apis").content(body.toString())).get("id").asText();
        JsonNode first = send(get("/admin-api/apis").param("query", search).param("pageSize", "1"));
        JsonNode second = send(get("/admin-api/apis").param("query", search).param("pageSize", "1").param("page", "2"));
        assertThat(first.get("total").asLong()).isEqualTo(2);
        assertThat(second.get("total").asLong()).isEqualTo(2);
        assertThat(first.at("/items/0/id").asText()).isEqualTo(firstId);
        assertThat(second.at("/items/0/id").asText()).isEqualTo(secondId);
        assertThat(send(get("/admin-api/publications/apis").param("query", search).param("pageSize", "1").param("page", "2")))
                .isEqualTo(second);
    }

    private void assertSummary(String service, String id, long draftRevision, Long liveDraftRevision,
                               boolean enabled, String pendingReleaseId) throws Exception {
        JsonNode catalogPage = send(get("/admin-api/apis").param("query", service));
        assertThat(send(get("/admin-api/publications/apis").param("query", service))).isEqualTo(catalogPage);
        assertThat(catalogPage.get("total").asLong()).isEqualTo(1);
        JsonNode summary = catalogPage.at("/items/0");
        assertThat(summary.get("id").asText()).isEqualTo(id);
        assertThat(summary.get("draftRevision").asLong()).isEqualTo(draftRevision);
        if (liveDraftRevision == null) assertThat(summary.get("liveDraftRevision").isNull()).isTrue();
        else assertThat(summary.get("liveDraftRevision").asLong()).isEqualTo(liveDraftRevision.longValue());
        assertThat(summary.get("enabled").asBoolean()).isEqualTo(enabled);
        assertThat(summary.get("pendingReleaseId")).isEqualTo(json.valueToTree(pendingReleaseId));
        assertThat(summary.has("definitionJson") || summary.has("snapshotJson") || summary.has("binding")).isFalse();
    }

    @Test
    void submitsImmutableSnapshotAndAppliesOnlyExplicitApproval() throws Exception {
        ObjectNode body = draft().put("description", "已提交说明");
        String id = send(post("/admin-api/apis").content(body.toString())).get("id").asText();
        JsonNode release = submit(id, 1, UUID.randomUUID().toString());
        assertThat(release.get("status").asText()).isEqualTo("PENDING");
        body.put("expectedRevision", 1).put("name", "后续草稿").put("description", "未发布说明");
        send(put("/admin-api/apis/" + id).content(body.toString()));
        JsonNode applied =
                send(
                        post("/admin-api/publications/" + release.get("id").asText() + "/approve")
                                .content("{\"comment\":\"通过\"}"));
        assertThat(applied.get("status").asText()).isEqualTo("APPLIED");
        assertThat(
                        send(get("/admin-api/publications/apis/" + id + "/effective"))
                                .at("/snapshot/name")
                                .asText())
                .isEqualTo("订单查询");
        assertThat(send(get("/admin-api/publications/apis/" + id + "/effective"))
                .at("/snapshot/description").asText()).isEqualTo("已提交说明");
    }

    @Test
    void reviewBaselineRemainsFixedAndAuditedResultsFilterBeforePagination() throws Exception {
        ObjectNode body = draft();
        String service = body.get("service").asText();
        String apiId = send(post("/admin-api/apis").content(body.toString())).get("id").asText();
        auditEnabled(false);
        JsonNode first = submit(apiId, 1, UUID.randomUUID().toString());
        assertThat(first.get("baselineKnown").asBoolean()).isTrue();
        assertThat(first.get("baseline").isNull()).isTrue();
        body.put("expectedRevision", 1).put("name", "第二版");
        send(put("/admin-api/apis/" + apiId).content(body.toString()));
        auditEnabled(true);
        JsonNode second = submit(apiId, 2, UUID.randomUUID().toString());
        assertThat(second.get("baseline")).isEqualTo(first.get("snapshot"));
        send(post("/admin-api/publications/" + second.get("id").asText() + "/approve")
                .content("{\"comment\":\"已核对差异\"}"));
        body.put("expectedRevision", 2).put("name", "第三版");
        send(put("/admin-api/apis/" + apiId).content(body.toString()));
        auditEnabled(false);
        submit(apiId, 3, UUID.randomUUID().toString());
        assertThat(send(get("/admin-api/publications/" + second.get("id").asText())).get("baseline"))
                .isEqualTo(first.get("snapshot"));
        JsonNode reviewed = send(get("/admin-api/publications").param("query", service)
                .param("status", "APPLIED").param("auditRequired", "true").param("pageSize", "1"));
        assertThat(reviewed.get("total").asInt()).isEqualTo(1);
        assertThat(reviewed.at("/items/0/id")).isEqualTo(second.get("id"));
        JsonNode direct = send(get("/admin-api/publications").param("query", service)
                .param("status", "APPLIED").param("auditRequired", "false").param("pageSize", "1").param("page", "2"));
        assertThat(direct.get("total").asInt()).isEqualTo(2);
        assertThat(direct.at("/items/0/id")).isEqualTo(first.get("id"));
        database.update("UPDATE publication_release SET baseline_known=FALSE,baseline_json=NULL WHERE id=?", second.get("id").asText());
        JsonNode legacy = send(get("/admin-api/publications/" + second.get("id").asText()));
        assertThat(legacy.get("baselineKnown").asBoolean()).isFalse();
        assertThat(legacy.get("baseline").isNull()).isTrue();
    }

    @Test
    void stalePreviewRequiresNewBaselineButSameSubmissionKeyStillFindsCommittedResult() throws Exception {
        auditEnabled(false);
        ObjectNode body = draft();
        String apiId = send(post("/admin-api/apis").content(body.toString())).get("id").asText();
        String firstKey = UUID.randomUUID().toString();
        JsonNode first = submit(apiId, 1, firstKey);
        ObjectNode stale = (ObjectNode) json.readTree(submission(1, UUID.randomUUID().toString()));
        mvc.perform(auth(post("/admin-api/publications/apis/" + apiId + "/submissions")
                        .content(stale.toString())))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.resultMsg").value("发布状态或生效基线已变化，请重新核对差异后提交"));
        stale.put("submissionKey", firstKey);
        assertThat(send(post("/admin-api/publications/apis/" + apiId + "/submissions")
                .content(stale.toString())).get("id")).isEqualTo(first.get("id"));
        stale.remove("expectedStateVersion");
        mvc.perform(auth(post("/admin-api/publications/apis/" + apiId + "/submissions")
                        .content(stale.toString())))
                .andExpect(status().isBadRequest());
        assertThat(send(get("/admin-api/publications/apis/" + apiId + "/state"))
                .get("stateVersion").asLong()).isEqualTo(1);
    }

    @Test
    void approvalRejectsChangedOrUnknownBaselineAndKeepsCandidatePending() throws Exception {
        auditEnabled(false);
        ObjectNode body = draft();
        String apiId = send(post("/admin-api/apis").content(body.toString())).get("id").asText();
        JsonNode first = submit(apiId, 1, UUID.randomUUID().toString());
        body.put("expectedRevision", 1).put("name", "第二版");
        send(put("/admin-api/apis/" + apiId).content(body.toString()));
        JsonNode second = submit(apiId, 2, UUID.randomUUID().toString());
        body.put("expectedRevision", 2).put("name", "待审核第三版");
        send(put("/admin-api/apis/" + apiId).content(body.toString()));
        auditEnabled(true);
        JsonNode pending = submit(apiId, 3, UUID.randomUUID().toString());
        String releaseId = pending.get("id").asText();
        // 模拟外部修改运行指针；正常发布路径由父行锁及单个待审约束禁止此状态。
        database.update("UPDATE publication_state SET live_release_id=? WHERE api_id=?", first.get("id").asText(), apiId);
        mvc.perform(auth(post("/admin-api/publications/" + releaseId + "/approve")
                        .content("{\"comment\":\"核对后通过\"}")))
                .andExpect(status().isConflict());
        assertThat(send(get("/admin-api/publications/" + releaseId)).get("status").asText()).isEqualTo("PENDING");
        database.update("UPDATE publication_state SET live_release_id=? WHERE api_id=?", second.get("id").asText(), apiId);
        database.update("UPDATE publication_release SET baseline_known=FALSE,baseline_json=NULL WHERE id=?", releaseId);
        mvc.perform(auth(post("/admin-api/publications/" + releaseId + "/approve")
                        .content("{\"comment\":\"旧数据缺少基线\"}")))
                .andExpect(status().isConflict());
        assertThat(send(get("/admin-api/publications/apis/" + apiId + "/effective")).get("releaseId"))
                .isEqualTo(second.get("id"));
        send(post("/admin-api/publications/" + releaseId + "/reject").content("{\"comment\":\"重新核对后提交\"}"));
    }

    @Test
    void scopeLabelsResolveCurrentNamesInOneBatchWithoutChangingFixedPublicationContent() throws Exception {
        ObjectNode body = draft();
        String code = body.at("/scopeCodes/0").asText();
        String apiId = send(post("/admin-api/apis").content(body.toString())).get("id").asText();
        JsonNode pending = submit(apiId, 1, UUID.randomUUID().toString());
        JsonNode scope = send(get("/admin-api/scopes").param("query", code)).at("/items/0");
        send(put("/admin-api/scopes/" + scope.get("id").asText())
                .content("{\"name\":\"当前已停用组\",\"enabled\":false,\"defaultForNewApplication\":false}"));
        TestAccount reviewer = new TestAccount();
        reviewer.setId(13L);
        reviewer.setTenantId("tenant-1");
        reviewer.setEmployeeNoStr("reviewer");
        when(identityService.current("test-session")).thenAnswer(invocation -> reviewer.toAccount());
        ObjectNode request = json.createObjectNode();
        request.putArray("codes").add(code).add(code).add("deleted_scope");
        JsonNode labels = send(post("/admin-api/publications/scope-labels").content(request.toString()));
        assertThat(labels.size()).isEqualTo(1);
        assertThat(labels.get(code).get("name").asText()).isEqualTo("当前已停用组");
        assertThat(labels.get(code).get("enabled").asBoolean()).isFalse();
        assertThat(send(get("/admin-api/publications/" + pending.get("id").asText())).get("snapshot"))
                .isEqualTo(pending.get("snapshot"));
        assertThat(send(post("/admin-api/publications/scope-labels").content("{\"codes\":[]}")).isEmpty()).isTrue();
        request.putArray("codes").add("bad code");
        mvc.perform(auth(post("/admin-api/publications/scope-labels").content(request.toString())))
                .andExpect(status().isBadRequest());
        request.set("codes", json.valueToTree(java.util.Collections.nCopies(201, code)));
        mvc.perform(auth(post("/admin-api/publications/scope-labels").content(request.toString())))
                .andExpect(status().isBadRequest());
        reviewer.setEmployeeNoStr("viewer");
        mvc.perform(auth(post("/admin-api/publications/scope-labels").content("{\"codes\":[]}")))
                .andExpect(status().isForbidden());
    }

    @Test
    void retriesAreIdempotentWithoutReapplyingAnOldRelease() throws Exception {
        ObjectNode body = draft();
        String id = send(post("/admin-api/apis").content(body.toString())).get("id").asText();
        String key = UUID.randomUUID().toString();
        JsonNode first = submit(id, 1, key);
        assertThat(send(get("/admin-api/publications/apis/" + id + "/submissions/" + key)).get("id"))
                .isEqualTo(first.get("id"));
        mvc.perform(auth(get("/admin-api/publications/apis/another-api/submissions/" + key)))
                .andExpect(status().isNotFound());
        mvc.perform(auth(get("/admin-api/publications/apis/" + id + "/submissions/" + UUID.randomUUID())))
                .andExpect(status().isNotFound());
        assertThat(submit(id, 1, key).get("id")).isEqualTo(first.get("id"));
        mvc.perform(
                        auth(
                                post("/admin-api/publications/apis/" + id + "/submissions")
                                        .content(submission(1, UUID.randomUUID().toString()))))
                .andExpect(status().isConflict());
        mvc.perform(
                        auth(
                                post("/admin-api/publications/apis/" + id + "/submissions")
                                        .content(submission(1, key).replace("上线", "不同备注"))))
                .andExpect(status().isConflict());
        send(
                post("/admin-api/publications/" + first.get("id").asText() + "/approve")
                        .content("{\"comment\":\"同意\"}"));
        body.put("expectedRevision", 1).put("name", "第二次发布");
        send(put("/admin-api/apis/" + id).content(body.toString()));
        auditEnabled(false);
        JsonNode second = submit(id, 2, UUID.randomUUID().toString());
        assertThat(second.get("status").asText()).isEqualTo("APPLIED");
        assertThat(submit(id, 1, key).get("id")).isEqualTo(first.get("id"));
        assertThat(send(get("/admin-api/publications/apis/" + id + "/effective")).get("releaseId"))
                .isEqualTo(second.get("id"));
        assertThat(
                        send(get("/admin-api/publications")
                                        .param("query", body.get("service").asText()))
                                .get("total")
                                .asInt())
                .isEqualTo(2);
    }

    @Test
    void configurationChangesNeverApproveExistingPendingAndRejectionPreservesCurrent()
            throws Exception {
        ObjectNode body = draft();
        String id = send(post("/admin-api/apis").content(body.toString())).get("id").asText();
        JsonNode pending = submit(id, 1, UUID.randomUUID().toString());
        auditEnabled(false);
        assertThat(send(get("/admin-api/publications/config")).get("auditEnabled").asBoolean())
                .isFalse();
        assertThat(
                        send(get("/admin-api/publications/" + pending.get("id").asText()))
                                .get("status")
                                .asText())
                .isEqualTo("PENDING");
        mvc.perform(auth(get("/admin-api/publications/apis/" + id + "/effective")))
                .andExpect(status().isNotFound());
        JsonNode rejected =
                send(
                        post("/admin-api/publications/" + pending.get("id").asText() + "/reject")
                                .content("{\"comment\":\"结构需调整\"}"));
        assertThat(rejected.get("status").asText()).isEqualTo("REJECTED");
        assertThat(rejected.get("reviewComment").asText()).isEqualTo("结构需调整");
        mvc.perform(
                        auth(
                                post("/admin-api/publications/"
                                                + pending.get("id").asText()
                                                + "/approve")
                                        .content("{\"comment\":\"重复\"}")))
                .andExpect(status().isConflict());
        JsonNode direct = submit(id, 1, UUID.randomUUID().toString());
        assertThat(direct.get("auditRequired").asBoolean()).isFalse();
        assertThat(send(get("/admin-api/apis").param("query", body.get("service").asText()).param("review", "NOT_REQUIRED"))
                .at("/items/0/id").asText()).isEqualTo(id);
        auditEnabled(true);
        JsonNode next = submit(id, 1, UUID.randomUUID().toString());
        send(
                post("/admin-api/publications/" + next.get("id").asText() + "/reject")
                        .content("{\"comment\":\"保持线上\"}"));
        assertThat(send(get("/admin-api/publications/apis/" + id + "/effective")).get("releaseId"))
                .isEqualTo(direct.get("id"));
    }

    @Test
    void emergencyDisableSurvivesApprovalAndOnlyExplicitRestoreEnablesCurrentVersion()
            throws Exception {
        ObjectNode body = draft();
        String id = send(post("/admin-api/apis").content(body.toString())).get("id").asText();
        JsonNode initial = send(get("/admin-api/publications/apis/" + id + "/state"));
        assertThat(initial.get("stateVersion").asLong()).isZero();
        assertThat(
                        database.queryForObject(
                                "SELECT COUNT(*) FROM publication_state WHERE api_id=?",
                                Integer.class,
                                id))
                .isZero();
        mvc.perform(
                        auth(
                                put("/admin-api/publications/apis/" + id + "/status")
                                        .content(statusBody(true, 0))))
                .andExpect(status().isNotFound());
        JsonNode pending = submit(id, 1, UUID.randomUUID().toString());
        JsonNode disabled =
                send(
                        put("/admin-api/publications/apis/" + id + "/status")
                                .content(statusBody(false, 1)));
        assertThat(disabled.get("enabled").asBoolean()).isFalse();
        send(
                post("/admin-api/publications/" + pending.get("id").asText() + "/approve")
                        .content("{\"comment\":\"通过\"}"));
        JsonNode effective = send(get("/admin-api/publications/apis/" + id + "/effective"));
        assertThat(effective.get("enabled").asBoolean()).isFalse();
        body.put("expectedRevision", 1).put("name", "尚未发布草稿");
        send(put("/admin-api/apis/" + id).content(body.toString()));
        mvc.perform(
                        auth(
                                put("/admin-api/publications/apis/" + id + "/status")
                                        .content(statusBody(true, 2))))
                .andExpect(status().isConflict());
        JsonNode restored =
                send(
                        put("/admin-api/publications/apis/" + id + "/status")
                                .content(statusBody(true, 3)));
        assertThat(restored.get("enabled").asBoolean()).isTrue();
        assertThat(
                        send(get("/admin-api/publications/apis/" + id + "/effective"))
                                .at("/snapshot/name")
                                .asText())
                .isEqualTo("订单查询");
    }

    @Test
    void unavailableSubmittedScopeFailsReviewWithoutChangingLiveRelease() throws Exception {
        ObjectNode body = draft();
        String id = send(post("/admin-api/apis").content(body.toString())).get("id").asText();
        auditEnabled(false);
        JsonNode live = submit(id, 1, UUID.randomUUID().toString());
        auditEnabled(true);
        JsonNode pending = submit(id, 1, UUID.randomUUID().toString());
        JsonNode scope =
                send(get("/admin-api/scopes").param("query", body.at("/scopeCodes/0").asText()))
                        .at("/items/0");
        send(
                put("/admin-api/scopes/" + scope.get("id").asText())
                        .content(
                                "{\"name\":\"停用\",\"enabled\":false,\"defaultForNewApplication\":false}"));
        JsonNode failed =
                send(
                        post("/admin-api/publications/" + pending.get("id").asText() + "/approve")
                                .content("{\"comment\":\"检查\"}"));
        assertThat(failed.get("status").asText()).isEqualTo("FAILED");
        assertThat(failed.get("failureReason").asText()).contains("权限组");
        assertThat(
                        send(get("/admin-api/publications/apis/" + id + "/state"))
                                .get("pendingReleaseId")
                                .isNull())
                .isTrue();
        assertThat(send(get("/admin-api/publications/apis/" + id + "/effective")).get("releaseId"))
                .isEqualTo(live.get("id"));
        mvc.perform(
                        auth(
                                post("/admin-api/publications/apis/" + id + "/submissions")
                                        .content(submission(1, UUID.randomUUID().toString()))))
                .andExpect(status().isBadRequest());
        assertThat(
                        send(get("/admin-api/publications/apis/" + id + "/audit"))
                                .get("items")
                                .toString())
                .contains("FAILURE")
                .doesNotContain("internal.example");
    }

    @Test
    void databaseFailureRollsBackApprovalAndRecordsSafeFailureBeforeRetry() throws Exception {
        ObjectNode body = draft();
        String id = send(post("/admin-api/apis").content(body.toString())).get("id").asText();
        JsonNode pending = submit(id, 1, UUID.randomUUID().toString());
        String releaseId = pending.get("id").asText();
        database.execute(
                "ALTER TABLE publication_audit ADD CONSTRAINT test_reject_approval CHECK (NOT"
                        + " (action='APPROVE' AND outcome='SUCCESS' AND api_id='"
                        + id
                        + "'))");
        try {
            mvc.perform(
                            auth(
                                    post("/admin-api/publications/" + releaseId + "/approve")
                                            .content("{\"comment\":\"通过\"}")))
                    .andExpect(status().isConflict());
            assertThat(send(get("/admin-api/publications/" + releaseId)).get("status").asText())
                    .isEqualTo("PENDING");
            JsonNode state = send(get("/admin-api/publications/apis/" + id + "/state"));
            assertThat(state.get("liveReleaseId").isNull()).isTrue();
            assertThat(state.get("stateVersion").asLong()).isEqualTo(1);
            assertThat(
                            send(get("/admin-api/publications/apis/" + id + "/audit"))
                                    .at("/items/0/outcome")
                                    .asText())
                    .isEqualTo("FAILURE");
        } finally {
            database.execute("ALTER TABLE publication_audit DROP CONSTRAINT test_reject_approval");
        }
        assertThat(
                        send(post("/admin-api/publications/" + releaseId + "/approve")
                                        .content("{\"comment\":\"重试\"}"))
                                .get("status")
                                .asText())
                .isEqualTo("APPLIED");
    }

    @Test
    void concurrentSubmissionsAndReviewDecisionsHaveOneWinner() throws Exception {
        ObjectNode body = draft();
        String id = send(post("/admin-api/apis").content(body.toString())).get("id").asText();
        try (var executor = java.util.concurrent.Executors.newFixedThreadPool(2)) {
            var ready = new java.util.concurrent.CountDownLatch(2);
            var start = new java.util.concurrent.CountDownLatch(1);
            java.util.concurrent.Callable<Integer> submit =
                    () -> {
                        ready.countDown();
                        start.await(5, java.util.concurrent.TimeUnit.SECONDS);
                        return mvc.perform(
                                        auth(
                                                post("/admin-api/publications/apis/"
                                                                + id
                                                                + "/submissions")
                                                        .content(
                                                                submission(
                                                                        1,
                                                                        UUID.randomUUID()
                                                                                .toString()))))
                                .andReturn()
                                .getResponse()
                                .getStatus();
                    };
            var a = executor.submit(submit);
            var b = executor.submit(submit);
            assertThat(ready.await(5, java.util.concurrent.TimeUnit.SECONDS)).isTrue();
            start.countDown();
            assertThat(
                            java.util.List.of(
                                    a.get(10, java.util.concurrent.TimeUnit.SECONDS),
                                    b.get(10, java.util.concurrent.TimeUnit.SECONDS)))
                    .containsExactlyInAnyOrder(200, 409);
            String releaseId =
                    send(get("/admin-api/publications/apis/" + id + "/state"))
                            .get("pendingReleaseId")
                            .asText();
            var reviewStart = new java.util.concurrent.CountDownLatch(1);
            java.util.concurrent.Callable<Integer> approve =
                    () -> {
                        reviewStart.await(5, java.util.concurrent.TimeUnit.SECONDS);
                        return mvc.perform(
                                        auth(
                                                post("/admin-api/publications/"
                                                                + releaseId
                                                                + "/approve")
                                                        .content("{\"comment\":\"通过\"}")))
                                .andReturn()
                                .getResponse()
                                .getStatus();
                    };
            var first = executor.submit(approve);
            var second = executor.submit(approve);
            reviewStart.countDown();
            assertThat(
                            java.util.List.of(
                                    first.get(10, java.util.concurrent.TimeUnit.SECONDS),
                                    second.get(10, java.util.concurrent.TimeUnit.SECONDS)))
                    .containsExactlyInAnyOrder(200, 409);
            assertThat(
                            send(get("/admin-api/publications/apis/" + id + "/state"))
                                    .get("stateVersion")
                                    .asLong())
                    .isEqualTo(2);
        }
    }

    @Test
    void publicDocumentUsesTokenScopeAndOnlyTheLiveSnapshot() throws Exception {
        ObjectNode body = draft();
        String id = send(post("/admin-api/apis").content(body.toString())).get("id").asText();
        String path = "/api/docs/" + body.get("service").asText() + "/v1/query";
        mvc.perform(get(path)).andExpect(status().isUnauthorized());
        JsonNode app =
                send(
                        post("/admin-api/applications")
                                .content("{\"name\":\"文档调用方\",\"ownerTenantId\":\"tenant-1\"}"));
        String appId = app.at("/application/id").asText();
        send(
                put("/admin-api/applications/" + appId + "/scopes")
                        .content("{\"scopeCodes\":" + body.get("scopeCodes") + "}"));
        ObjectNode credentials =
                json.createObjectNode()
                        .put("appKey", app.at("/application/appKey").asText())
                        .put("appSecret", app.get("appSecret").asText())
                        .put("tenantId", "tenant-1");
        send(post("/admin-api/tenant-grants").content(credentials.toString()));
        String token =
                send(post("/api/token").content(credentials.toString()))
                        .get("accessToken")
                        .asText();
        mvc.perform(get(path).header("Authorization", "Bearer " + token))
                .andExpect(status().isNotFound());
        auditEnabled(false);
        JsonNode live = submit(id, 1, UUID.randomUUID().toString());
        var response =
                mvc.perform(get(path).header("Authorization", "Bearer " + token))
                        .andExpect(status().isOk())
                        .andExpect(header().string("Cache-Control", "no-store"))
                        .andReturn()
                        .getResponse();
        assertThat(response.getContentAsString())
                .contains("1234567890.1234567890123456789")
                .doesNotContain("internal.example", "binding", "草稿预览");
        body.put("expectedRevision", 1).put("name", "未发布改动");
        send(put("/admin-api/apis/" + id).content(body.toString()));
        JsonNode document = send(get(path).header("Authorization", "Bearer " + token));
        assertThat(document.get("releaseId")).isEqualTo(live.get("id"));
        assertThat(document.at("/document/title").asText()).isEqualTo("订单查询");
        send(put("/admin-api/publications/apis/" + id + "/status").content(statusBody(false, 1)));
        mvc.perform(get(path).header("Authorization", "Bearer " + token))
                .andExpect(status().isNotFound());
        send(put("/admin-api/publications/apis/" + id + "/status").content(statusBody(true, 2)));
        send(put("/admin-api/applications/" + appId + "/scopes").content("{\"scopeCodes\":[]}"));
        String otherToken =
                send(post("/api/token").content(credentials.toString()))
                        .get("accessToken")
                        .asText();
        mvc.perform(get(path).header("Authorization", "Bearer " + otherToken))
                .andExpect(status().isForbidden());
        mvc.perform(get(path).header("Authorization", "Bearer " + token))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void validatesPermissionsCsrfPaginationAndStaleDraftBeforePublishing() throws Exception {
        ObjectNode body = draft();
        String id = send(post("/admin-api/apis").content(body.toString())).get("id").asText();
        mvc.perform(get("/admin-api/publications")).andExpect(status().isUnauthorized());
        mvc.perform(
                        post("/admin-api/publications/apis/" + id + "/submissions")
                                .session(io.github.chenyilei2016.openplatform.testing.TestSessions.session("test-session"))
                                .contentType("application/json")
                                .content(submission(1, UUID.randomUUID().toString())))
                .andExpect(status().isForbidden());
        mvc.perform(auth(get("/admin-api/publications").param("pageSize", "101")))
                .andExpect(status().isBadRequest());
        mvc.perform(auth(get("/admin-api/publications").param("page", "wrong")))
                .andExpect(status().isBadRequest());
        mvc.perform(
                        auth(
                                post("/admin-api/publications/apis/" + id + "/submissions")
                                        .content(submission(9, UUID.randomUUID().toString()))))
                .andExpect(status().isConflict());
        mvc.perform(
                        auth(
                                post("/admin-api/publications/apis/" + id + "/submissions")
                                        .content(submission(1, "bad-key"))))
                .andExpect(status().isBadRequest());
        body.put("expectedRevision", 1).set("scopeCodes", json.createArrayNode());
        send(put("/admin-api/apis/" + id).content(body.toString()));
        mvc.perform(
                        auth(
                                post("/admin-api/publications/apis/" + id + "/submissions")
                                        .content(submission(2, UUID.randomUUID().toString()))))
                .andExpect(status().isBadRequest());
    }

    @Test
    void publisherAndReviewerHaveIndependentPermissions() throws Exception {
        ObjectNode body = draft();
        String id = send(post("/admin-api/apis").content(body.toString())).get("id").asText();
        TestAccount user = new TestAccount();
        user.setId(13L);
        user.setTenantId("tenant-1");
        user.setEmployeeNoStr("publisher");
        when(identityService.current("test-session"))
                .thenAnswer(invocation -> user.toAccount());
        JsonNode candidate = send(get("/admin-api/publications/apis/" + id + "/candidate"));
        assertThat(candidate.get("id").asText()).isEqualTo(id);
        assertThat(candidate.get("draftRevision").asLong()).isEqualTo(1);
        assertThat(candidate.at("/binding/http/url").asText()).isNotBlank();
        assertThat(send(get("/admin-api/publications/apis/" + id + "/state")).get("stateVersion").asLong()).isZero();
        mvc.perform(auth(get("/admin-api/publications/apis/missing/candidate"))).andExpect(status().isNotFound());
        JsonNode pending = submit(id, 1, UUID.randomUUID().toString());
        String releaseId = pending.get("id").asText();
        mvc.perform(auth(get("/admin-api/apis/" + id))).andExpect(status().isForbidden());
        mvc.perform(
                        auth(
                                post("/admin-api/publications/" + releaseId + "/approve")
                                        .content("{\"comment\":\"无权\"}")))
                .andExpect(status().isForbidden());
        user.setEmployeeNoStr("reviewer");
        mvc.perform(auth(get("/admin-api/publications/apis/" + id + "/candidate"))).andExpect(status().isForbidden());
        assertThat(send(get("/admin-api/publications/" + releaseId)).at("/snapshot/name").asText())
                .isEqualTo("订单查询");
        mvc.perform(
                        auth(
                                post("/admin-api/publications/apis/" + id + "/submissions")
                                        .content(submission(1, UUID.randomUUID().toString()))))
                .andExpect(status().isForbidden());
        mvc.perform(
                        auth(
                                put("/admin-api/publications/apis/" + id + "/status")
                                        .content(statusBody(false, 1))))
                .andExpect(status().isForbidden());
        assertThat(
                        send(post("/admin-api/publications/" + releaseId + "/approve")
                                        .content("{\"comment\":\"审核通过\"}"))
                                .get("status")
                                .asText())
                .isEqualTo("APPLIED");
        user.setEmployeeNoStr("viewer");
        mvc.perform(auth(get("/admin-api/publications"))).andExpect(status().isForbidden());
    }

    @Test
    void concurrentRetryReturnsCommittedSubmissionAfterScopeChanges() throws Exception {
        ObjectNode body = draft();
        String id = send(post("/admin-api/apis").content(body.toString())).get("id").asText();
        String key = UUID.randomUUID().toString();
        PauseDraftRead.paused = new java.util.concurrent.CountDownLatch(1);
        PauseDraftRead.resume = new java.util.concurrent.CountDownLatch(1);
        database.execute(
                "CREATE TRIGGER publication_pause BEFORE SELECT ON catalog_api_draft CALL"
                    + " 'io.github.chenyilei2016.openplatform.publication.PublicationManagementHttpTest$PauseDraftRead'");
        try (var executor = java.util.concurrent.Executors.newSingleThreadExecutor()) {
            var retry =
                    executor.submit(
                            () -> {
                                PauseDraftRead.thread = Thread.currentThread();
                                return submit(id, 1, key);
                            });
            try {
                assertThat(PauseDraftRead.paused.await(5, java.util.concurrent.TimeUnit.SECONDS))
                        .isTrue();
                JsonNode committed = submit(id, 1, key);
                JsonNode scope =
                        send(get("/admin-api/scopes")
                                        .param("query", body.at("/scopeCodes/0").asText()))
                                .at("/items/0");
                send(
                        put("/admin-api/scopes/" + scope.get("id").asText())
                                .content(
                                        "{\"name\":\"停用\",\"enabled\":false,\"defaultForNewApplication\":false}"));
                PauseDraftRead.resume.countDown();
                assertThat(retry.get(10, java.util.concurrent.TimeUnit.SECONDS).get("id"))
                        .isEqualTo(committed.get("id"));
                assertThat(
                                database.queryForObject(
                                        "SELECT COUNT(*) FROM publication_release WHERE api_id=?",
                                        Integer.class,
                                        id))
                        .isEqualTo(1);
                assertThat(
                                send(get("/admin-api/publications/apis/" + id + "/audit"))
                                        .get("total")
                                        .asInt())
                        .isEqualTo(1);
            } finally {
                PauseDraftRead.resume.countDown();
            }
        } finally {
            database.execute("DROP TRIGGER publication_pause");
            PauseDraftRead.thread = null;
        }
    }

    /** 用真实H2 SELECT闸门固定竞争窗口，不替换自有仓储或生产事务。 */
    public static class PauseDraftRead implements org.h2.api.Trigger {
        static volatile Thread thread;
        static java.util.concurrent.CountDownLatch paused;
        static java.util.concurrent.CountDownLatch resume;

        @Override
        public void fire(java.sql.Connection connection, Object[] oldRow, Object[] newRow)
                throws java.sql.SQLException {
            if (Thread.currentThread() != thread) return;
            thread = null;
            paused.countDown();
            try {
                if (!resume.await(10, java.util.concurrent.TimeUnit.SECONDS))
                    throw new java.sql.SQLException("test gate timed out");
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
                throw new java.sql.SQLException("test gate interrupted", interrupted);
            }
        }
    }

    @Test
    void catalogSaveAndPublishFollowSameScopeThenApiLockOrder() throws Exception {
        ObjectNode body = draft();
        String id = send(post("/admin-api/apis").content(body.toString())).get("id").asText();
        body.put("expectedRevision", 1).put("name", "并发新草稿");
        try (var executor = java.util.concurrent.Executors.newFixedThreadPool(2)) {
            var start = new java.util.concurrent.CountDownLatch(1);
            var publish =
                    executor.submit(
                            () -> {
                                start.await(5, java.util.concurrent.TimeUnit.SECONDS);
                                return mvc.perform(
                                                auth(
                                                        post("/admin-api/publications/apis/"
                                                                        + id
                                                                        + "/submissions")
                                                                .content(
                                                                        submission(
                                                                                1,
                                                                                UUID.randomUUID()
                                                                                        .toString()))))
                                        .andReturn()
                                        .getResponse();
                            });
            var edit =
                    executor.submit(
                            () -> {
                                start.await(5, java.util.concurrent.TimeUnit.SECONDS);
                                return send(put("/admin-api/apis/" + id).content(body.toString()));
                            });
            start.countDown();
            var response = publish.get(10, java.util.concurrent.TimeUnit.SECONDS);
            assertThat(
                            edit.get(10, java.util.concurrent.TimeUnit.SECONDS)
                                    .get("draftRevision")
                                    .asLong())
                    .isEqualTo(2);
            assertThat(response.getStatus()).isIn(200, 409);
            if (response.getStatus() == 200)
                assertThat(
                                json.readTree(response.getContentAsString())
                                        .at("/data/snapshot/name")
                                        .asText())
                        .isEqualTo("订单查询");
            else
                assertThat(
                                send(get("/admin-api/publications/apis/" + id + "/state"))
                                        .get("pendingReleaseId")
                                        .isNull())
                        .isTrue();
        }
    }

    private String submission(long revision, String key) {
        return "{\"expectedDraftRevision\":"
                + revision
                + ",\"expectedStateVersion\":0,\"submissionKey\":\""
                + key
                + "\",\"comment\":\"上线\"}";
    }

    private String statusBody(boolean enabled, long version) {
        return "{\"enabled\":"
                + enabled
                + ",\"expectedStateVersion\":"
                + version
                + ",\"reason\":\"人工控制\"}";
    }

    private JsonNode submit(String id, long revision, String key) throws Exception {
        long stateVersion = send(get("/admin-api/publications/apis/" + id + "/state"))
                .get("stateVersion").asLong();
        ObjectNode body = (ObjectNode) json.readTree(submission(revision, key));
        body.put("expectedStateVersion", stateVersion);
        return send(post("/admin-api/publications/apis/" + id + "/submissions").content(body.toString()));
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
        var response = mvc.perform(auth(r)).andReturn().getResponse();
        assertThat(response.getStatus())
                .as("HTTP response: %s", response.getContentAsString())
                .isEqualTo(200);
        return json.readTree(response.getContentAsString()).get("data");
    }
}
