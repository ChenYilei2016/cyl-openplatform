package io.github.chenyilei2016.openplatform.governance;

import io.github.chenyilei2016.openplatform.application.governance.GovernanceRuleManagementRepository;
import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.github.chenyilei2016.openplatform.domain.governance.GovernanceRequest;
import io.github.chenyilei2016.openplatform.domain.governance.GovernanceRule;
import io.github.chenyilei2016.openplatform.domain.governance.GovernanceRuleRepository;
import io.github.chenyilei2016.openplatform.domain.observability.CallMode;
import io.github.chenyilei2016.openplatform.testing.TestAdministrators;

import io.github.chenyilei2016.openplatform.application.identity.AccountAuthentication;
import io.github.chenyilei2016.openplatform.testing.TestAccount;
import jakarta.servlet.http.Cookie;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.webmvc.test.autoconfigure.MockMvcPrint;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@TestAdministrators
@SpringBootTest(properties = {

        "test.admin.operators[0].tenant-id=tenant-1", "test.admin.operators[0].employee-no=operator-1",
        "test.admin.operators[0].permissions[0]=MANAGE_APIS", "test.admin.operators[0].permissions[1]=MANAGE_APPLICATIONS",
        "test.admin.operators[0].permissions[2]=VIEW_AUDIT",
        "test.admin.operators[1].tenant-id=tenant-1", "test.admin.operators[1].employee-no=application-only",
        "test.admin.operators[1].permissions[0]=MANAGE_APPLICATIONS"
})
@AutoConfigureMockMvc(print = MockMvcPrint.NONE)
@org.springframework.context.annotation.Import(io.github.chenyilei2016.openplatform.testing.CatalogReferenceFixture.class)
class GovernanceRuleManagementHttpTest {
    @Autowired MockMvc mvc;
    @Autowired GovernanceRuleRepository runtime;
    @MockitoSpyBean GovernanceRuleManagementRepository management;
    @MockitoBean AccountAuthentication identity;
    private final JsonMapper json = JsonMapper.builder().build();

    @BeforeEach void login() {
        TestAccount user = new TestAccount(); user.setId(12L); user.setTenantId("tenant-1"); user.setEmployeeNoStr("operator-1");
        when(identity.current("test-session")).thenAnswer(invocation -> user.toAccount());
    }

    @Test void publishesFixedBaselinesAndRollsBackAsANewRelease() throws Exception {
        JsonNode application = application();
        String applicationId = application.at("/application/id").asText();
        ObjectNode config = config("APPLICATION", null, applicationId, null);
        JsonNode draft = create("版本验收", config);
        String id = draft.get("id").asText();
        assertThat(draft.at("/targetDisplay/applicationName").asText()).isEqualTo("治理测试");
        assertThat(draft.at("/targetDisplay/appKey").asText()).isEqualTo(application.at("/application/appKey").asText());
        ObjectNode unchanged = json.createObjectNode().put("name", "版本验收 ").put("expectedDraftRevision", 1);
        unchanged.set("config", config);
        JsonNode unchangedResult = send(put(path(id)).content(unchanged.toString()));
        assertThat(unchangedResult.at("/targetDisplay/applicationName").asText()).isEqualTo("治理测试");
        assertThat(unchangedResult.get("draftRevision").asLong()).isEqualTo(1);
        GovernanceRequest request = new GovernanceRequest(applicationId, "tenant-1", "api-unused", "127.0.0.1", CallMode.PRODUCTION);
        assertThat(runtime.findApplicable(request)).isEmpty();
        assertThat(send(get("/admin-api/governance-rules").param("appKey", application.at("/application/appKey").asText())
                .param("mode", "ENFORCE")).get("total").asLong()).isZero();
        JsonNode firstPreview = preview(id, null);
        JsonNode first = publish(id, firstPreview);
        assertThat(first.at("/rule/version").asLong()).isEqualTo(1);
        assertThat(send(get(path(id) + "/results").param("previewDigest", firstPreview.get("digest").asText()))).isEqualTo(first);
        mvc.perform(auth(post(path(id) + "/publish").content(publication(firstPreview).toString()))).andExpect(status().isConflict());
        config.put("dailyQuota", 20).put("mode", "OBSERVE");
        ObjectNode save = json.createObjectNode().put("name", "修改后名称").put("expectedDraftRevision", 1); save.set("config", config);
        send(put(path(id)).content(save.toString()));
        assertThat(send(get("/admin-api/governance-rules").param("appKey", application.at("/application/appKey").asText())
                .param("mode", "ENFORCE")).get("total").asLong()).isEqualTo(1);
        assertThat(send(get("/admin-api/governance-rules").param("appKey", application.at("/application/appKey").asText())
                .param("mode", "OBSERVE")).get("total").asLong()).isZero();
        publish(id, preview(id, null));
        JsonNode rolledBack = publish(id, preview(id, first.get("id").asText()));
        assertThat(rolledBack.at("/rule/version").asLong()).isEqualTo(3);
        assertThat(rolledBack.at("/rule/dailyQuota").asLong()).isEqualTo(10);
        assertThat(rolledBack.get("sourceReleaseId").asText()).isEqualTo(first.get("id").asText());
        JsonNode current = send(get(path(id)));
        assertThat(current.at("/config/dailyQuota").asLong()).isEqualTo(20);
        assertThat(current.at("/liveRule/dailyQuota").asLong()).isEqualTo(10);
        assertThat(current.get("draftRevision").asLong()).isEqualTo(2);
        assertThat(current.get("liveName").asText()).isEqualTo("版本验收");
        assertThat(send(get(path(id) + "/releases")).get("total").asLong()).isEqualTo(3);
        assertThat(runtime.findApplicable(request)).singleElement().satisfies(rule -> assertThat(rule.version()).isEqualTo(3));
        assertThat(send(get("/admin-api/observability/audits").param("targetId", id)).get("items").toString())
                .contains("PUBLISH_GOVERNANCE", "ROLLBACK_GOVERNANCE");
    }

    @Test void readsFiveTargetsWithPublishedDisabledRulesAndFiltersByExactTargetsAndPermissions() throws Exception {
        JsonNode application = application();
        String applicationId = application.at("/application/id").asText();
        String appKey = application.at("/application/appKey").asText();
        String tenant = "t" + UUID.randomUUID().toString().replace("-", "") + "x".repeat(31);
        String apiId = send(post("/admin-api/apis").content("""
                {"service":"gov_%s","version":"v1","method":"query","name":"治理接口","category":"测试","owner":"测试",
                 "scopeCodes":[],"requestSchema":{"type":"OBJECT"},"responseSchema":{"type":"STRING"},"errorDefinitions":[],
                 "binding":{"protocol":"HTTP","timeoutMillis":3000,"http":{"url":"https://internal.example/query","method":"POST"}},"mappings":[]}
                """.formatted(UUID.randomUUID().toString().replace("-", "")))).get("id").asText();
        String suffix = UUID.randomUUID().toString();
        String combinedId = null;
        for (String type : List.of("APPLICATION", "API", "TENANT", "TENANT_API", "APPLICATION_API")) {
            ObjectNode config = config(type, type.startsWith("TENANT") ? tenant : null,
                    type.startsWith("APPLICATION") ? applicationId : null, type.contains("API") ? apiId : null);
            if (type.equals("TENANT")) config.put("enabled", false);
            String id = create("字面%_" + suffix, config).get("id").asText();
            publish(id, preview(id, null));
            if (type.equals("TENANT_API")) combinedId = id;
        }
        List<GovernanceRule> rules = runtime.findApplicable(new GovernanceRequest(applicationId, tenant, apiId, "127.0.0.1", CallMode.PRODUCTION));
        assertThat(rules).hasSize(5);
        assertThat(rules).filteredOn(rule -> rule.target().type() == GovernanceRule.Type.TENANT).singleElement()
                .satisfies(rule -> assertThat(rule.enabled()).isFalse());
        JsonNode defaults = send(get("/admin-api/governance-rules").param("nameContains", " ").param("type", "")
                .param("tenantId", " ").param("appKey", "").param("apiId", " ").param("mode", ""));
        assertThat(defaults.get("page").asInt()).isEqualTo(1);
        assertThat(defaults.get("total").asLong()).isGreaterThanOrEqualTo(5);
        JsonNode filtered = send(get("/admin-api/governance-rules").param("nameContains", "%_" + suffix).param("pageSize", "2").param("page", "2"));
        JsonNode apiTarget = send(get(path(combinedId)));
        assertThat(apiTarget.at("/targetDisplay/apiName").asText()).isEqualTo("治理接口");
        assertThat(apiTarget.at("/targetDisplay/version").asText()).isEqualTo("v1");
        assertThat(apiTarget.at("/targetDisplay/method").asText()).isEqualTo("query");
        assertThat(filtered.get("total").asLong()).isEqualTo(5); assertThat(filtered.get("items").size()).isEqualTo(2);
        assertThat(send(get("/admin-api/governance-rules").param("nameContains", suffix).param("appKey", appKey)).get("total").asLong()).isEqualTo(2);
        assertThat(send(get("/admin-api/governance-rules").param("nameContains", suffix).param("tenantId", tenant).param("apiId", apiId)).get("total").asLong()).isEqualTo(1);
        String counts = "/admin-api/governance-rules/association-counts";
        assertThat(send(get(counts).param("targetType", "API").param("targetId", apiId, apiId, "missing"))
                .get(apiId).asLong()).isEqualTo(3);
        String pendingApplication = application().at("/application/id").asText();
        String pendingRule = create("未发布停用规则", config("APPLICATION", null, pendingApplication, null).put("enabled", false)).get("id").asText();
        JsonNode batch = send(get(counts).param("targetType", "APPLICATION").param("targetId", applicationId, pendingApplication, "missing"));
        assertThat(batch.size()).isEqualTo(2);
        assertThat(batch.get(applicationId).asLong()).isEqualTo(2);
        assertThat(batch.get(pendingApplication).asLong()).isEqualTo(1);
        publish(pendingRule, preview(pendingRule, null));
        assertThat(send(get(counts).param("targetType", "APPLICATION").param("targetId", pendingApplication))
                .get(pendingApplication).asLong()).isEqualTo(1);
        assertThat(send(get(counts).param("targetType", "TENANT").param("targetId", tenant, tenant)).get(tenant).asLong()).isEqualTo(2);
        mvc.perform(auth(get(counts).param("targetType", "TENANT").param("targetId", "t".repeat(65)))).andExpect(status().isBadRequest());
        mvc.perform(auth(get(counts).param("targetType", "TENANT_API").param("targetId", tenant))).andExpect(status().isBadRequest());
        mvc.perform(auth(get(counts).param("targetType", "API").param("targetId", "bad!"))).andExpect(status().isBadRequest());
        mvc.perform(auth(get(counts).param("targetType", "API").param("targetId", java.util.Collections.nCopies(101, apiId).toArray(String[]::new))))
                .andExpect(status().isBadRequest());
        TestAccount restricted = new TestAccount(); restricted.setId(12L); restricted.setTenantId("tenant-1"); restricted.setEmployeeNoStr("application-only");
        when(identity.current("test-session")).thenAnswer(invocation -> restricted.toAccount());
        assertThat(send(get("/admin-api/governance-rules").param("nameContains", suffix)).get("total").asLong()).isEqualTo(2);
        assertThat(send(get(counts).param("targetType", "APPLICATION").param("targetId", applicationId)).get(applicationId).asLong()).isEqualTo(1);
        assertThat(send(get(counts).param("targetType", "TENANT").param("targetId", tenant)).get(tenant).asLong()).isEqualTo(1);
        mvc.perform(auth(get(counts).param("targetType", "API").param("targetId", apiId))).andExpect(status().isForbidden());
        mvc.perform(auth(get(path(combinedId)))).andExpect(status().isForbidden());
        mvc.perform(auth(get("/admin-api/governance-rules").param("type", "TENANT_API"))).andExpect(status().isForbidden());
    }

    @Test void failedPointerUpdateRollsBackReleaseAndSuccessAudit() throws Exception {
        String id = create("失败回滚", config("TENANT", "failure_" + UUID.randomUUID().toString().replace("-", ""), null, null)).get("id").asText();
        JsonNode preview = preview(id, null);
        doThrow(new PlatformException(ErrorCode.INTERNAL_ERROR, "injected publication pointer failure")).when(management).save(any(), anyLong(), anyLong());
        mvc.perform(auth(post(path(id) + "/publish").content(publication(preview).toString()))).andExpect(status().isInternalServerError());
        assertThat(send(get(path(id) + "/releases")).get("total").asLong()).isZero();
        assertThat(send(get(path(id))).get("stateVersion").asLong()).isZero();
        mvc.perform(auth(get(path(id) + "/results").param("previewDigest", preview.get("digest").asText()))).andExpect(status().isNotFound());
        JsonNode audits = send(get("/admin-api/observability/audits").param("targetId", id));
        assertThat(audits.get("items").toString()).contains("FAILURE");
    }

    private JsonNode application() throws Exception {
        return send(post("/admin-api/applications").content("{\"name\":\"治理测试\",\"ownerTenantId\":\"tenant-1\"}"));
    }
    private ObjectNode config(String type, String tenantId, String applicationId, String apiId) {
        ObjectNode result = json.createObjectNode().put("enabled", true).put("mode", "ENFORCE").put("dailyQuota", 10).put("ipMode", "UNRESTRICTED");
        result.putArray("ipAddresses");
        result.putObject("target").put("type", type).put("tenantId", tenantId).put("applicationId", applicationId).put("apiId", apiId);
        result.putObject("rate").put("algorithm", "TOKEN_BUCKET").put("perSecond", 1).put("burst", 2); return result;
    }
    private JsonNode create(String name, ObjectNode config) throws Exception {
        ObjectNode body = json.createObjectNode().put("name", name); body.set("config", config);
        return send(post("/admin-api/governance-rules").content(body.toString()));
    }
    private JsonNode preview(String id, String source) throws Exception {
        return send(post(path(id) + "/preview").content(json.createObjectNode().put("sourceReleaseId", source).toString()));
    }
    private ObjectNode publication(JsonNode preview) {
        return json.createObjectNode().put("expectedDraftRevision", preview.get("draftRevision").asLong())
                .put("expectedStateVersion", preview.get("stateVersion").asLong()).put("previewDigest", preview.get("digest").asText())
                .put("sourceReleaseId", preview.get("sourceReleaseId").isNull() ? null : preview.get("sourceReleaseId").asText());
    }
    private JsonNode publish(String id, JsonNode preview) throws Exception { return send(post(path(id) + "/publish").content(publication(preview).toString())); }
    private String path(String id) { return "/admin-api/governance-rules/" + id; }
    private MockHttpServletRequestBuilder auth(MockHttpServletRequestBuilder request) {
        return request.session(io.github.chenyilei2016.openplatform.testing.TestSessions.session("test-session")).header("X-CSRF-Token", "76832d7fdbcdbf4a72129f8b7def9016").contentType("application/json");
    }
    private JsonNode send(MockHttpServletRequestBuilder request) throws Exception {
        String body = mvc.perform(auth(request)).andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        return json.readTree(body).get("data");
    }
}
