package io.github.chenyilei2016.openplatform.access;

import io.github.chenyilei2016.openplatform.application.access.TenantScopeAccessService;

import io.github.chenyilei2016.openplatform.application.identity.AccountAuthentication;
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

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** 118：公共通用权限组与租户权限决定租户可用权限组；不改变凭据授权版本。 */
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
class TenantScopeAccessHttpTest {
    @Autowired MockMvc mvc;
    @Autowired TenantScopeAccessService access;
    @Autowired JdbcTemplate jdbc;
    @MockitoBean AccountAuthentication identityService;
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
    void publicAccessTakesEffectImmediatelyForAllTenantsWithoutTouchingCredentialVersions() throws Exception {
        String code = "public-" + UUID.randomUUID();
        JsonNode scope = createScope(code, false);
        assertThat(scope.get("publicAccess").asBoolean()).isFalse();
        String scopePath = "/admin-api/scopes/" + scope.get("id").asText();
        JsonNode app = send(post("/admin-api/applications").content(json.writeValueAsString(Map.of(
                "name", "公共通用不影响凭据", "ownerTenantId", "100", "scopeCodes", List.of(code)))));
        String appPath = "/admin-api/applications/" + app.at("/application/id").asText();
        long version = send(get(appPath)).get("authorizationVersion").asLong();
        assertThat(access.availableScopeCodes("tenant-a", List.of(code))).doesNotContain(code);

        JsonNode opened = send(put(scopePath).content("{\"name\":\"公共\",\"enabled\":true,\"defaultForNewApplication\":false,\"publicAccess\":true}"));
        assertThat(opened.get("publicAccess").asBoolean()).isTrue();
        assertThat(access.availableScopeCodes("tenant-a", List.of(code))).contains(code);
        assertThat(access.availableScopeCodes("tenant-b", List.of(code))).contains(code);
        assertThat(access.availableScopeCodes(null, List.of(code))).contains(code);
        // 只提交旧字段的调用方不会把公共通用改回关闭。
        assertThat(send(put(scopePath).content("{\"name\":\"公共\",\"enabled\":true,\"defaultForNewApplication\":false}"))
                .get("publicAccess").asBoolean()).isTrue();
        assertThat(send(get(appPath)).get("authorizationVersion").asLong()).isEqualTo(version);

        send(put(scopePath).content("{\"name\":\"公共\",\"enabled\":false,\"defaultForNewApplication\":false,\"publicAccess\":true}"));
        assertThat(access.availableScopeCodes("tenant-a", List.of(code))).doesNotContain(code);
        send(put(scopePath).content("{\"name\":\"公共\",\"enabled\":true,\"defaultForNewApplication\":false,\"publicAccess\":false}"));
        assertThat(access.availableScopeCodes("tenant-a", List.of(code))).doesNotContain(code);
        assertThat(send(get(scopePath)).get("publicAccess").asBoolean()).isFalse();

        String createdPublic = "public-new-" + UUID.randomUUID();
        assertThat(createScope(createdPublic, true).get("publicAccess").asBoolean()).isTrue();
        assertThat(access.availableScopeCodes("tenant-a", List.of(createdPublic))).contains(createdPublic);
    }

    @Test
    void tenantGrantsAreExclusiveConflictOnDuplicateAndRevokeKeepsTheRecord() throws Exception {
        String code = "exclusive-" + UUID.randomUUID();
        String tenant = "tenant-" + UUID.randomUUID();
        JsonNode scope = createScope(code, false);
        String scopePath = "/admin-api/scopes/" + scope.get("id").asText();
        String grants = scopePath + "/tenant-grants";

        JsonNode granted = send(post(grants).content(json.writeValueAsString(Map.of("tenantId", " " + tenant + " "))));
        assertThat(granted.get("tenantId").asText()).isEqualTo(tenant);
        assertThat(granted.get("status").asText()).isEqualTo("ACTIVE");
        assertThat(granted.get("grantedByEmployeeNo").asText()).isEqualTo("operator-1");
        assertThat(access.availableScopeCodes(tenant, List.of(code))).contains(code);
        assertThat(access.availableScopeCodes("other-" + tenant, List.of(code))).doesNotContain(code);
        assertThat(access.availableScopeCodes(null, List.of(code))).doesNotContain(code);
        mvc.perform(auth(post(grants).content(json.writeValueAsString(Map.of("tenantId", tenant)))))
                .andExpect(status().isConflict());

        send(put(scopePath).content("{\"name\":\"专属\",\"enabled\":false,\"defaultForNewApplication\":false}"));
        assertThat(access.availableScopeCodes(tenant, List.of(code))).doesNotContain(code);
        send(put(scopePath).content("{\"name\":\"专属\",\"enabled\":true,\"defaultForNewApplication\":false}"));
        assertThat(access.availableScopeCodes(tenant, List.of(code))).contains(code);

        String grantPath = grants + "/" + granted.get("id").asText();
        assertThat(send(delete(grantPath)).get("status").asText()).isEqualTo("REVOKED");
        assertThat(access.availableScopeCodes(tenant, List.of(code))).doesNotContain(code);
        assertThat(send(delete(grantPath)).get("status").asText()).isEqualTo("REVOKED");
        JsonNode listed = send(get(grants).param("tenantId", tenant));
        assertThat(listed.get("total").asLong()).isEqualTo(1);
        assertThat(listed.at("/items/0/status").asText()).isEqualTo("REVOKED");

        JsonNode reopened = send(post(grants).content(json.writeValueAsString(Map.of("tenantId", tenant))));
        assertThat(reopened.get("id").asText()).isEqualTo(granted.get("id").asText());
        assertThat(reopened.get("revision").asLong()).isEqualTo(2);
        assertThat(access.availableScopeCodes(tenant, List.of(code))).contains(code);

        JsonNode otherScope = createScope("other-" + UUID.randomUUID(), false);
        mvc.perform(auth(delete("/admin-api/scopes/" + otherScope.get("id").asText() + "/tenant-grants/" + granted.get("id").asText())))
                .andExpect(status().isNotFound());
        assertThat(jdbc.queryForList("SELECT action FROM access_audit WHERE target_id=? AND target_tenant_id=? AND outcome='SUCCESS' ORDER BY occurred_at,id",
                String.class, scope.get("id").asText(), tenant))
                .containsExactly("GRANT_TENANT_SCOPE", "REVOKE_TENANT_SCOPE", "REVOKE_TENANT_SCOPE", "GRANT_TENANT_SCOPE");
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM access_audit WHERE target_id=? AND action='GRANT_TENANT_SCOPE' AND outcome='FAILURE'",
                Long.class, scope.get("id").asText())).isEqualTo(1);
    }

    @Test
    void tenantGrantsRequireApplicationManagementPermission() throws Exception {
        JsonNode scope = createScope("guarded-" + UUID.randomUUID(), false);
        String grants = "/admin-api/scopes/" + scope.get("id").asText() + "/tenant-grants";
        var viewer = new TestAccount();
        viewer.setId(7L); viewer.setTenantId("tenant-2"); viewer.setEmployeeNoStr("viewer");
        when(identityService.current("test-session")).thenAnswer(invocation -> viewer.toAccount());
        mvc.perform(auth(get(grants))).andExpect(status().isForbidden());
        mvc.perform(auth(get("/admin-api/tenant-permissions"))).andExpect(status().isForbidden());
        mvc.perform(auth(get("/admin-api/tenant-permissions/t1/scopes"))).andExpect(status().isForbidden());
        mvc.perform(auth(post(grants).content("{\"tenantId\":\"t1\"}"))).andExpect(status().isForbidden());
    }

    @Test
    void tenantPerspectiveAndScopeCountsKeepDirectGrantsSeparateFromPublicAccess() throws Exception {
        String code = "perspective-" + UUID.randomUUID();
        String tenant = "tenant-" + UUID.randomUUID();
        JsonNode scope = createScope(code, false);
        String scopePath = "/admin-api/scopes/" + scope.get("id").asText();
        JsonNode grant = send(post(scopePath + "/tenant-grants").content(json.writeValueAsString(Map.of("tenantId", tenant))));
        send(post(scopePath + "/tenant-grants").content(json.writeValueAsString(Map.of("tenantId", "other-" + tenant))));
        assertThat(send(get(scopePath)).get("tenantCount").asLong()).isEqualTo(2);
        assertThat(send(get("/admin-api/scopes").param("code", code)).at("/items/0/tenantCount").asLong()).isEqualTo(2);
        JsonNode tenants = send(get("/admin-api/tenant-permissions").param("query", tenant));
        assertThat(tenants.get("total").asLong()).isEqualTo(1);
        assertThat(tenants.at("/items/0/tenantId").asText()).isEqualTo(tenant);
        assertThat(tenants.at("/items/0/grantedScopeCount").asLong()).isEqualTo(1);
        String permissions = "/admin-api/tenant-permissions/" + tenant + "/scopes";
        JsonNode direct = send(get(permissions).param("filter", "DIRECT").param("query", code));
        assertThat(direct.at("/items/0/available").asBoolean()).isTrue();
        assertThat(direct.at("/items/0/grantId").asText()).isEqualTo(grant.get("id").asText());

        String publicCode = "everyone-" + UUID.randomUUID();
        JsonNode common = createScope(publicCode, true);
        JsonNode publicGroup = send(get(permissions).param("filter", "PUBLIC").param("query", publicCode)).at("/items/0");
        assertThat(publicGroup.get("available").asBoolean()).isTrue();
        assertThat(publicGroup.get("grantId").isNull()).isTrue();
        assertThat(send(get("/admin-api/scopes/" + common.get("id").asText())).get("tenantCount").asLong()).isZero();
        send(delete(scopePath + "/tenant-grants/" + grant.get("id").asText()));
        JsonNode revoked = send(get(permissions).param("filter", "UNGRANTED").param("query", code)).at("/items/0");
        assertThat(revoked.get("available").asBoolean()).isFalse();
        assertThat(revoked.get("grantStatus").asText()).isEqualTo("REVOKED");
        assertThat(send(get(scopePath)).get("tenantCount").asLong()).isEqualTo(1);
        assertThat(send(get("/admin-api/tenant-permissions").param("query", tenant)).at("/items/0/grantedScopeCount").asLong()).isZero();
    }

    private JsonNode createScope(String code, boolean publicAccess) throws Exception {
        return send(post("/admin-api/scopes").content(json.writeValueAsString(Map.of(
                "code", code, "name", "租户权限", "enabled", true, "defaultForNewApplication", false, "publicAccess", publicAccess))));
    }

    private JsonNode send(MockHttpServletRequestBuilder request) throws Exception {
        String response = mvc.perform(auth(request)).andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return json.readTree(response).get("data");
    }

    private MockHttpServletRequestBuilder auth(MockHttpServletRequestBuilder request) {
        return request.session(io.github.chenyilei2016.openplatform.testing.TestSessions.session("test-session"))
                .header("X-CSRF-Token", "76832d7fdbcdbf4a72129f8b7def9016")
                .contentType("application/json");
    }
}
