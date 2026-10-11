package io.github.chenyilei2016.openplatform.portal;

import io.github.chenyilei2016.openplatform.domain.access.TenantGrantRepository;

import io.github.chenyilei2016.openplatform.application.identity.AccountAuthentication;
import io.github.chenyilei2016.openplatform.testing.TestAccount;
import io.github.chenyilei2016.openplatform.testing.TestEmployee;
import jakarta.servlet.http.Cookie;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@io.github.chenyilei2016.openplatform.testing.TestAdministrators
@SpringBootTest(properties = {

        "spring.datasource.hikari.maximum-pool-size=1", "spring.datasource.hikari.connection-timeout=500",
        "test.admin.operators[0].tenant-id=101",
        "test.admin.operators[0].employee-no=operator-1",
        "test.admin.operators[0].permissions[0]=MANAGE_APPLICATIONS",
        "test.admin.operators[0].permissions[1]=VIEW_AUDIT"
})
@AutoConfigureMockMvc(print = org.springframework.boot.webmvc.test.autoconfigure.MockMvcPrint.NONE)
class PortalAccessHttpTest {
    @Autowired MockMvc mvc;
    @MockitoBean AccountAuthentication identityService;
    @MockitoBean io.github.chenyilei2016.openplatform.domain.access.EmployeeDirectory employeeFacade;
    @MockitoSpyBean TenantGrantRepository tenants;
    @MockitoSpyBean io.github.chenyilei2016.openplatform.infrastructure.portal.dal.mapper.PortalApplicationMapper portalApplications;
    private final JsonMapper json = JsonMapper.builder().build();
    private String defaultScopeId;
    private String defaultScopeCode;

    @BeforeEach
    void login() throws Exception {
        var one = new TestAccount();
        one.setEmployeeId(201L); one.setId(9007199254740993L); one.setTenantId("101"); one.setEmployeeNoStr("operator-1");
        var two = new TestAccount();
        two.setEmployeeId(202L); two.setId(9007199254740995L); two.setTenantId("102"); two.setEmployeeNoStr("operator-2");
        when(identityService.current("test-session")).thenAnswer(invocation -> one.toAccount());
        when(identityService.current("other-session")).thenAnswer(invocation -> two.toAccount());
        TestEmployee firstEmployee = new TestEmployee();
        firstEmployee.setId(201L); firstEmployee.setUserId(9007199254740993L); firstEmployee.setTenantId(101L);
        firstEmployee.setEmployeeNoStr("operator-1"); firstEmployee.setName("租户一员工");
        firstEmployee.setEnabled(true); firstEmployee.setEmployeeStatus(4);
        TestEmployee secondEmployee = new TestEmployee();
        secondEmployee.setId(202L); secondEmployee.setUserId(9007199254740995L); secondEmployee.setTenantId(102L);
        secondEmployee.setEmployeeNoStr("operator-2"); secondEmployee.setName("租户二员工");
        secondEmployee.setEnabled(true); secondEmployee.setEmployeeStatus(4);
        when(employeeFacade.find(org.mockito.ArgumentMatchers.eq("101"), org.mockito.ArgumentMatchers.eq("operator-1"))).thenAnswer(invocation -> firstEmployee.toIdentity());
        when(employeeFacade.find(org.mockito.ArgumentMatchers.eq("102"), org.mockito.ArgumentMatchers.eq("operator-2"))).thenAnswer(invocation -> secondEmployee.toIdentity());
        defaultScopeCode = "portal.default." + UUID.randomUUID();
        JsonNode defaultScope = send(auth(post("/admin-api/scopes").content(body(Map.of(
                "code", defaultScopeCode, "name", "门户默认范围", "enabled", true, "defaultForNewApplication", true)))));
        defaultScopeId = defaultScope.get("id").asText();
    }

    @AfterEach
    void clearDefaultScopeFlag() throws Exception {
        if (defaultScopeId != null) {
            send(auth(put("/admin-api/scopes/" + defaultScopeId).content(body(Map.of(
                    "name", "门户默认范围", "enabled", true, "defaultForNewApplication", false)))));
        }
    }

    @Test
    void workspaceReadsOnlyOwnProjectionAndFiltersStatusBeforePaging() throws Exception {
        JsonNode created = send(other(post("/portal-api/applications").content("{}")));
        String appKey = created.at("/application/appKey").asText();
        JsonNode active = send(other(get("/portal-api/applications").param("appKey", appKey).param("status", "ACTIVE")));
        String bindingId = active.at("/items/0/id").asText();
        JsonNode detail = send(other(get("/portal-api/applications/" + bindingId)));
        assertThat(detail.get("id").asText()).isEqualTo(bindingId);
        assertThat(detail.toString()).doesNotContain("appSecret", "secretHash", "ownerTenantId");
        mvc.perform(auth(get("/portal-api/applications/" + bindingId))).andExpect(status().isNotFound());
        send(other(post("/portal-api/bindings/" + bindingId + "/revoke").content("{}")));
        assertThat(send(other(get("/portal-api/applications").param("appKey", appKey).param("status", "ACTIVE"))).get("total").asLong()).isZero();
        assertThat(send(other(get("/portal-api/applications").param("appKey", appKey).param("status", "REVOKED"))).get("total").asLong()).isEqualTo(1);
        mvc.perform(other(get("/portal-api/applications").param("status", "UNKNOWN"))).andExpect(status().isBadRequest());
    }

    @Test
    void ordinaryPortalEmployeeCanCheckCreationAvailabilityWithoutAdminPermission() throws Exception {
        JsonNode ready = send(other(get("/portal-api/creation-availability")));
        assertThat(ready.get("available").asBoolean()).isTrue();
        assertThat(ready.get("defaultScopeCount").asLong()).isPositive();
        send(auth(put("/admin-api/scopes/" + defaultScopeId).content(body(Map.of(
                "name", "门户默认范围", "enabled", true, "defaultForNewApplication", false)))));
        JsonNode unavailable = send(other(get("/portal-api/creation-availability")));
        assertThat(unavailable.get("available").asBoolean()).isFalse();
        assertThat(unavailable.get("reason").asText()).contains("尚未配置");
        mvc.perform(get("/portal-api/creation-availability")).andExpect(status().isUnauthorized());
    }

    @Test
    void creatingCredentialsWithoutANameUsesANonPersonalDefaultAndKeepsLengthValidation() throws Exception {
        for (String request : new String[]{"{}", "{\"name\":null}", "{\"name\":\"\"}", "{\"name\":\"   \"}"}) {
            JsonNode created = send(auth(post("/portal-api/applications").content(request)));
            assertThat(created.at("/application/name").asText())
                    .isEqualTo("接入凭据-" + created.at("/application/id").asText().substring(28));
            assertThat(created.at("/application/id").asText()).matches("APP_[0-9a-f]{32}");
            assertThat(created.at("/application/ownerTenantId").asText()).isEqualTo("101");
            assertThat(created.at("/application/appKey").asText()).hasSize(32);
            assertThat(created.get("appSecret").asText()).hasSize(43);
        }
        mvc.perform(auth(post("/portal-api/applications").content(body(Map.of("name", "n".repeat(101))))))
                .andExpect(status().isBadRequest());
    }

    @Test
    void emptyEffectiveDefaultsRejectPortalCreationWithoutPartialCredentialsButKeepAdminCreation() throws Exception {
        send(auth(put("/admin-api/scopes/" + defaultScopeId).content(body(Map.of(
                "name", "已停用默认范围", "enabled", false, "defaultForNewApplication", true)))));
        String name = "默认范围未就绪" + UUID.randomUUID();
        MockHttpServletResponse response = mvc.perform(auth(post("/portal-api/applications").content(body(Map.of("name", name)))))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.code").value(50300001))
                .andExpect(jsonPath("$.resultMsg").value("默认权限范围尚未配置，请联系平台维护者"))
                .andReturn().getResponse();
        assertThat(send(auth(get("/portal-api/applications").param("query", name))).get("total").asLong()).isZero();
        assertThat(send(auth(get("/admin-api/applications").param("query", name))).get("total").asLong()).isZero();
        JsonNode audits = send(auth(get("/admin-api/observability/audits").param("requestId", response.getHeader("X-Request-Id"))));
        assertThat(audits.get("total").asLong()).isEqualTo(1);
        assertThat(audits.at("/items/0/action").asText()).isEqualTo("CREATE_BOUND_APPLICATION");
        assertThat(audits.at("/items/0/outcome").asText()).isEqualTo("FAILURE");
        JsonNode adminCreated = send(auth(post("/admin-api/applications").content(body(Map.of(
                "name", "后台空默认范围" + UUID.randomUUID(), "ownerTenantId", "101")))));
        assertThat(adminCreated.at("/application/scopeCodes").size()).isZero();
    }

    @Test
    void changedDefaultsApplyOnlyToNewCredentialsAndBindingKeepsExistingScopes() throws Exception {
        JsonNode existing = send(auth(post("/portal-api/applications").content(body(Map.of("name", "旧凭据" + UUID.randomUUID())))));
        String existingToken = token(existing, "101");
        assertThat(existing.at("/application/scopeCodes")).isEqualTo(json.valueToTree(List.of(defaultScopeCode)));
        String nextCode = "portal.next." + UUID.randomUUID();
        JsonNode nextScope = send(auth(post("/admin-api/scopes").content(body(Map.of(
                "code", nextCode, "name", "后续默认范围", "enabled", true, "defaultForNewApplication", true)))));
        try {
            send(auth(put("/admin-api/scopes/" + defaultScopeId).content(body(Map.of(
                    "name", "原默认范围", "enabled", true, "defaultForNewApplication", false)))));
            JsonNode created = send(auth(post("/portal-api/applications").content("{}")));
            assertThat(created.at("/application/scopeCodes")).isEqualTo(json.valueToTree(List.of(nextCode)));
            JsonNode bound = send(other(post("/portal-api/bindings").content(body(Map.of(
                    "appKey", existing.at("/application/appKey").asText(), "appSecret", existing.get("appSecret").asText())))));
            assertThat(bound.get("applicationId").asText()).isEqualTo(existing.at("/application/id").asText());
            assertThat(bound.get("tenantId").asText()).isEqualTo("102");
            JsonNode unchanged = send(auth(get("/admin-api/applications/" + existing.at("/application/id").asText())));
            assertThat(unchanged.get("scopeCodes")).isEqualTo(existing.at("/application/scopeCodes"));
            assertThat(unchanged.get("authorizationVersion").asLong()).isEqualTo(existing.at("/application/authorizationVersion").asLong());
            JsonNode introspected = send(post("/api/token/introspect").header("Authorization", "Bearer " + existingToken));
            assertThat(introspected.get("scopeCodes")).isEqualTo(existing.at("/application/scopeCodes"));
        } finally {
            send(auth(put("/admin-api/scopes/" + nextScope.get("id").asText()).content(body(Map.of(
                    "name", "后续默认范围", "enabled", true, "defaultForNewApplication", false)))));
        }
    }

    @Test
    void creatingCredentialsAlsoBindsOnlyTheSessionTenantAndListsNoPrivateFields() throws Exception {
        String name = "门户%_" + UUID.randomUUID();
        JsonNode created = send(auth(post("/portal-api/applications").content(body(Map.of("note", "  " + name + "  ")))));
        assertThat(created.at("/application/name").asText()).startsWith("接入凭据-").doesNotContain(name);
        assertThat(created.at("/application/ownerTenantId").asText()).isEqualTo("101");
        assertThat(created.get("appSecret").asText()).hasSize(43);
        JsonNode listed = send(auth(get("/portal-api/applications").param("query", name).param("pageSize", "1")));
        assertThat(listed.get("total").asLong()).isEqualTo(1);
        assertThat(listed.at("/items/0/applicationId").asText()).isEqualTo(created.at("/application/id").asText());
        assertThat(listed.at("/items/0/applicationStatus").asText()).isEqualTo("ENABLED");
        assertThat(listed.at("/items/0/status").asText()).isEqualTo("ACTIVE");
        assertThat(listed.at("/items/0/note").asText()).isEqualTo(name);
        assertThat(listed.toString()).doesNotContain("appSecret", "digest", "ownerTenantId", "scopeCodes", "tenantId", "employeeNo");
        assertThat(send(other(get("/portal-api/applications").param("query", name))).get("total").asLong()).isZero();
        JsonNode audits = send(auth(get("/admin-api/applications/" + created.at("/application/id").asText() + "/audit")));
        assertThat(audits.get("total").asLong()).isEqualTo(1);
        assertThat(audits.toString()).contains("CREATE_BOUND_APPLICATION", "SUCCESS", "operator-1").doesNotContain(created.get("appSecret").asText());
    }

    @Test
    void scopesAreBatchedForTheCurrentTenantPageAndIncludeDisabledConfiguration() throws Exception {
        String prefix = "权限展示" + UUID.randomUUID();
        JsonNode created = send(auth(post("/portal-api/applications").content(body(Map.of("name", prefix + "一")))));
        send(auth(post("/portal-api/applications").content(body(Map.of("name", prefix + "二")))));
        JsonNode foreign = send(other(post("/portal-api/applications").content(body(Map.of("name", prefix + "外租户")))));
        send(auth(put("/admin-api/scopes/" + defaultScopeId).content(body(Map.of(
                "name", "订单查询范围", "enabled", false, "defaultForNewApplication", true)))));
        org.mockito.Mockito.clearInvocations(portalApplications);
        JsonNode listed = send(auth(get("/portal-api/applications").param("name", prefix).param("pageSize", "1")));
        assertThat(listed.get("total").asLong()).isEqualTo(2);
        JsonNode row = listed.at("/items/0");
        assertThat(row.at("/scopes/0/code").asText()).isEqualTo(defaultScopeCode);
        assertThat(row.at("/scopes/0/name").asText()).isEqualTo("订单查询范围");
        assertThat(row.at("/scopes/0/enabled").asBoolean()).isFalse();
        org.mockito.Mockito.verify(portalApplications).selectScopes(java.util.List.of(row.get("applicationId").asText()));
        JsonNode detail = send(auth(get("/portal-api/applications/" + row.get("id").asText())));
        assertThat(detail.get("scopes")).isEqualTo(row.get("scopes"));
        assertThat(listed.toString()).doesNotContain("appSecret", "digest", "ownerTenantId", "tenantId", "employeeNo");
        assertThat(listed.toString()).doesNotContain(foreign.at("/application/id").asText());
        mvc.perform(other(get("/portal-api/applications/" + row.get("id").asText()))).andExpect(status().isNotFound());
        org.mockito.Mockito.clearInvocations(portalApplications);
        assertThat(send(other(get("/portal-api/applications").param("query", created.at("/application/appKey").asText())))
                .get("total").asLong()).isZero();
        org.mockito.Mockito.verify(portalApplications, org.mockito.Mockito.never()).selectScopes(org.mockito.ArgumentMatchers.anyList());
    }

    @Test
    void independentFiltersIntersectWithLegacyQueryAndCannotOverrideTheSessionTenant() throws Exception {
        String suffix = UUID.randomUUID().toString();
        String name = "备注%_!" + suffix;
        JsonNode created = send(auth(post("/portal-api/applications").content(body(Map.of("name", name)))));
        send(auth(post("/portal-api/applications").content(body(Map.of("name", "备注XY!" + suffix)))));
        JsonNode foreign = send(other(post("/portal-api/applications").content(body(Map.of("name", name)))));
        String appKey = created.at("/application/appKey").asText();
        String applicationId = created.at("/application/id").asText();

        JsonNode exact = send(auth(get("/portal-api/applications").param("appKey", appKey)));
        assertThat(exact.get("total").asLong()).isEqualTo(1);
        assertThat(exact.at("/items/0/applicationId").asText()).isEqualTo(applicationId);
        JsonNode literal = send(auth(get("/portal-api/applications").param("name", "%_!" + suffix)));
        assertThat(literal.get("total").asLong()).isEqualTo(1);
        assertThat(literal.at("/items/0/applicationId").asText()).isEqualTo(applicationId);
        JsonNode legacyAk = send(auth(get("/portal-api/applications").param("query", appKey.substring(0, 24))));
        assertThat(legacyAk.get("total").asLong()).isEqualTo(1);
        assertThat(legacyAk.at("/items/0/applicationId").asText()).isEqualTo(applicationId);
        assertThat(send(auth(get("/portal-api/applications").param("query", suffix))).get("total").asLong()).isEqualTo(2);

        JsonNode combined = send(auth(get("/portal-api/applications").param("appKey", appKey)
                .param("name", "%_!" + suffix).param("query", appKey.substring(0, 24))
                .param("tenantId", "102").param("ownerTenantId", "102").param("operator.tenantId", "102")));
        assertThat(combined.get("total").asLong()).isEqualTo(1);
        assertThat(combined.at("/items/0/applicationId").asText()).isEqualTo(applicationId);
        assertThat(combined.toString()).doesNotContain("appSecret", "digest", "ownerTenantId", "scopeCodes", "tenantId", "employeeNo");
        assertThat(send(auth(get("/portal-api/applications").param("appKey", appKey).param("name", "不匹配")))
                .get("total").asLong()).isZero();
        assertThat(send(auth(get("/portal-api/applications").param("appKey", appKey).param("name", suffix).param("query", "不匹配")))
                .get("total").asLong()).isZero();
        assertThat(send(auth(get("/portal-api/applications").param("appKey", foreign.at("/application/appKey").asText())
                .param("name", name).param("tenantId", "102"))).get("total").asLong()).isZero();
        assertThat(send(auth(get("/portal-api/applications").param("appKey", "0".repeat(32))))
                .get("total").asLong()).isZero();
    }

    @Test
    void nameFilteringPaginatesAfterTenantFilteringInStableRelationIdOrder() throws Exception {
        String name = "分页" + UUID.randomUUID();
        for (int index = 0; index < 3; index++) {
            send(auth(post("/portal-api/applications").content(body(Map.of("name", name + index)))));
        }
        send(other(post("/portal-api/applications").content(body(Map.of("name", name)))));
        JsonNode all = send(auth(get("/portal-api/applications").param("name", name)));
        assertThat(all.get("page").asInt()).isEqualTo(1);
        assertThat(all.get("pageSize").asInt()).isEqualTo(20);
        assertThat(all.get("total").asLong()).isEqualTo(3);
        List<String> ids = List.of(all.at("/items/0/id").asText(), all.at("/items/1/id").asText(), all.at("/items/2/id").asText());
        assertThat(ids).isSorted().doesNotHaveDuplicates();
        JsonNode first = send(auth(get("/portal-api/applications").param("name", name).param("pageSize", "2")));
        JsonNode second = send(auth(get("/portal-api/applications").param("name", name).param("pageSize", "2").param("page", "2")));
        assertThat(first.get("total").asLong()).isEqualTo(3);
        assertThat(first.get("items").size()).isEqualTo(2);
        assertThat(first.at("/items/0/id").asText()).isEqualTo(ids.get(0));
        assertThat(first.at("/items/1/id").asText()).isEqualTo(ids.get(1));
        assertThat(second.get("total").asLong()).isEqualTo(3);
        assertThat(second.get("items").size()).isEqualTo(1);
        assertThat(second.at("/items/0/id").asText()).isEqualTo(ids.get(2));
        JsonNode empty = send(auth(get("/portal-api/applications").param("name", name).param("pageSize", "2").param("page", "3")));
        assertThat(empty.get("total").asLong()).isEqualTo(3);
        assertThat(empty.get("items").size()).isZero();
    }

    @Test
    void independentFilterValidationKeepsExistingPaginationLimits() throws Exception {
        for (String appKey : new String[]{"", "a".repeat(31), "a".repeat(33), "A".repeat(32), "g".repeat(32), " a".repeat(16)}) {
            mvc.perform(auth(get("/portal-api/applications").param("appKey", appKey))).andExpect(status().isBadRequest());
        }
        mvc.perform(auth(get("/portal-api/applications").param("name", "n".repeat(101)))).andExpect(status().isBadRequest());
        mvc.perform(auth(get("/portal-api/applications").param("page", "0"))).andExpect(status().isBadRequest());
        mvc.perform(auth(get("/portal-api/applications").param("pageSize", "0"))).andExpect(status().isBadRequest());
        JsonNode allowed = send(auth(get("/portal-api/applications").param("name", "n".repeat(100))
                .param("query", "q".repeat(100)).param("pageSize", "100").param("page", "1001")));
        assertThat(allowed.get("pageSize").asInt()).isEqualTo(100);
        assertThat(allowed.get("page").asInt()).isEqualTo(1001);
        assertThat(allowed.get("items").size()).isZero();
    }

    @Test
    void bindingChecksCredentialsAndRevokeCannotTouchAnotherTenantOrReviveOldTokens() throws Exception {
        JsonNode created = send(auth(post("/portal-api/applications").content(body(Map.of("name", "多租户" + UUID.randomUUID())))));
        String credentials = body(Map.of("appKey", created.at("/application/appKey").asText(), "appSecret", created.get("appSecret").asText()));
        mvc.perform(other(post("/portal-api/bindings").content(body(Map.of("appKey", created.at("/application/appKey").asText(), "appSecret", "wrong")))))
                .andExpect(status().isUnauthorized()).andExpect(jsonPath("$.code").value(40100002));
        mvc.perform(other(post("/portal-api/bindings").content(body(Map.of("appKey", "0".repeat(32), "appSecret", "wrong")))))
                .andExpect(status().isUnauthorized()).andExpect(jsonPath("$.code").value(40100002));
        assertThat(send(other(get("/portal-api/session"))).get("tenantId").asText()).isEqualTo("102");
        JsonNode second = send(other(post("/portal-api/bindings").content(credentials)));
        String secondId = second.get("id").asText();
        mvc.perform(other(post("/portal-api/bindings").content(credentials))).andExpect(status().isConflict());
        mvc.perform(auth(post("/portal-api/bindings/" + secondId + "/revoke"))).andExpect(status().isNotFound());
        mvc.perform(auth(post("/portal-api/bindings/" + UUID.randomUUID() + "/revoke"))).andExpect(status().isNotFound());
        var employee = new io.github.chenyilei2016.openplatform.testing.TestEmployee();
        employee.setId(11L); employee.setUserId(12L); employee.setTenantId(102L); employee.setEmployeeNoStr("A001");
        employee.setName("被委托人员"); employee.setEnabled(true); employee.setEmployeeStatus(4);
        when(employeeFacade.find(org.mockito.ArgumentMatchers.eq("102"), org.mockito.ArgumentMatchers.eq("A001"))).thenAnswer(invocation -> employee.toIdentity());
        send(auth(post("/admin-api/tenant-grants/" + secondId + "/users").content("{\"employeeNo\":\"A001\"}")));
        String userToken = send(post("/api/token").contentType("application/json").content(body(Map.of(
                "appKey", created.at("/application/appKey").asText(), "appSecret", created.get("appSecret").asText(),
                "tenantId", "102", "employeeNo", "A001")))).get("accessToken").asText();
        String oneToken = token(created, "101");
        String twoToken = token(created, "102");
        send(other(post("/portal-api/bindings/" + secondId + "/revoke").content("{}")));
        mvc.perform(post("/api/token/introspect").header("Authorization", "Bearer " + twoToken)).andExpect(status().isUnauthorized());
        send(post("/api/token/introspect").header("Authorization", "Bearer " + oneToken));
        send(other(post("/portal-api/bindings/" + secondId + "/revoke")));
        JsonNode revoked = send(other(get("/portal-api/applications").param("query", created.at("/application/name").asText())));
        assertThat(revoked.at("/items/0/status").asText()).isEqualTo("REVOKED");
        assertThat(revoked.at("/items/0/authorizationVersion").asLong()).isEqualTo(1);
        JsonNode rebound = send(other(post("/portal-api/bindings").content(credentials)));
        assertThat(rebound.get("id").asText()).isEqualTo(secondId);
        assertThat(rebound.get("authorizationVersion").asLong()).isEqualTo(2);
        mvc.perform(post("/api/token/introspect").header("Authorization", "Bearer " + userToken)).andExpect(status().isUnauthorized());
        assertThat(send(auth(get("/admin-api/tenant-grants/" + secondId + "/users"))).at("/items/0/status").asText()).isEqualTo("REVOKED");
        mvc.perform(post("/api/token/introspect").header("Authorization", "Bearer " + twoToken)).andExpect(status().isUnauthorized());
        send(auth(put("/admin-api/applications/" + created.at("/application/id").asText() + "/status").content("{\"enabled\":false}")));
        send(other(post("/portal-api/bindings/" + secondId + "/revoke")));
        mvc.perform(other(post("/portal-api/bindings").content(credentials))).andExpect(status().isConflict());
        JsonNode disabled = send(other(get("/portal-api/applications").param("appKey", created.at("/application/appKey").asText())
                .param("name", created.at("/application/name").asText())));
        assertThat(disabled.get("total").asLong()).isEqualTo(1);
        assertThat(disabled.at("/items/0/applicationStatus").asText()).isEqualTo("DISABLED");
        assertThat(disabled.at("/items/0/status").asText()).isEqualTo("REVOKED");
    }

    @Test
    void requestFieldsAreClosedAndPaginationFiltersTenantBeforeCounting() throws Exception {
        String suffix = UUID.randomUUID().toString();
        send(auth(post("/portal-api/applications").content(body(Map.of("name", "literal%_" + suffix)))));
        send(auth(post("/portal-api/applications").content(body(Map.of("name", "literalXY" + suffix)))));
        send(other(post("/portal-api/applications").content(body(Map.of("name", "literal%_" + suffix)))));
        JsonNode literal = send(auth(get("/portal-api/applications").param("query", "%_" + suffix).param("pageSize", "1")));
        assertThat(literal.get("total").asLong()).isEqualTo(1);
        JsonNode secondPage = send(auth(get("/portal-api/applications").param("query", suffix).param("pageSize", "1").param("page", "2")));
        assertThat(secondPage.get("total").asLong()).isEqualTo(2);
        assertThat(secondPage.get("items").size()).isEqualTo(1);
        for (String field : new String[]{"tenantId", "ownerTenantId", "operator", "scopeCodes"}) {
            mvc.perform(auth(post("/portal-api/applications").content(body(Map.of("name", "伪造", field, "102")))))
                    .andExpect(status().isBadRequest());
            mvc.perform(auth(post("/portal-api/bindings").content(body(Map.of("appKey", "a".repeat(32), "appSecret", "test", field, "102")))))
                    .andExpect(status().isBadRequest());
        }
        mvc.perform(auth(post("/portal-api/bindings/any/revoke").content("{\"tenantId\":\"102\"}"))).andExpect(status().isBadRequest());
        mvc.perform(auth(get("/portal-api/applications").param("page", "100002").param("pageSize", "1"))).andExpect(status().isBadRequest());
        mvc.perform(auth(get("/portal-api/applications").param("pageSize", "101"))).andExpect(status().isBadRequest());
        mvc.perform(auth(get("/portal-api/applications").param("query", "x".repeat(101)))).andExpect(status().isBadRequest());
    }

    @Test
    void failedAutomaticBindingRollsBackTheApplicationAndSuccessAudits() throws Exception {
        String name = "事务失败" + UUID.randomUUID();
        doThrow(new org.springframework.dao.DataIntegrityViolationException("injected binding failure"))
                .when(tenants).create(any());
        var response = mvc.perform(auth(post("/portal-api/applications").content(body(Map.of("name", name)))))
                .andExpect(status().isConflict()).andReturn().getResponse();
        assertThat(send(auth(get("/admin-api/applications").param("query", name))).get("total").asLong()).isZero();
        JsonNode audits = send(auth(get("/admin-api/observability/audits").param("requestId", response.getHeader("X-Request-Id"))));
        assertThat(audits.get("total").asLong()).isEqualTo(1);
        assertThat(audits.at("/items/0/action").asText()).isEqualTo("CREATE_BOUND_APPLICATION");
        assertThat(audits.at("/items/0/outcome").asText()).isEqualTo("FAILURE");
    }

    @Test
    void tenantNotesStayIndependentAndDoNotChangeAuthorizationOrIssuedTokens() throws Exception {
        String note = "共享凭据" + UUID.randomUUID();
        JsonNode created = send(auth(post("/portal-api/applications").content(body(Map.of("note", note)))));
        String globalName = created.at("/application/name").asText();
        String appKey = created.at("/application/appKey").asText();
        String applicationId = created.at("/application/id").asText();
        JsonNode first = send(auth(get("/portal-api/applications").param("appKey", appKey))).at("/items/0");
        String firstId = first.get("id").asText();
        JsonNode second = send(other(post("/portal-api/bindings").content(body(Map.of(
                "appKey", appKey, "appSecret", created.get("appSecret").asText())))));
        String secondId = second.get("id").asText();
        String firstToken = token(created, "101");
        String secondToken = token(created, "102");
        JsonNode firstContext = send(post("/api/token/introspect").header("Authorization", "Bearer " + firstToken));
        JsonNode secondContext = send(post("/api/token/introspect").header("Authorization", "Bearer " + secondToken));

        MockHttpServletResponse changed = mvc.perform(auth(put("/portal-api/bindings/" + firstId + "/note")
                        .content(body(Map.of("note", "  仓储用途  ", "expectedRevision", 0)))))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.note").value("仓储用途"))
                .andExpect(jsonPath("$.data.noteRevision").value(1)).andReturn().getResponse();
        JsonNode otherBefore = send(other(get("/portal-api/applications").param("appKey", appKey))).at("/items/0");
        assertThat(otherBefore.get("name").asText()).isEqualTo(globalName);
        assertThat(otherBefore.get("note").asText()).isEmpty();
        assertThat(otherBefore.get("noteRevision").asLong()).isZero();
        send(other(put("/portal-api/bindings/" + secondId + "/note")
                .content(body(Map.of("note", "财务用途", "expectedRevision", 0)))));
        JsonNode firstNamed = send(auth(get("/portal-api/applications").param("appKey", appKey))).at("/items/0");
        assertThat(firstNamed.get("name").asText()).isEqualTo("仓储用途");
        assertThat(firstNamed.get("globalName").asText()).isEqualTo(globalName);

        send(auth(put("/portal-api/bindings/" + firstId + "/note")
                .content(body(Map.of("note", "", "expectedRevision", 1)))));
        JsonNode cleared = send(auth(get("/portal-api/applications").param("appKey", appKey))).at("/items/0");
        assertThat(cleared.get("note").asText()).isEmpty();
        assertThat(cleared.get("name").asText()).isEqualTo(globalName);
        assertThat(cleared.get("noteRevision").asLong()).isEqualTo(2);
        assertThat(cleared.get("authorizationVersion")).isEqualTo(first.get("authorizationVersion"));
        JsonNode otherAfter = send(other(get("/portal-api/applications").param("appKey", appKey))).at("/items/0");
        assertThat(otherAfter.get("name").asText()).isEqualTo("财务用途");
        assertThat(otherAfter.get("globalName").asText()).isEqualTo(globalName);
        assertThat(otherAfter.get("authorizationVersion")).isEqualTo(second.get("authorizationVersion"));
        JsonNode unchanged = send(auth(get("/admin-api/applications/" + applicationId)));
        assertThat(unchanged.get("scopeCodes")).isEqualTo(created.at("/application/scopeCodes"));
        assertThat(unchanged.get("authorizationVersion")).isEqualTo(created.at("/application/authorizationVersion"));
        assertThat(unchanged.get("name").asText()).isEqualTo(globalName);
        assertThat(unchanged.get("appKey").asText()).isEqualTo(appKey);
        assertThat(send(post("/api/token/introspect").header("Authorization", "Bearer " + firstToken))).isEqualTo(firstContext);
        assertThat(send(post("/api/token/introspect").header("Authorization", "Bearer " + secondToken))).isEqualTo(secondContext);

        JsonNode audits = send(auth(get("/admin-api/observability/audits").param("requestId", changed.getHeader("X-Request-Id"))));
        assertThat(audits.get("total").asLong()).isEqualTo(1);
        assertThat(audits.at("/items/0/action").asText()).isEqualTo("UPDATE_TENANT_NOTE");
        assertThat(audits.at("/items/0/outcome").asText()).isEqualTo("SUCCESS");
        assertThat(audits.at("/items/0/targetId").asText()).isEqualTo(firstId);
        assertThat(audits.toString()).doesNotContain(created.get("appSecret").asText(), firstToken, secondToken);
    }

    @Test
    void noteWritesRejectStaleForeignAndRevokedRelationsAndRebindingPreservesTheNote() throws Exception {
        JsonNode created = send(auth(post("/portal-api/applications").content("{}")));
        String credentials = body(Map.of("appKey", created.at("/application/appKey").asText(),
                "appSecret", created.get("appSecret").asText()));
        JsonNode bound = send(other(post("/portal-api/bindings").content(credentials)));
        String id = bound.get("id").asText();
        String path = "/portal-api/bindings/" + id;
        String note = "备".repeat(100);
        JsonNode saved = send(other(put(path + "/note").content(body(Map.of("note", "  " + note + "  ", "expectedRevision", 0)))));
        assertThat(saved.get("note").asText()).isEqualTo(note);
        mvc.perform(other(put(path + "/note").content(body(Map.of("note", "覆盖同事备注", "expectedRevision", 0)))))
                .andExpect(status().isConflict());
        mvc.perform(other(put(path + "/note").content(body(Map.of("note", note + "注", "expectedRevision", 1)))))
                .andExpect(status().isBadRequest());
        mvc.perform(auth(put(path + "/note").content(body(Map.of("note", "后台角色也不能越租户", "expectedRevision", 1)))))
                .andExpect(status().isNotFound());
        mvc.perform(auth(get(path))).andExpect(status().isNotFound());
        mvc.perform(other(put(path + "/note").content(body(Map.of("note", "伪造租户", "expectedRevision", 1, "tenantId", "101")))))
                .andExpect(status().isBadRequest());
        assertThat(send(other(get(path)))).isEqualTo(saved);
        send(other(post(path + "/revoke")));
        JsonNode revoked = send(other(get(path)));
        mvc.perform(other(put(path + "/note").content(body(Map.of("note", "解绑后修改", "expectedRevision", 1)))))
                .andExpect(status().isConflict());
        assertThat(send(other(get(path)))).isEqualTo(revoked);
        JsonNode rebound = send(other(post("/portal-api/bindings").content(credentials)));
        assertThat(rebound.get("id").asText()).isEqualTo(id);
        assertThat(rebound.get("note").asText()).isEqualTo(note);
        assertThat(rebound.get("noteRevision").asLong()).isEqualTo(1);
        assertThat(rebound.get("authorizationVersion").asLong()).isEqualTo(2);
        assertThat(rebound.get("status").asText()).isEqualTo("ACTIVE");
    }

    @Test
    void noteAndGlobalNameFilteringPrecedesPaginationAndKeepsAppKeyIndependent() throws Exception {
        String needle = "用途%_!" + UUID.randomUUID();
        JsonNode global = send(auth(post("/portal-api/applications").content(body(Map.of("name", needle)))));
        JsonNode noted = send(auth(post("/portal-api/applications").content(body(Map.of("name", "其他名称" + UUID.randomUUID())))));
        String appKey = noted.at("/application/appKey").asText();
        String id = send(auth(get("/portal-api/applications").param("appKey", appKey))).at("/items/0/id").asText();
        send(auth(put("/portal-api/bindings/" + id + "/note").content(body(Map.of("note", needle, "expectedRevision", 0)))));
        send(other(post("/portal-api/bindings").content(body(Map.of("appKey", appKey, "appSecret", noted.get("appSecret").asText())))));
        send(other(post("/portal-api/applications").content(body(Map.of("name", needle)))));
        JsonNode first = send(auth(get("/portal-api/applications").param("name", needle).param("pageSize", "1")));
        JsonNode second = send(auth(get("/portal-api/applications").param("name", needle).param("pageSize", "1").param("page", "2")));
        assertThat(first.get("total").asLong()).isEqualTo(2);
        assertThat(second.get("total").asLong()).isEqualTo(2);
        assertThat(first.get("items").size()).isEqualTo(1);
        assertThat(second.get("items").size()).isEqualTo(1);
        assertThat(List.of(first.at("/items/0/applicationId").asText(), second.at("/items/0/applicationId").asText()))
                .containsExactlyInAnyOrder(global.at("/application/id").asText(), noted.at("/application/id").asText());
        assertThat(List.of(first.at("/items/0/id").asText(), second.at("/items/0/id").asText())).isSorted().doesNotHaveDuplicates();
        JsonNode exact = send(auth(get("/portal-api/applications").param("name", needle).param("appKey", appKey)));
        assertThat(exact.get("total").asLong()).isEqualTo(1);
        assertThat(exact.at("/items/0/id").asText()).isEqualTo(id);
        assertThat(send(auth(get("/portal-api/applications").param("query", needle))).get("total").asLong()).isEqualTo(2);
        assertThat(send(other(get("/portal-api/applications").param("name", needle).param("appKey", appKey)))
                .get("total").asLong()).isZero();
    }

    @Test
    void failureAfterUpdatingNoteRollsBackNoteRevisionAndSuccessAuditTogether() throws Exception {
        JsonNode created = send(auth(post("/portal-api/applications").content("{}")));
        String id = send(auth(get("/portal-api/applications").param("appKey", created.at("/application/appKey").asText())))
                .at("/items/0/id").asText();
        String path = "/portal-api/bindings/" + id;
        JsonNode before = send(auth(get(path)));
        doAnswer(invocation -> {
            assertThat((Boolean) invocation.callRealMethod()).isTrue();
            throw new org.springframework.dao.DataIntegrityViolationException("injected failure after note update");
        }).when(tenants).updateNote(any(), anyLong());
        MockHttpServletResponse failed = mvc.perform(auth(put(path + "/note")
                        .content(body(Map.of("note", "必须回滚", "expectedRevision", 0)))))
                .andExpect(status().isConflict()).andReturn().getResponse();
        assertThat(send(auth(get(path)))).isEqualTo(before);
        JsonNode audits = send(auth(get("/admin-api/observability/audits").param("requestId", failed.getHeader("X-Request-Id"))));
        assertThat(audits.get("total").asLong()).isEqualTo(1);
        assertThat(audits.at("/items/0/action").asText()).isEqualTo("UPDATE_TENANT_NOTE");
        assertThat(audits.at("/items/0/outcome").asText()).isEqualTo("FAILURE");
        assertThat(audits.at("/items/0/targetId").asText()).isEqualTo(id);
    }

    @Test
    void nonAdministratorCanDelegateAnotherEmployeeAndRevokeWithoutTargetEmployment() throws Exception {
        JsonNode created = send(other(post("/portal-api/applications").content("{}")));
        String appId = created.at("/application/id").asText();
        String grantId = send(other(get("/portal-api/applications").param("appKey", created.at("/application/appKey").asText())))
                .at("/items/0/id").asText();
        String path = "/portal-api/bindings/" + grantId;
        TestEmployee target = delegatedEmployee();
        when(employeeFacade.find(org.mockito.ArgumentMatchers.eq("102"), org.mockito.ArgumentMatchers.eq("TARGET")))
                .thenAnswer(invocation -> target.toIdentity());
        mvc.perform(other(get("/admin-api/applications"))).andExpect(status().isForbidden());
        JsonNode preview = send(other(post(path + "/employee-lookup").content("{\"employeeNo\":\"TARGET\"}")));
        assertThat(preview.get("employeeId").asText()).isEqualTo("303");
        String request = body(Map.of("employeeNo", "TARGET", "expectedUserId", "9007199254740997", "expectedEmployeeId", "303"));
        JsonNode user = send(other(post(path + "/users").content(request)));
        assertThat(send(other(post(path + "/users").content(request)))).isEqualTo(user);
        assertThat(send(other(get(path + "/users"))).get("total").asInt()).isEqualTo(1);
        JsonNode audit = send(auth(get("/admin-api/applications/" + appId + "/audit"))).at("/items/0");
        assertThat(audit.get("operatorTenantId").asText()).isEqualTo("102");
        assertThat(audit.get("operatorUserId").asText()).isEqualTo("9007199254740995");
        assertThat(audit.get("operatorEmployeeId").asText()).isEqualTo("202");
        assertThat(audit.get("targetEmployeeId").asText()).isEqualTo("303");
        assertThat(audit.get("targetUserId").asText()).isEqualTo("9007199254740997");
        assertThat(audit.get("tenantGrantId").asText()).isEqualTo(grantId);
        String personToken = send(post("/api/token").contentType("application/json").content(body(Map.of(
                "appKey", created.at("/application/appKey").asText(), "appSecret", created.get("appSecret").asText(),
                "tenantId", "102", "employeeNo", "TARGET")))).get("accessToken").asText();
        // 同租户另一人撤销，且目标已离职；不借目标核验阻止撤销。
        TestAccount another = new TestAccount(); another.setId(9007199254740999L); another.setTenantId("102"); another.setEmployeeNoStr("operator-2");
        when(identityService.current("other-session")).thenAnswer(invocation -> another.verified(employeeFacade));
        TestEmployee actor = delegatedEmployee(); actor.setId(404L); actor.setUserId(9007199254740999L); actor.setEmployeeNoStr("operator-2");
        when(employeeFacade.find(org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.eq("operator-2"))).thenAnswer(invocation -> actor.toIdentity());
        target.setEmployeeStatus(7);
        send(other(post(path + "/users/" + user.get("id").asText() + "/revoke")
                .content(body(Map.of("expectedAuthorizationVersion", user.get("authorizationVersion").asLong())))));
        mvc.perform(post("/api/token/introspect").header("Authorization", "Bearer " + personToken)
                .contentType("application/json").content("{}")).andExpect(status().isUnauthorized());
        assertThat(send(other(get(path + "/users"))).at("/items/0/status").asText()).isEqualTo("REVOKED");
        assertThat(send(auth(get("/admin-api/applications/" + appId + "/audit"))).at("/items/0/operatorEmployeeId").asText()).isEqualTo("404");
    }

    @Test
    void delegationRejectsCrossTenantWrongParentForgeryStaleIdentityAndInvalidEmployee() throws Exception {
        JsonNode created = send(other(post("/portal-api/applications").content("{}")));
        String id = send(other(get("/portal-api/applications").param("appKey", created.at("/application/appKey").asText()))).at("/items/0/id").asText();
        String path = "/portal-api/bindings/" + id;
        String request = body(Map.of("employeeNo", "TARGET", "expectedUserId", "9007199254740997", "expectedEmployeeId", "303"));
        mvc.perform(auth(get(path + "/users"))).andExpect(status().isNotFound());
        mvc.perform(auth(post(path + "/employee-lookup").content("{\"employeeNo\":\"TARGET\"}"))).andExpect(status().isNotFound());
        mvc.perform(auth(post(path + "/users").content(request))).andExpect(status().isNotFound());
        mvc.perform(other(post(path + "/users").content(request.replace("\"TARGET\"", "\"TARGET\",\"tenantId\":\"101\"")))).andExpect(status().isBadRequest());
        TestEmployee target = delegatedEmployee();
        when(employeeFacade.find(org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.eq("TARGET"))).thenAnswer(invocation -> target.toIdentity());
        mvc.perform(other(post(path + "/users").content(request.replace("303", "304")))).andExpect(status().isConflict());
        JsonNode failureAudit = send(auth(get("/admin-api/applications/" + created.at("/application/id").asText() + "/audit"))).at("/items/0");
        assertThat(failureAudit.get("outcome").asText()).isEqualTo("FAILURE");
        assertThat(failureAudit.get("targetEmployeeId").asText()).isEqualTo("303");
        assertThat(failureAudit.get("tenantGrantId").asText()).isEqualTo(id);
        target.setEnabled(false);
        mvc.perform(other(post(path + "/employee-lookup").content("{\"employeeNo\":\"TARGET\"}"))).andExpect(status().isBadRequest());
        target.setEnabled(true);
        JsonNode user = send(other(post(path + "/users").content(request)));
        JsonNode second = send(other(post("/portal-api/applications").content("{}")));
        String secondId = send(other(get("/portal-api/applications").param("appKey", second.at("/application/appKey").asText()))).at("/items/0/id").asText();
        mvc.perform(other(post("/portal-api/bindings/" + secondId + "/users/" + user.get("id").asText() + "/revoke")
                .content("{\"expectedAuthorizationVersion\":0}"))).andExpect(status().isNotFound());
        mvc.perform(other(post(path + "/users/" + user.get("id").asText() + "/revoke")
                .content("{\"expectedAuthorizationVersion\":999}"))).andExpect(status().isConflict());
        mvc.perform(post(path + "/users").session(io.github.chenyilei2016.openplatform.testing.TestSessions.session("other-session"))
                .contentType("application/json").content(request)).andExpect(status().isForbidden());
        assertThat(send(other(get(path + "/users"))).at("/items/0/status").asText()).isEqualTo("ACTIVE");
    }

    private TestEmployee delegatedEmployee() {
        TestEmployee employee = new TestEmployee(); employee.setId(303L); employee.setUserId(9007199254740997L);
        employee.setTenantId(102L); employee.setEmployeeNoStr("TARGET"); employee.setName("从未登录的目标人员");
        employee.setEnabled(true); employee.setEmployeeStatus(4); return employee;
    }

    private String token(JsonNode created, String tenantId) throws Exception {
        return send(post("/api/token").contentType("application/json").content(body(Map.of(
                "appKey", created.at("/application/appKey").asText(), "appSecret", created.get("appSecret").asText(), "tenantId", tenantId))))
                .get("accessToken").asText();
    }

    private String body(Map<String, ?> value) { return json.writeValueAsString(value); }

    private JsonNode send(MockHttpServletRequestBuilder request) throws Exception {
        var result = mvc.perform(request).andExpect(status().isOk()).andExpect(jsonPath("$.code").value(200)).andReturn();
        if (result.getRequest().getRequestURI().startsWith("/portal-api")) {
            assertThat(result.getResponse().getHeader("Cache-Control")).isEqualTo("no-store");
            assertThat(result.getResponse().getHeader("X-Content-Type-Options")).isEqualTo("nosniff");
        }
        return json.readTree(result.getResponse().getContentAsString()).get("data");
    }

    private MockHttpServletRequestBuilder auth(MockHttpServletRequestBuilder request) {
        return request.session(io.github.chenyilei2016.openplatform.testing.TestSessions.session("test-session")).header("X-CSRF-Token", "76832d7fdbcdbf4a72129f8b7def9016").contentType("application/json");
    }

    private MockHttpServletRequestBuilder other(MockHttpServletRequestBuilder request) {
        return request.session(io.github.chenyilei2016.openplatform.testing.TestSessions.session("other-session")).header("X-CSRF-Token", "5cad80ad570259209f805583acd4e8b0").contentType("application/json");
    }
}
