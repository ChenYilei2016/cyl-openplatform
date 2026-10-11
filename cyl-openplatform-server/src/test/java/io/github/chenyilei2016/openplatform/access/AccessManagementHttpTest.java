package io.github.chenyilei2016.openplatform.access;


import io.github.chenyilei2016.openplatform.application.identity.AccountAuthentication;
import io.github.chenyilei2016.openplatform.testing.TestAccount;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@io.github.chenyilei2016.openplatform.testing.TestAdministrators
@SpringBootTest(properties = {

        "test.admin.operators[0].tenant-id=tenant-1",
        "test.admin.operators[0].employee-no=operator-1",
        "test.admin.operators[0].permissions[0]=MANAGE_APPLICATIONS",
        "test.admin.operators[1].tenant-id=tenant-2",
        "test.admin.operators[1].employee-no=viewer",
        "test.admin.operators[1].permissions[0]=VIEW_AUDIT"
})
@AutoConfigureMockMvc(print = org.springframework.boot.webmvc.test.autoconfigure.MockMvcPrint.NONE)
class AccessManagementHttpTest {
    @Autowired MockMvc mvc;
    @MockitoBean AccountAuthentication identityService;
    @MockitoBean io.github.chenyilei2016.openplatform.domain.access.EmployeeDirectory employeeFacade;
    @org.springframework.test.context.bean.override.mockito.MockitoSpyBean
    io.github.chenyilei2016.openplatform.domain.access.EmployeeProfileRepository profiles;
    @org.springframework.test.context.bean.override.mockito.MockitoSpyBean
    io.github.chenyilei2016.openplatform.domain.observability.CallRecordRepository callRecords;
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
    void credentialFiltersUseTenantRelationAndDeduplicateBeforePagination() throws Exception {
        String name = "组合%_!" + UUID.randomUUID();
        String tenant = "query-" + UUID.randomUUID();
        JsonNode first = send(post("/admin-api/applications").content(json.writeValueAsString(java.util.Map.of("name", name, "ownerTenantId", "owner-other"))));
        JsonNode second = send(post("/admin-api/applications").content(json.writeValueAsString(java.util.Map.of("name", name, "ownerTenantId", tenant))));
        String firstId = first.at("/application/id").asText();
        JsonNode grant = send(post("/admin-api/tenant-grants").content(json.writeValueAsString(java.util.Map.of(
                "appKey", first.at("/application/appKey").asText(), "appSecret", first.get("appSecret").asText(), "tenantId", tenant))));
        send(post("/admin-api/tenant-grants").content(json.writeValueAsString(java.util.Map.of(
                "appKey", first.at("/application/appKey").asText(), "appSecret", first.get("appSecret").asText(), "tenantId", "another-tenant"))));
        JsonNode list = send(get("/admin-api/applications").param("query", name).param("tenantId", tenant).param("pageSize", "1"));
        assertThat(list.get("total").asLong()).isEqualTo(1);
        assertThat(list.at("/items/0/id").asText()).isEqualTo(firstId);
        assertThat(list.at("/items/0/selectedTenantGrantStatus").asText()).isEqualTo("ACTIVE");
        assertThat(list.at("/items/0/tenantGrantCount").asLong()).isEqualTo(2);
        assertThat(list.at("/items/0/matchedTenantGrantCount").asLong()).isEqualTo(1);
        assertThat(list.at("/items/0/matchedTenantGrants").size()).isEqualTo(1);
        assertThat(list.at("/items/0/matchedTenantGrants/0/tenantId").asText()).isEqualTo(tenant);
        assertThat(send(get("/admin-api/applications").param("query", name).param("relationStatus", "ACTIVE")).get("total").asLong()).isEqualTo(1);
        assertThat(send(get("/admin-api/applications").param("query", name).param("relationStatus", "ACTIVE", "REVOKED")).get("total").asLong()).isEqualTo(2);
        assertThat(send(get("/admin-api/applications").param("query", name)).get("total").asLong()).isEqualTo(2);
        send(put("/admin-api/applications/" + firstId + "/status").content("{\"enabled\":false}"));
        assertThat(send(get("/admin-api/applications").param("query", name).param("tenantId", tenant)
                .param("status", "ENABLED")).get("total").asLong()).isZero();
        assertThat(send(get("/admin-api/applications").param("tenantId", tenant).param("appKey", first.at("/application/appKey").asText())
                .param("status", "ENABLED", "DISABLED")).get("total").asLong()).isEqualTo(1);
        send(delete("/admin-api/tenant-grants/" + grant.get("id").asText()));
        assertThat(send(get("/admin-api/applications").param("query", name).param("tenantId", tenant)).get("total").asLong()).isZero();
        JsonNode history = send(get("/admin-api/applications").param("query", name).param("tenantId", tenant).param("relationStatus", "ACTIVE", "REVOKED"));
        assertThat(history.get("total").asLong()).isEqualTo(1);
        assertThat(history.at("/items/0/selectedTenantGrantStatus").asText()).isEqualTo("REVOKED");
        assertThat(send(get("/admin-api/applications").param("query", name).param("appKey", second.at("/application/appKey").asText()))
                .get("total").asLong()).isEqualTo(1);
        mvc.perform(auth(get("/admin-api/applications").param("tenantId", " "))).andExpect(status().isBadRequest());
        mvc.perform(auth(get("/admin-api/applications").param("status", "UNKNOWN"))).andExpect(status().isBadRequest());
    }

    @Test
    void credentialSearchMatchesNameAppKeyOrTokenRecordAndRejectsRawTokens() throws Exception {
        String code = "search-" + UUID.randomUUID();
        send(post("/admin-api/scopes").content(json.writeValueAsString(java.util.Map.of(
                "code", code, "name", "搜索权限", "enabled", true, "defaultForNewApplication", false))));
        String name = "搜索凭据" + UUID.randomUUID();
        JsonNode first = send(post("/admin-api/applications").content(json.writeValueAsString(java.util.Map.of(
                "name", name + "-甲", "ownerTenantId", "100", "scopeCodes", java.util.List.of(code)))));
        JsonNode second = send(post("/admin-api/applications").content(json.writeValueAsString(java.util.Map.of(
                "name", name + "-乙", "ownerTenantId", "100", "scopeCodes", java.util.List.of()))));
        assertThat(first.at("/application/scopeCodes").toString()).isEqualTo("[\"" + code + "\"]");
        assertThat(second.at("/application/scopeCodes").size()).isZero();
        assertThat(second.get("appSecret").asText()).isNotBlank();
        mvc.perform(auth(post("/admin-api/applications").content(json.writeValueAsString(java.util.Map.of(
                "name", "初始权限组无效", "ownerTenantId", "100", "scopeCodes", java.util.List.of("missing-" + UUID.randomUUID()))))))
                .andExpect(status().isBadRequest());
        String firstId = first.at("/application/id").asText();
        String issue = json.writeValueAsString(java.util.Map.of("appKey", first.at("/application/appKey").asText(),
                "appSecret", first.get("appSecret").asText(), "tenantId", "101"));
        send(post("/admin-api/tenant-grants").content(issue));
        JsonNode token = send(post("/api/token").content(issue));
        String tokenId = token.at("/context/tokenId").asText();

        JsonNode byName = send(get("/admin-api/applications").param("search", name));
        assertThat(byName.get("total").asLong()).isEqualTo(2);
        assertThat(byName.at("/items/0").hasNonNull("matchedTokenId")).isFalse();
        JsonNode byKey = send(get("/admin-api/applications").param("search", second.at("/application/appKey").asText()));
        assertThat(byKey.get("total").asLong()).isEqualTo(1);
        assertThat(byKey.at("/items/0/id").asText()).isEqualTo(second.at("/application/id").asText());
        // Token 记录 ID 走单独条件；主搜索框不再猜测 Token 记录 ID（按名称包含，查无结果）。
        assertThat(send(get("/admin-api/applications").param("search", tokenId)).get("total").asLong()).isZero();
        JsonNode byToken = send(get("/admin-api/applications").param("tokenId", " " + tokenId + " "));
        assertThat(byToken.get("total").asLong()).isEqualTo(1);
        assertThat(byToken.at("/items/0/id").asText()).isEqualTo(firstId);
        assertThat(byToken.at("/items/0/matchedTokenId").asText()).isEqualTo(tokenId);
        assertThat(byToken.toString()).doesNotContain(token.get("accessToken").asText());
        assertThat(send(get("/admin-api/applications").param("tokenId", "TOK_" + "0".repeat(32))).get("total").asLong()).isZero();
        mvc.perform(auth(get("/admin-api/applications").param("tokenId", "TOK_1"))).andExpect(status().isBadRequest());
        mvc.perform(auth(get("/admin-api/applications").param("tokenId", token.get("accessToken").asText()))).andExpect(status().isBadRequest());
        mvc.perform(auth(get("/admin-api/applications").param("search", token.get("accessToken").asText())))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.resultMsg").value(org.hamcrest.Matchers.containsString("Token 记录 ID")));
        mvc.perform(auth(get("/admin-api/applications").param("search", "Bearer " + token.get("accessToken").asText())))
                .andExpect(status().isBadRequest());
        mvc.perform(auth(get("/admin-api/applications").param("search", "x".repeat(101)))).andExpect(status().isBadRequest());
    }

    @Test
    void credentialListAggregatesTenantNamesAndLatestProductionCallOncePerPage() throws Exception {
        String name = "聚合凭据" + UUID.randomUUID();
        java.util.List<String> ids = new java.util.ArrayList<>();
        for (int index = 0; index < 3; index++)
            ids.add(send(post("/admin-api/applications").content(json.writeValueAsString(java.util.Map.of(
                    "name", name + index, "ownerTenantId", "owner-" + index)))).at("/application/id").asText());
        java.time.Instant production = java.time.Instant.now().minusSeconds(120).truncatedTo(java.time.temporal.ChronoUnit.MILLIS);
        callRecords.append(callRecord(ids.getFirst(), io.github.chenyilei2016.openplatform.domain.observability.CallMode.PRODUCTION, production));
        callRecords.append(callRecord(ids.getFirst(), io.github.chenyilei2016.openplatform.domain.observability.CallMode.DRAFT_DEBUG, production.plusSeconds(60)));
        callRecords.append(callRecord(ids.get(1), io.github.chenyilei2016.openplatform.domain.observability.CallMode.DRAFT_DEBUG, production));
        org.mockito.Mockito.clearInvocations(profiles, callRecords);
        JsonNode page = send(get("/admin-api/applications").param("search", name));
        assertThat(page.get("total").asLong()).isEqualTo(3);
        java.util.Map<String, JsonNode> items = new java.util.HashMap<>();
        page.get("items").forEach(item -> items.put(item.get("id").asText(), item));
        assertThat(java.time.Instant.parse(items.get(ids.getFirst()).get("lastCalledAt").asText())).isEqualTo(production);
        assertThat(items.get(ids.get(1)).hasNonNull("lastCalledAt")).isFalse();
        assertThat(items.get(ids.get(2)).hasNonNull("lastCalledAt")).isFalse();
        org.mockito.Mockito.verify(callRecords, org.mockito.Mockito.times(1)).latestProductionCalls(org.mockito.ArgumentMatchers.anyCollection());
        org.mockito.Mockito.verify(profiles, org.mockito.Mockito.times(1)).tenantNames(org.mockito.ArgumentMatchers.anyCollection());
        assertThat(java.time.Instant.parse(send(get("/admin-api/applications/" + ids.getFirst())).get("lastCalledAt").asText())).isEqualTo(production);
    }

    private io.github.chenyilei2016.openplatform.domain.observability.CallRecord callRecord(String applicationId,
            io.github.chenyilei2016.openplatform.domain.observability.CallMode mode, java.time.Instant at) {
        return io.github.chenyilei2016.openplatform.domain.observability.CallRecord.builder()
                .id(io.github.chenyilei2016.openplatform.domain.common.ObjectIdType.CALL_RECORD.nextId()).requestId("search-" + UUID.randomUUID())
                .mode(mode).apiId("API_" + UUID.randomUUID().toString().replace("-", "")).service("svc").version("1.0.0").method("m")
                .applicationId(applicationId).tenantId("101").clientIp("127.0.0.1").outcome("SUCCESS").httpStatus(200)
                .durationMillis(3).occurredAt(at).build();
    }

    @Test
    void scopeFiltersKeepNameCodeAndDefaultAvailabilityIndependent() throws Exception {
        String code = "filter-" + UUID.randomUUID();
        String name = "默认%_!" + UUID.randomUUID();
        send(post("/admin-api/scopes").content(json.writeValueAsString(java.util.Map.of(
                "code", code, "name", name, "enabled", false, "defaultForNewApplication", true))));
        JsonNode page = send(get("/admin-api/scopes").param("code", code).param("name", name)
                .param("enabled", "false").param("defaultForNewApplication", "true"));
        assertThat(page.get("total").asLong()).isEqualTo(1);
        assertThat(send(get("/admin-api/scopes").param("code", code).param("enabled", "true")).get("total").asLong()).isZero();
        assertThat(send(get("/admin-api/scopes").param("code", code).param("enabled", "true", "false")
                .param("defaultForNewApplication", "true", "false")).get("total").asLong()).isEqualTo(1);
        assertThat(send(get("/admin-api/scopes").param("query", code)).get("total").asLong()).isEqualTo(1);
        assertThat(send(get("/admin-api/scopes").param("name", code)).get("total").asLong()).isZero();
    }

    @Test
    void creationAssignsDefaultScopesAndOnlyCreationRevealsSecret() throws Exception {
        String code = "orders-" + UUID.randomUUID();
        send(post("/admin-api/scopes").content(json.writeValueAsString(java.util.Map.of(
                "code", code, "name", "订单", "enabled", true, "defaultForNewApplication", true))));
        JsonNode created = send(post("/admin-api/applications").content("{\"ownerTenantId\":\"9007199254740993\"}"));
        String id = created.at("/application/id").asText();
        assertThat(id).matches("APP_[0-9a-f]{32}");
        assertThat(created.get("appSecret").asText()).hasSizeGreaterThanOrEqualTo(43);
        assertThat(created.at("/application/ownerTenantId").asText()).isEqualTo("9007199254740993");
        assertThat(created.at("/application/name").asText()).isEqualTo("接入凭据-" + id.substring(id.length() - 8));
        assertThat(created.at("/application/scopeCodes").toString()).contains(code);
        JsonNode detail = send(get("/admin-api/applications/" + id));
        assertThat(detail.has("appSecret")).isFalse();
        assertThat(detail.toString()).doesNotContain("secret", "digest", "hash");
        JsonNode page = send(get("/admin-api/applications").param("appKey", created.at("/application/appKey").asText()));
        assertThat(page.get("total").asLong()).isEqualTo(1);
        assertThat(page.at("/items/0/id").asText()).isEqualTo(id);
    }

    @Test
    void scopeAndCredentialChangesAreVersionedAtomicAndAudited() throws Exception {
        String code = "extra-" + UUID.randomUUID();
        JsonNode scope = send(post("/admin-api/scopes").content(json.writeValueAsString(java.util.Map.of(
                "code", code, "name", "额外授权", "enabled", true, "defaultForNewApplication", false))));
        JsonNode created = send(post("/admin-api/applications").content("{\"name\":\"权限测试\",\"ownerTenantId\":\"100\"}"));
        String id = created.at("/application/id").asText();
        send(put("/admin-api/applications/" + id + "/scopes").content(json.writeValueAsString(java.util.Map.of("scopeCodes", java.util.List.of(code))))) ;
        JsonNode renamed = send(put("/admin-api/applications/" + id).content("{\"name\":\"已重命名\",\"expectedName\":\"权限测试\",\"ownerTenantId\":\"evil\"}"));
        assertThat(renamed.get("ownerTenantId").asText()).isEqualTo("100");
        assertThat(renamed.get("authorizationVersion").asLong()).isEqualTo(1);
        mvc.perform(auth(put("/admin-api/applications/" + id + "/scopes").content("{\"scopeCodes\":[\"missing-scope\"]}")))
                .andExpect(status().isBadRequest());
        assertThat(send(get("/admin-api/applications/" + id)).get("scopeCodes").toString()).isEqualTo("[\"" + code + "\"]");
        send(put("/admin-api/applications/" + id + "/status").content("{\"enabled\":false}"));
        JsonNode enabled = send(put("/admin-api/applications/" + id + "/status").content("{\"enabled\":true}"));
        assertThat(enabled.get("authorizationVersion").asLong()).isEqualTo(3);
        JsonNode rotated = send(post("/admin-api/applications/" + id + "/secret/rotate"));
        assertThat(rotated.get("appSecret").asText()).isNotEqualTo(created.get("appSecret").asText());
        assertThat(rotated.get("appKey").asText()).isEqualTo(created.at("/application/appKey").asText());
        assertThat(send(get("/admin-api/applications/" + id)).get("authorizationVersion").asLong()).isEqualTo(4);
        JsonNode audit = send(get("/admin-api/applications/" + id + "/audit"));
        assertThat(audit.get("total").asLong()).isEqualTo(7);
        assertThat(audit.toString()).contains("FAILURE", "SUCCESS", "operator-1", "requestId");
        assertThat(audit.toString()).doesNotContain(created.get("appSecret").asText(), rotated.get("appSecret").asText());
        send(put("/admin-api/scopes/" + scope.get("id").asText()).content("{\"name\":\"默认组\",\"enabled\":true,\"defaultForNewApplication\":true}"));
        JsonNode unchanged = send(get("/admin-api/applications/" + id));
        assertThat(unchanged.get("authorizationVersion").asLong()).isEqualTo(4);
    }

    @Test
    void tenantBindingVerifiesCredentialsAndRevocationDoesNotAffectOtherTenants() throws Exception {
        JsonNode created = send(post("/admin-api/applications").content("{\"name\":\"多租户应用\",\"ownerTenantId\":\"100\"}"));
        String id = created.at("/application/id").asText();
        String appKey = created.at("/application/appKey").asText();
        String secret = created.get("appSecret").asText();
        mvc.perform(auth(post("/admin-api/tenant-grants").content(json.writeValueAsString(java.util.Map.of(
                "appKey", appKey, "appSecret", "wrong", "tenantId", "101")))))
                .andExpect(status().isForbidden());
        assertThat(send(get("/admin-api/applications/" + id + "/tenant-grants")).get("total").asLong()).isZero();
        JsonNode one = send(post("/admin-api/tenant-grants").content(json.writeValueAsString(java.util.Map.of(
                "appKey", appKey, "appSecret", secret, "tenantId", "101"))));
        send(post("/admin-api/tenant-grants").content(json.writeValueAsString(java.util.Map.of(
                "appKey", appKey, "appSecret", secret, "tenantId", "102"))));
        String grantId = one.get("id").asText();
        send(delete("/admin-api/tenant-grants/" + grantId));
        JsonNode grants = send(get("/admin-api/applications/" + id + "/tenant-grants"));
        assertThat(grants.get("total").asLong()).isEqualTo(2);
        assertThat(grants.toString()).contains("REVOKED", "ACTIVE");
        JsonNode rebound = send(post("/admin-api/tenant-grants").content(json.writeValueAsString(java.util.Map.of(
                "appKey", appKey, "appSecret", secret, "tenantId", "101"))));
        assertThat(rebound.get("id").asText()).isEqualTo(grantId);
        assertThat(rebound.get("authorizationVersion").asLong()).isEqualTo(2);
        send(post("/admin-api/applications/" + id + "/secret/rotate"));
        mvc.perform(auth(post("/admin-api/tenant-grants").content(json.writeValueAsString(java.util.Map.of(
                "appKey", appKey, "appSecret", secret, "tenantId", "103")))))
                .andExpect(status().isForbidden());
        JsonNode audit = send(get("/admin-api/applications/" + id + "/audit"));
        assertThat(audit.toString()).contains("FAILURE", "101", "103").doesNotContain(secret);
    }

    @Test
    void readOnlyFieldCompatibilityDoesNotAcceptUnknownFields() throws Exception {
        mvc.perform(auth(put("/admin-api/applications/any")
                        .content("{\"name\":\"重命名\",\"ownerTenantId\":\"ignored\",\"unexpected\":true}")))
                .andExpect(status().isBadRequest());
        mvc.perform(auth(post("/admin-api/tenant-grants/any/users")
                        .content("{\"employeeNo\":\"A001\",\"userId\":\"ignored\",\"displayName\":\"ignored\",\"unexpected\":true}")))
                .andExpect(status().isBadRequest());
    }

    @Test
    void malformedPageNumberIsAClientError() throws Exception {
        mvc.perform(auth(get("/admin-api/applications").param("page", "abc"))).andExpect(status().isBadRequest());
    }

    @Test
    void explicitPersonnelGrantsUseDirectoryIdentityAndNeverReviveAfterTenantRebinding() throws Exception {
        JsonNode created = send(post("/admin-api/applications").content("{\"name\":\"人员委托应用\",\"ownerTenantId\":\"100\"}"));
        JsonNode tenant = send(post("/admin-api/tenant-grants").content(json.writeValueAsString(java.util.Map.of(
                "appKey", created.at("/application/appKey").asText(), "appSecret", created.get("appSecret").asText(), "tenantId", "101"))));
        String grantId = tenant.get("id").asText();
        var employee = new io.github.chenyilei2016.openplatform.testing.TestEmployee();
        employee.setId(9007199254740993L);
        employee.setUserId(9007199254740995L);
        employee.setTenantId(101L);
        employee.setEmployeeNoStr("A001");
        employee.setName("真实人员");
        employee.setEnabled(true);
        employee.setEmployeeStatus(4);
        when(employeeFacade.find(org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.anyString())).thenAnswer(invocation -> employee.toIdentity());
        JsonNode person = send(post("/admin-api/tenant-grants/" + grantId + "/users")
                .content("{\"employeeNo\":\"A001\",\"userId\":\"evil\",\"displayName\":\"伪造人员\"}"));
        assertThat(person.get("userId").asText()).isEqualTo("9007199254740995");
        assertThat(person.get("employeeId").asText()).isEqualTo("9007199254740993");
        assertThat(person.get("displayName").asText()).isEqualTo("真实人员");
        org.mockito.Mockito.verify(employeeFacade).find(org.mockito.ArgumentMatchers.eq("101"), org.mockito.ArgumentMatchers.eq("A001"));
        employee.setId(9007199254740997L);
        employee.setUserId(9007199254740999L);
        employee.setEmployeeNoStr("A002");
        JsonNode second = send(post("/admin-api/tenant-grants/" + grantId + "/users").content("{\"employeeNo\":\"A002\"}"));
        assertThat(send(get("/admin-api/tenant-grants/" + grantId + "/users")).get("total").asLong()).isEqualTo(2);
        send(delete("/admin-api/user-grants/" + person.get("id").asText()));
        send(delete("/admin-api/tenant-grants/" + grantId));
        send(post("/admin-api/tenant-grants").content(json.writeValueAsString(java.util.Map.of(
                "appKey", created.at("/application/appKey").asText(), "appSecret", created.get("appSecret").asText(), "tenantId", "101"))));
        JsonNode users = send(get("/admin-api/tenant-grants/" + grantId + "/users"));
        for (JsonNode user : users.get("items")) {
            assertThat(user.get("status").asText()).isEqualTo("REVOKED");
            assertThat(user.get("authorizationVersion").asLong()).isEqualTo(1);
        }
        JsonNode reauthorized = send(post("/admin-api/tenant-grants/" + grantId + "/users").content("{\"employeeNo\":\"A002\"}"));
        assertThat(reauthorized.get("id").asText()).isEqualTo(second.get("id").asText());
        assertThat(reauthorized.get("authorizationVersion").asLong()).isEqualTo(2);
    }

    @Test
    void disablingScopeInvalidatesVersionsWithoutChangingOldApplicationMembership() throws Exception {
        String code = "toggle-" + UUID.randomUUID();
        JsonNode scope = send(post("/admin-api/scopes").content(json.writeValueAsString(java.util.Map.of(
                "code", code, "name", "可停用组", "enabled", true, "defaultForNewApplication", false))));
        JsonNode created = send(post("/admin-api/applications").content("{\"name\":\"scope停用检查\",\"ownerTenantId\":\"100\"}"));
        String id = created.at("/application/id").asText();
        send(put("/admin-api/applications/" + id + "/scopes").content(json.writeValueAsString(java.util.Map.of("scopeCodes", java.util.List.of(code)))));
        send(put("/admin-api/scopes/" + scope.get("id").asText()).content("{\"name\":\"已停用组\",\"enabled\":false,\"defaultForNewApplication\":false}"));
        JsonNode disabled = send(get("/admin-api/applications/" + id));
        assertThat(disabled.get("authorizationVersion").asLong()).isEqualTo(2);
        assertThat(disabled.get("scopeCodes").toString()).contains(code);
        mvc.perform(auth(put("/admin-api/applications/" + id + "/scopes").content(json.writeValueAsString(java.util.Map.of("scopeCodes", java.util.List.of(code))))))
                .andExpect(status().isBadRequest());
        send(put("/admin-api/scopes/" + scope.get("id").asText()).content("{\"name\":\"已启用组\",\"enabled\":true,\"defaultForNewApplication\":false}"));
        assertThat(send(get("/admin-api/applications/" + id)).get("authorizationVersion").asLong()).isEqualTo(3);
    }

    @Test
    void invalidOrUnavailableDirectoryIdentityCannotLeaveAnyPersonnelAuthorization() throws Exception {
        JsonNode created = send(post("/admin-api/applications").content("{\"name\":\"身份拒绝检查\",\"ownerTenantId\":\"100\"}"));
        String appId = created.at("/application/id").asText();
        JsonNode tenant = send(post("/admin-api/tenant-grants").content(json.writeValueAsString(java.util.Map.of(
                "appKey", created.at("/application/appKey").asText(), "appSecret", created.get("appSecret").asText(), "tenantId", "101"))));
        String path = "/admin-api/tenant-grants/" + tenant.get("id").asText() + "/users";
        for (Integer employeeStatus : new Integer[]{null, 0, 1, 6, 7}) {
            var employee = validEmployee();
            employee.setEmployeeStatus(employeeStatus);
            when(employeeFacade.find(org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.anyString())).thenAnswer(invocation -> employee.toIdentity());
            mvc.perform(auth(post(path).content("{\"employeeNo\":\"A001\"}"))).andExpect(status().isForbidden());
        }
        var employee = validEmployee();
        employee.setTenantId(102L);
        when(employeeFacade.find(org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.anyString())).thenAnswer(invocation -> employee.toIdentity());
        mvc.perform(auth(post(path).content("{\"employeeNo\":\"A001\"}"))).andExpect(status().isForbidden());
        employee.setTenantId(101L);
        employee.setEmployeeNoStr("another");
        mvc.perform(auth(post(path).content("{\"employeeNo\":\"A001\"}"))).andExpect(status().isForbidden());
        employee.setEmployeeNoStr("A001");
        employee.setEnabled(false);
        mvc.perform(auth(post(path).content("{\"employeeNo\":\"A001\"}"))).andExpect(status().isForbidden());
        employee.setEnabled(true);
        employee.setUserId(null);
        mvc.perform(auth(post(path).content("{\"employeeNo\":\"A001\"}"))).andExpect(status().isForbidden());
        employee.setUserId(1L);
        employee.setId(null);
        mvc.perform(auth(post(path).content("{\"employeeNo\":\"A001\"}"))).andExpect(status().isForbidden());
        employee.setId(1L);
        employee.setName(" ");
        mvc.perform(auth(post(path).content("{\"employeeNo\":\"A001\"}"))).andExpect(status().isForbidden());
        when(employeeFacade.find(org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.anyString())).thenThrow(new io.github.chenyilei2016.openplatform.domain.common.PlatformException(io.github.chenyilei2016.openplatform.domain.common.ErrorCode.FORBIDDEN, "人员不存在"));
        mvc.perform(auth(post(path).content("{\"employeeNo\":\"A001\"}"))).andExpect(status().isForbidden());
        org.mockito.Mockito.reset(employeeFacade);
        when(employeeFacade.find(org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.anyString())).thenThrow(new io.github.chenyilei2016.openplatform.domain.common.PlatformException(io.github.chenyilei2016.openplatform.domain.common.ErrorCode.DEPENDENCY_UNAVAILABLE, "人员目录暂不可用"));
        mvc.perform(auth(post(path).content("{\"employeeNo\":\"A001\"}"))).andExpect(status().isServiceUnavailable())
                .andExpect(content().string(org.hamcrest.Matchers.not(org.hamcrest.Matchers.containsString("upstream-secret-do-not-expose"))));
        assertThat(send(get(path)).get("total").asLong()).isZero();
        JsonNode audit = send(get("/admin-api/applications/" + appId + "/audit"));
        assertThat(audit.get("total").asLong()).isEqualTo(15);
        assertThat(audit.toString()).contains("FAILURE").doesNotContain("upstream-secret-do-not-expose");
    }

    @Test
    void concurrentBindingKeepsOneRelationshipAndRotationDoesNotLoseVersionUpdates() throws Exception {
        JsonNode created = send(post("/admin-api/applications").content("{\"name\":\"并发检查\",\"ownerTenantId\":\"100\"}"));
        String id = created.at("/application/id").asText();
        String body = json.writeValueAsString(java.util.Map.of("appKey", created.at("/application/appKey").asText(),
                "appSecret", created.get("appSecret").asText(), "tenantId", "101"));
        try (var executor = java.util.concurrent.Executors.newFixedThreadPool(2)) {
            var start = new java.util.concurrent.CountDownLatch(1);
            java.util.concurrent.Callable<Integer> bind = () -> {
                start.await();
                return mvc.perform(auth(post("/admin-api/tenant-grants").content(body))).andReturn().getResponse().getStatus();
            };
            var first = executor.submit(bind);
            var second = executor.submit(bind);
            start.countDown();
            assertThat(java.util.List.of(first.get(10, java.util.concurrent.TimeUnit.SECONDS), second.get(10, java.util.concurrent.TimeUnit.SECONDS)))
                    .containsExactlyInAnyOrder(200, 409);
            assertThat(send(get("/admin-api/applications/" + id + "/tenant-grants")).get("total").asLong()).isEqualTo(1);
            var rotateOne = executor.submit(() -> send(post("/admin-api/applications/" + id + "/secret/rotate")));
            var rotateTwo = executor.submit(() -> send(post("/admin-api/applications/" + id + "/secret/rotate")));
            assertThat(rotateOne.get(10, java.util.concurrent.TimeUnit.SECONDS).get("appSecret").asText())
                    .isNotEqualTo(rotateTwo.get(10, java.util.concurrent.TimeUnit.SECONDS).get("appSecret").asText());
            assertThat(send(get("/admin-api/applications/" + id)).get("authorizationVersion").asLong()).isEqualTo(2);
        }
    }

    @Test
    void revocationDuringDirectoryLookupCompletesWithoutWaitingAndRejectsTheStaleGrant() throws Exception {
        JsonNode created = send(post("/admin-api/applications").content("{\"name\":\"撤销竞态检查\",\"ownerTenantId\":\"100\"}"));
        String binding = json.writeValueAsString(java.util.Map.of("appKey", created.at("/application/appKey").asText(),
                "appSecret", created.get("appSecret").asText(), "tenantId", "101"));
        JsonNode tenant = send(post("/admin-api/tenant-grants").content(binding));
        String tenantId = tenant.get("id").asText();
        var querying = new java.util.concurrent.CountDownLatch(1);
        var release = new java.util.concurrent.CountDownLatch(1);
        when(employeeFacade.find(org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.anyString())).thenAnswer(invocation -> {
            querying.countDown();
            if (!release.await(10, java.util.concurrent.TimeUnit.SECONDS)) throw new IllegalStateException("lookup timed out");
            return validEmployee().toIdentity();
        });
        try (var executor = java.util.concurrent.Executors.newFixedThreadPool(2)) {
            var pending = executor.submit(() -> mvc.perform(auth(post("/admin-api/tenant-grants/" + tenantId + "/users")
                    .content("{\"employeeNo\":\"A001\"}"))).andReturn().getResponse().getStatus());
            try {
                assertThat(querying.await(5, java.util.concurrent.TimeUnit.SECONDS)).isTrue();
                var revoke = executor.submit(() -> send(delete("/admin-api/tenant-grants/" + tenantId)));
                revoke.get(3, java.util.concurrent.TimeUnit.SECONDS);
                send(post("/admin-api/tenant-grants").content(binding));
            } finally {
                release.countDown();
            }
            assertThat(pending.get(5, java.util.concurrent.TimeUnit.SECONDS)).isEqualTo(409);
            assertThat(send(get("/admin-api/tenant-grants/" + tenantId + "/users")).get("total").asLong()).isZero();
        }
    }

    private io.github.chenyilei2016.openplatform.testing.TestEmployee validEmployee() {
        var employee = new io.github.chenyilei2016.openplatform.testing.TestEmployee();
        employee.setId(9007199254740993L);
        employee.setUserId(9007199254740995L);
        employee.setTenantId(101L);
        employee.setEmployeeNoStr("A001");
        employee.setName("真实人员");
        employee.setEnabled(true);
        employee.setEmployeeStatus(4);
        return employee;
    }

    @Test
    void paginationIsBoundedLiteralAndRequiresPlatformManagementPermission() throws Exception {
        String suffix = UUID.randomUUID().toString();
        JsonNode literal = send(post("/admin-api/applications").content(json.writeValueAsString(java.util.Map.of("name", "literal%_" + suffix, "ownerTenantId", "100"))));
        send(post("/admin-api/applications").content(json.writeValueAsString(java.util.Map.of("name", "literalXY" + suffix, "ownerTenantId", "100"))));
        JsonNode page = send(get("/admin-api/applications").param("query", "%_" + suffix).param("pageSize", "1"));
        assertThat(page.get("total").asLong()).isEqualTo(1);
        assertThat(page.at("/items/0/id").asText()).isEqualTo(literal.at("/application/id").asText());
        assertThat(send(get("/admin-api/applications").param("query", suffix).param("page", "2").param("pageSize", "1")).get("items").size()).isEqualTo(1);
        for (String size : new String[]{"0", "101"}) mvc.perform(auth(get("/admin-api/applications").param("pageSize", size))).andExpect(status().isBadRequest());
        mvc.perform(auth(get("/admin-api/applications").param("query", "a".repeat(101)))).andExpect(status().isBadRequest());
        mvc.perform(auth(get("/admin-api/applications").param("appKey", "A" + literal.at("/application/appKey").asText().substring(1))))
                .andExpect(status().isBadRequest());
        mvc.perform(get("/admin-api/applications")).andExpect(status().isUnauthorized());
        mvc.perform(post("/admin-api/applications").session(io.github.chenyilei2016.openplatform.testing.TestSessions.session("test-session"))
                .contentType("application/json").content("{\"name\":\"缺少CSRF\",\"ownerTenantId\":\"100\"}"))
                .andExpect(status().isForbidden());
        var viewer = new TestAccount();
        viewer.setId(7L); viewer.setTenantId("tenant-2"); viewer.setEmployeeNoStr("viewer");
        when(identityService.current("test-session")).thenAnswer(invocation -> viewer.toAccount());
        mvc.perform(auth(get("/admin-api/applications"))).andExpect(status().isForbidden());
        mvc.perform(auth(post("/admin-api/applications").content("{\"name\":\"越权\",\"ownerTenantId\":\"100\"}")))
                .andExpect(status().isForbidden());
    }

    @Test
    void allFourActiveEmploymentStatusesAreGrantable() throws Exception {
        JsonNode created = send(post("/admin-api/applications").content("{\"name\":\"在职状态检查\",\"ownerTenantId\":\"100\"}"));
        JsonNode tenant = send(post("/admin-api/tenant-grants").content(json.writeValueAsString(java.util.Map.of(
                "appKey", created.at("/application/appKey").asText(), "appSecret", created.get("appSecret").asText(), "tenantId", "101"))));
        String path = "/admin-api/tenant-grants/" + tenant.get("id").asText() + "/users";
        for (int state : new int[]{2, 3, 4, 5}) {
            var employee = validEmployee();
            employee.setId((long) state); employee.setUserId((long) state); employee.setEmployeeNoStr("A" + state); employee.setEmployeeStatus(state);
            when(employeeFacade.find(org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.anyString())).thenAnswer(invocation -> employee.toIdentity());
            assertThat(send(post(path).content(json.writeValueAsString(java.util.Map.of("employeeNo", "A" + state)))).get("status").asText()).isEqualTo("ACTIVE");
        }
        assertThat(send(get(path).param("pageSize", "2")).get("total").asLong()).isEqualTo(4);
        assertThat(send(get(path).param("pageSize", "2")).get("items").size()).isEqualTo(2);
    }

    @Test
    void aPersonnelRevocationDuringLookupCannotBeUndoneByTheEarlierGrantRequest() throws Exception {
        JsonNode created = send(post("/admin-api/applications").content("{\"name\":\"人员撤销竞态\",\"ownerTenantId\":\"100\"}"));
        JsonNode tenant = send(post("/admin-api/tenant-grants").content(json.writeValueAsString(java.util.Map.of(
                "appKey", created.at("/application/appKey").asText(), "appSecret", created.get("appSecret").asText(), "tenantId", "101"))));
        String path = "/admin-api/tenant-grants/" + tenant.get("id").asText() + "/users";
        when(employeeFacade.find(org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.anyString())).thenReturn(validEmployee().toIdentity());
        JsonNode person = send(post(path).content("{\"employeeNo\":\"A001\"}"));
        var querying = new java.util.concurrent.CountDownLatch(1);
        var release = new java.util.concurrent.CountDownLatch(1);
        when(employeeFacade.find(org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.anyString())).thenAnswer(invocation -> {
            querying.countDown();
            if (!release.await(10, java.util.concurrent.TimeUnit.SECONDS)) throw new IllegalStateException("lookup timed out");
            return validEmployee().toIdentity();
        });
        try (var executor = java.util.concurrent.Executors.newFixedThreadPool(2)) {
            var pending = executor.submit(() -> mvc.perform(auth(post(path).content("{\"employeeNo\":\"A001\"}"))).andReturn().getResponse().getStatus());
            try {
                assertThat(querying.await(5, java.util.concurrent.TimeUnit.SECONDS)).isTrue();
                executor.submit(() -> send(delete("/admin-api/user-grants/" + person.get("id").asText())))
                        .get(3, java.util.concurrent.TimeUnit.SECONDS);
            } finally { release.countDown(); }
            assertThat(pending.get(5, java.util.concurrent.TimeUnit.SECONDS)).isEqualTo(409);
            assertThat(send(get(path)).at("/items/0/status").asText()).isEqualTo("REVOKED");
        }
    }

    @Test
    void relationDeepLinksValidateParentsAndFilterBeforePaging() throws Exception {
        JsonNode created = send(post("/admin-api/applications").content("{\"name\":\"深链检查\",\"ownerTenantId\":\"100\"}"));
        JsonNode other = send(post("/admin-api/applications").content("{\"name\":\"其他凭据\",\"ownerTenantId\":\"100\"}"));
        String appId = created.at("/application/id").asText();
        JsonNode grant = send(post("/admin-api/tenant-grants").content(json.writeValueAsString(java.util.Map.of(
                "appKey", created.at("/application/appKey").asText(), "appSecret", created.get("appSecret").asText(), "tenantId", "101"))));
        String base = "/admin-api/applications/" + appId + "/tenant-grants";
        String detail = base + "/" + grant.get("id").asText();
        assertThat(send(get(detail)).get("tenantId").asText()).isEqualTo("101");
        assertThat(send(get(base).param("tenantId", "101").param("pageSize", "1")).get("total").asInt()).isEqualTo(1);
        assertThat(send(get(base).param("tenantId", "10")).get("total").asInt()).isZero();
        mvc.perform(auth(get(detail.replace(appId, other.at("/application/id").asText())))).andExpect(status().isNotFound());
        mvc.perform(auth(get(detail.replace(appId, other.at("/application/id").asText()) + "/users"))).andExpect(status().isNotFound());
        mvc.perform(auth(get(base + "/missing"))).andExpect(status().isNotFound());
        when(employeeFacade.find(org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.anyString())).thenReturn(validEmployee().toIdentity());
        send(post("/admin-api/tenant-grants/" + grant.get("id").asText() + "/users").content("{\"employeeNo\":\"A001\"}"));
        assertThat(send(get(detail + "/users").param("employeeNo", "A001")).get("total").asInt()).isEqualTo(1);
        assertThat(send(get(detail + "/users").param("employeeNo", "A00")).get("total").asInt()).isZero();
        send(delete("/admin-api/tenant-grants/" + grant.get("id").asText()));
        assertThat(send(get(detail)).get("status").asText()).isEqualTo("REVOKED");
    }

    @Test
    void displayEditsKeepAuthorizationAndRejectStaleOrWrongParent() throws Exception {
        JsonNode created = send(post("/admin-api/applications").content("{\"name\":\"原名称\",\"ownerTenantId\":\"note-owner\"}"));
        String id = created.at("/application/id").asText();
        JsonNode grant = send(post("/admin-api/tenant-grants").content(json.writeValueAsString(java.util.Map.of(
                "appKey", created.at("/application/appKey").asText(), "appSecret", created.get("appSecret").asText(), "tenantId", "note-tenant"))));
        String path = "/admin-api/applications/" + id + "/tenant-grants/" + grant.get("id").asText() + "/note";
        assertThat(send(get("/admin-api/applications/" + id)).get("activeTenantGrantCount").asLong()).isEqualTo(1);
        JsonNode updated = send(put(path).content("{\"note\":\"用途备注\",\"expectedRevision\":0}"));
        assertThat(updated.get("noteRevision").asLong()).isEqualTo(1);
        assertThat(updated.get("authorizationVersion").asLong()).isEqualTo(grant.get("authorizationVersion").asLong());
        mvc.perform(auth(put(path).content("{\"note\":\"过期覆盖\",\"expectedRevision\":0}"))).andExpect(status().isConflict());
        assertThat(send(get(path.replace("/note", ""))).get("note").asText()).isEqualTo("用途备注");
        mvc.perform(auth(put(path.replace(id, "wrong-parent")).content("{\"note\":\"越界\",\"expectedRevision\":1}"))).andExpect(status().isNotFound());
        JsonNode cleared = send(put(path).content("{\"note\":\"\",\"expectedRevision\":1}"));
        assertThat(cleared.get("note").asText()).isEmpty();
        send(put("/admin-api/applications/" + id).content("{\"name\":\"新名称\",\"expectedName\":\"原名称\"}"));
        mvc.perform(auth(put("/admin-api/applications/" + id).content("{\"name\":\"过期名称\",\"expectedName\":\"原名称\"}"))).andExpect(status().isConflict());
        assertThat(send(get("/admin-api/applications/" + id)).get("name").asText()).isEqualTo("新名称");
        assertThat(send(get("/admin-api/applications/" + id)).get("authorizationVersion").asLong()).isZero();
        send(delete("/admin-api/tenant-grants/" + grant.get("id").asText()));
        assertThat(send(get("/admin-api/applications/" + id + "/tenant-grants")).get("total").asLong()).isEqualTo(1);
        assertThat(send(get("/admin-api/applications/" + id)).get("activeTenantGrantCount").asLong()).isZero();
    }

    @Test
    void pageProjectsLatestKnownTenantNamesInOneBoundedLookup() throws Exception {
        String tenant = "display-" + UUID.randomUUID();
        java.time.Instant now = java.time.Instant.now();
        profiles.remember(new io.github.chenyilei2016.openplatform.domain.access.EmployeeProfile(null, tenant, "旧名称", "p1", "u1", "001", "甲", now.minusSeconds(5)), now);
        profiles.remember(new io.github.chenyilei2016.openplatform.domain.access.EmployeeProfile(null, tenant, "展示租户", "p2", "u2", "002", "乙", now), now);
        String name = "展示批次-" + UUID.randomUUID();
        JsonNode created = send(post("/admin-api/applications").content(json.writeValueAsString(java.util.Map.of("name", name, "ownerTenantId", tenant))));
        send(post("/admin-api/tenant-grants").content(json.writeValueAsString(java.util.Map.of(
                "appKey", created.at("/application/appKey").asText(), "appSecret", created.get("appSecret").asText(), "tenantId", tenant))));
        org.mockito.Mockito.clearInvocations(profiles);
        JsonNode page = send(get("/admin-api/applications").param("query", name));
        assertThat(page.at("/items/0/tenantNames").get(tenant).asText()).isEqualTo("展示租户");
        assertThat(page.at("/items/0/tenantNames").size()).isEqualTo(1);
        org.mockito.Mockito.verify(profiles, org.mockito.Mockito.times(1)).tenantNames(org.mockito.ArgumentMatchers.anyCollection());
        String id = created.at("/application/id").asText();
        assertThat(send(get("/admin-api/applications/" + id + "/tenant-grants")).at("/items/0/tenantName").asText()).isEqualTo("展示租户");
    }

    @Test
    void personnelPreviewRevalidatesIdentityAndVersionWithoutCrossTenantTrust() throws Exception {
        JsonNode created = send(post("/admin-api/applications").content("{\"name\":\"personnel80\",\"ownerTenantId\":\"101\"}"));
        String appId = created.at("/application/id").asText();
        JsonNode tenant = send(post("/admin-api/tenant-grants").content(json.writeValueAsString(java.util.Map.of(
                "appKey", created.at("/application/appKey").asText(), "appSecret", created.get("appSecret").asText(), "tenantId", "101"))));
        String base = "/admin-api/tenant-grants/" + tenant.get("id").asText();
        io.github.chenyilei2016.openplatform.testing.TestEmployee employee = new io.github.chenyilei2016.openplatform.testing.TestEmployee();
        employee.setId(9007199254740993L); employee.setUserId(9007199254740995L);
        employee.setTenantId(101L); employee.setEmployeeNoStr("A001"); employee.setName("Verified employee");
        employee.setEnabled(true); employee.setEmployeeStatus(4);
        when(employeeFacade.find(org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.anyString())).thenAnswer(invocation -> employee.toIdentity());
        JsonNode preview = send(post(base + "/employee-lookup").content("{\"employeeNo\":\"A001\"}"));
        assertThat(preview.get("employeeId").asText()).isEqualTo("9007199254740993");
        assertThat(send(get(base + "/users")).get("total").asInt()).isZero();
        String confirmed = json.writeValueAsString(java.util.Map.of("employeeNo", "A001",
                "expectedUserId", preview.get("userId").asText(), "expectedEmployeeId", preview.get("employeeId").asText()));
        employee.setId(9007199254740997L);
        mvc.perform(auth(post(base + "/users").content(confirmed))).andExpect(status().isConflict());
        assertThat(send(get(base + "/users")).get("total").asInt()).isZero();
        employee.setId(9007199254740993L); employee.setTenantId(102L);
        mvc.perform(auth(post(base + "/employee-lookup").content("{\"employeeNo\":\"A001\"}"))).andExpect(status().isForbidden());
        mvc.perform(auth(post(base + "/users").content(confirmed))).andExpect(status().isForbidden());
        employee.setTenantId(101L);
        JsonNode person = send(post(base + "/users").content(confirmed));
        JsonNode repeated = send(post(base + "/users").content(confirmed));
        assertThat(repeated.get("authorizationVersion")).isEqualTo(person.get("authorizationVersion"));
        String revoke = "/admin-api/user-grants/" + person.get("id").asText();
        mvc.perform(auth(delete(revoke).param("expectedVersion", "99"))).andExpect(status().isConflict());
        send(delete(revoke).param("expectedVersion", person.get("authorizationVersion").asText()));
        assertThat(send(get(base + "/users")).at("/items/0/status").asText()).isEqualTo("REVOKED");
        employee.setId(9007199254740997L);
        mvc.perform(auth(post(base + "/users").content("{\"employeeNo\":\"A001\"}")))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.resultMsg").value(org.hamcrest.Matchers.containsString("历史委托")));
        JsonNode logs = send(get("/admin-api/applications/" + appId + "/audit"));
        assertThat(logs.toString()).contains("GRANT_USER", "REVOKE_USER", "operator-1", "9007199254740993", "9007199254740995");
        send(put("/admin-api/applications/" + appId + "/status").content("{\"enabled\":false}"));
        mvc.perform(auth(post(base + "/employee-lookup").content("{\"employeeNo\":\"A001\"}"))).andExpect(status().isConflict());
    }

    private JsonNode send(MockHttpServletRequestBuilder request) throws Exception {
        String response = mvc.perform(auth(request)).andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(200)).andReturn().getResponse().getContentAsString();
        return json.readTree(response).get("data");
    }

    private MockHttpServletRequestBuilder auth(MockHttpServletRequestBuilder request) {
        return request.session(io.github.chenyilei2016.openplatform.testing.TestSessions.session("test-session"))
                .header("X-CSRF-Token", "76832d7fdbcdbf4a72129f8b7def9016")
                .contentType("application/json");
    }
}
