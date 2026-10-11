package io.github.chenyilei2016.openplatform.debug;

import io.github.chenyilei2016.openplatform.domain.access.ApplicationKind;
import io.github.chenyilei2016.openplatform.domain.access.ApplicationRepository;
import io.github.chenyilei2016.openplatform.domain.access.ApplicationStatus;
import io.github.chenyilei2016.openplatform.domain.access.ClientApplication;
import io.github.chenyilei2016.openplatform.domain.access.EmployeeDirectory;
import io.github.chenyilei2016.openplatform.domain.access.EmployeeIdentity;
import io.github.chenyilei2016.openplatform.domain.access.EmployeeStatus;
import io.github.chenyilei2016.openplatform.domain.access.GrantStatus;
import io.github.chenyilei2016.openplatform.domain.access.TenantGrant;
import io.github.chenyilei2016.openplatform.domain.access.TenantGrantRepository;
import io.github.chenyilei2016.openplatform.domain.access.UserGrant;
import io.github.chenyilei2016.openplatform.domain.access.UserGrantRepository;
import io.github.chenyilei2016.openplatform.domain.common.ObjectIdType;

import io.github.chenyilei2016.openplatform.application.identity.AccountAuthentication;
import io.github.chenyilei2016.openplatform.testing.TestAccount;
import jakarta.servlet.http.Cookie;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
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

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** 112：草稿调试以所选凭据当前授权代换身份，不签发 Token，并写入管理审计。 */
@io.github.chenyilei2016.openplatform.testing.TestAdministrators
@SpringBootTest(properties = {
        "spring.sql.init.schema-locations=classpath:db/access-schema.sql,classpath:db/mcp-schema.sql,classpath:db/catalog-schema.sql,classpath:db/dubbo-connection-schema.sql,classpath:db/token-schema.sql,classpath:db/publication-schema.sql,classpath:db/governance-schema.sql,classpath:db/observability-schema.sql,classpath:db/operations-metrics-schema.sql",

        "test.admin.operators[0].tenant-id=tenant-1",
        "test.admin.operators[0].employee-no=author",
        "test.admin.operators[0].permissions[0]=MANAGE_APIS"
})
@AutoConfigureMockMvc(print = MockMvcPrint.NONE)
@org.springframework.context.annotation.Import(io.github.chenyilei2016.openplatform.testing.CatalogReferenceFixture.class)
class DebugIdentityHttpTest {
    private static final String CSRF = "76832d7fdbcdbf4a72129f8b7def9016";
    @Autowired MockMvc mvc;
    @Autowired JsonMapper json;
    @Autowired JdbcTemplate jdbc;
    @Autowired ApplicationRepository applications;
    @Autowired TenantGrantRepository tenants;
    @Autowired UserGrantRepository users;
    @MockitoBean AccountAuthentication identityService;
    @MockitoBean EmployeeDirectory employees;
    @MockitoBean io.github.chenyilei2016.openplatform.application.token.TokenVerifier tokens;
    @MockitoBean io.github.chenyilei2016.openplatform.domain.access.ScopeRepository scopes;
    @MockitoBean io.github.chenyilei2016.openplatform.domain.governance.GovernanceGuard governance;
    @MockitoBean io.github.chenyilei2016.openplatform.application.observability.ObservationService observations;
    @MockitoBean io.github.chenyilei2016.openplatform.domain.runtime.HttpApiInvoker http;
    @MockitoBean io.github.chenyilei2016.openplatform.domain.runtime.DubboApiInvoker dubbo;

    @BeforeEach
    void login() {
        TestAccount user = new TestAccount();
        user.setId(11L); user.setTenantId("tenant-1"); user.setEmployeeNoStr("author");
        when(identityService.current("test-session")).thenAnswer(invocation -> user.toAccount());
        when(scopes.allEnabled(anyList())).thenReturn(true);
        when(scopes.enabledCodes(anyList())).thenAnswer(invocation -> List.copyOf(invocation.<List<String>>getArgument(0)));
        for (String code : List.of("orders", "other"))
            jdbc.update("INSERT INTO access_scope (id,code,name,enabled,default_for_new_application) SELECT ?,?,?,TRUE,FALSE WHERE NOT EXISTS (SELECT 1 FROM access_scope WHERE code=?)",
                    "SCP_" + code, code, code, code);
        when(governance.evaluate(any())).thenReturn(new io.github.chenyilei2016.openplatform.domain.governance.GovernanceDecision(true,
                io.github.chenyilei2016.openplatform.domain.governance.GovernanceDecision.Reason.NONE, 0, List.of()));
    }

    @Test
    void candidatesListOnlyEnabledCredentialsWithActiveGrantsAndApiScopes() throws Exception {
        String api = api(false);
        String tag = UUID.randomUUID().toString().substring(0, 8);
        Grant callable = grant("调试凭据" + tag, List.of("orders"), "tenant-202", "联调租户");
        grant("无权限凭据" + tag, List.of("other"), "tenant-202", null);
        Grant disabled = grant("停用凭据" + tag, List.of("orders"), "tenant-202", null);
        applications.changeStatus(disabled.applicationId(), ApplicationStatus.DISABLED);
        Grant revoked = grant("撤销授权" + tag, List.of("orders"), "tenant-203", null);
        tenants.revoke(revoked.tenantGrantId());
        JsonNode page = data(mvc.perform(get("/admin-api/apis/" + api + "/debug/identities").param("query", tag)
                .session(session())).andExpect(status().isOk()));
        assertThat(page.path("total").asLong()).isEqualTo(1);
        JsonNode item = page.at("/items/0");
        assertThat(item.path("tenantGrantId").asText()).isEqualTo(callable.tenantGrantId());
        assertThat(item.path("applicationName").asText()).isEqualTo("调试凭据" + tag);
        assertThat(item.path("tenantId").asText()).isEqualTo("tenant-202");
        assertThat(item.path("note").asText()).isEqualTo("联调租户");
        assertThat(item.path("appKeyTail").asText()).hasSize(4);
        assertThat(page.toString()).doesNotContain(callable.appKey());
    }

    @Test
    void credentialIdentityRunsLikeTokenAndIsAudited() throws Exception {
        String api = api(false);
        Grant grant = grant("调试凭据", List.of("orders"), "tenant-202", null);
        JsonNode preflight = data(mvc.perform(debug(api, true, identity(grant.tenantGrantId(), null))).andExpect(status().isOk()));
        assertThat(preflight.path("outcome").asText()).isEqualTo("SUCCEEDED");
        assertThat(preflight.at("/mappedInput/value/body/tenantId").asText()).isEqualTo("tenant-202");
        assertThat(preflight.at("/identity/applicationId").asText()).isEqualTo(grant.applicationId());
        assertThat(preflight.at("/identity/tokenId").isNull()).isTrue();
        assertThat(audits(grant.applicationId())).isZero();

        when(http.invoke(any(), any(), any(), anyString())).thenReturn(java.util.Map.of("code", 0, "data", java.util.Map.of("count", 7)));
        JsonNode executed = data(mvc.perform(debug(api, false, identity(grant.tenantGrantId(), null))).andExpect(status().isOk()));
        assertThat(executed.path("outcome").asText()).isEqualTo("SUCCEEDED");
        assertThat(executed.at("/identity/tenantId").asText()).isEqualTo("tenant-202");
        assertThat(executed.at("/identity/scopeCodes/0").asText()).isEqualTo("orders");
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM token_audit WHERE action='DEBUG_AS_APP' AND outcome='SUCCESS' AND application_id=? AND tenant_id='tenant-202' AND operator_employee_no='author' AND actor_kind='ADMIN'",
                Long.class, grant.applicationId())).isEqualTo(1L);
        verifyNoInteractions(tokens);
    }

    @Test
    void credentialIdentityRejectsDisabledUnauthorizedMissingEmployeeAndMixedToken() throws Exception {
        String api = api(false);
        Grant other = grant("无权限", List.of("other"), "tenant-202", null);
        mvc.perform(debug(api, false, identity(other.tenantGrantId(), null))).andExpect(status().isForbidden());
        Grant disabled = grant("停用", List.of("orders"), "tenant-202", null);
        applications.changeStatus(disabled.applicationId(), ApplicationStatus.DISABLED);
        mvc.perform(debug(api, false, identity(disabled.tenantGrantId(), null))).andExpect(status().isForbidden());
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM token_audit WHERE action='DEBUG_AS_APP' AND outcome='FAILURE' AND application_id=?",
                Long.class, disabled.applicationId())).isEqualTo(1L);

        String employeeApi = api(true);
        Grant grant = grant("员工凭据", List.of("orders"), "tenant-202", null);
        mvc.perform(debug(employeeApi, false, identity(grant.tenantGrantId(), null))).andExpect(status().isForbidden());
        String userGrant = ObjectIdType.USER_GRANT.nextId();
        users.create(new UserGrant(userGrant, grant.tenantGrantId(), "tenant-202", "user-7", "emp-7", "E007", "调试员工", GrantStatus.ACTIVE, 0));
        when(employees.find("tenant-202", "E007")).thenReturn(new EmployeeIdentity("tenant-202", "user-7", "emp-7", "E007", "调试员工", true, EmployeeStatus.PERMANENT));
        JsonNode people = data(mvc.perform(get("/admin-api/apis/" + employeeApi + "/debug/identities/" + grant.tenantGrantId() + "/employees")
                .param("query", "调试").session(session())).andExpect(status().isOk()));
        assertThat(people.at("/items/0/userGrantId").asText()).isEqualTo(userGrant);
        assertThat(people.at("/items/0/employeeNo").asText()).isEqualTo("E007");
        JsonNode withEmployee = data(mvc.perform(debug(employeeApi, true, identity(grant.tenantGrantId(), userGrant))).andExpect(status().isOk()));
        assertThat(withEmployee.at("/identity/employeeNo").asText()).isEqualTo("E007");
        Grant elsewhere = grant("别家", List.of("orders"), "tenant-204", null);
        mvc.perform(debug(employeeApi, true, identity(elsewhere.tenantGrantId(), userGrant))).andExpect(status().isForbidden());

        mvc.perform(debug(api, false, identity(grant.tenantGrantId(), null)).header("Authorization", "Bearer valid-token"))
                .andExpect(status().isBadRequest());
        mvc.perform(debug(api, false, "{\"tenantGrantId\":\"" + grant.tenantGrantId() + "\",\"tenantId\":\"x\"}"))
                .andExpect(status().isBadRequest());
        verifyNoInteractions(tokens);
    }

    private record Grant(String applicationId, String appKey, String tenantGrantId) {}
    private enum AuthorizationChange { USER_REVOKED, TENANT_REVOKED, APP_DISABLED, SCOPES_CHANGED }

    @ParameterizedTest
    @EnumSource(AuthorizationChange.class)
    void rejectsAuthorizationChangedDuringEmployeeLookup(AuthorizationChange change) throws Exception {
        String api = api(true);
        Grant grant = grant("核验期间变更", List.of("orders"), "tenant-202", null);
        String userGrant = ObjectIdType.USER_GRANT.nextId();
        users.create(new UserGrant(userGrant, grant.tenantGrantId(), "tenant-202", "user-7", "emp-7", "E007", "调试员工", GrantStatus.ACTIVE, 0));
        when(employees.find("tenant-202", "E007")).thenAnswer(invocation -> {
            switch (change) {
                case USER_REVOKED -> users.revoke(userGrant);
                case TENANT_REVOKED -> tenants.revoke(grant.tenantGrantId());
                case APP_DISABLED -> applications.changeStatus(grant.applicationId(), ApplicationStatus.DISABLED);
                case SCOPES_CHANGED -> applications.replaceScopes(grant.applicationId(), List.of());
            }
            return new EmployeeIdentity("tenant-202", "user-7", "emp-7", "E007", "调试员工", true, EmployeeStatus.PERMANENT);
        });
        when(http.invoke(any(), any(), any(), anyString())).thenReturn(java.util.Map.of("code", 0, "data", java.util.Map.of("count", 7)));
        mvc.perform(debug(api, false, identity(grant.tenantGrantId(), userGrant))).andExpect(status().isForbidden());
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM token_audit WHERE action='DEBUG_AS_APP' AND outcome='SUCCESS' AND application_id=?",
                Long.class, grant.applicationId())).isZero();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM token_audit WHERE action='DEBUG_AS_APP' AND outcome='FAILURE' AND application_id=?",
                Long.class, grant.applicationId())).isEqualTo(1L);
        verifyNoInteractions(http, dubbo);
    }

    private Grant grant(String name, List<String> scopeCodes, String tenantId, String note) {
        String app = ObjectIdType.APPLICATION.nextId();
        String key = "ak" + UUID.randomUUID().toString().replace("-", "").substring(0, 20);
        applications.create(new ClientApplication(app, key, name, "tenant-1", ApplicationStatus.ENABLED, 0, scopeCodes, ApplicationKind.STANDARD), "digest");
        String grant = ObjectIdType.TENANT_GRANT.nextId();
        tenants.create(new TenantGrant(grant, app, tenantId, GrantStatus.ACTIVE, 0, note, 0));
        return new Grant(app, key, grant);
    }
    private long audits(String applicationId) {
        return jdbc.queryForObject("SELECT COUNT(*) FROM token_audit WHERE application_id=?", Long.class, applicationId);
    }
    private String api(boolean employeeRequired) throws Exception {
        String body = """
                {"service":"debugid_%s","version":"v1","method":"query","name":"调试身份","category":"测试","owner":"测试",
                 "scopeCodes":["orders"],"employeeRequired":%s,
                 "requestSchema":{"type":"OBJECT","properties":{"count":{"type":"INTEGER","required":true}}},
                 "responseSchema":{"type":"OBJECT","properties":{"count":{"type":"INTEGER","required":true}}},
                 "responseAdapter":{"mode":"ENVELOPE","successPath":"code","successValues":[0],"dataPath":"data"},
                 "errorDefinitions":[],"binding":{"protocol":"HTTP","timeoutMillis":2000,"http":{"url":"http://provider.invalid/query","method":"POST"}},
                 "mappings":[{"target":"count","source":"REQUEST","path":"count"},{"target":"tenantId","source":"CONTEXT","path":"tenantId"}]}
                """.formatted(UUID.randomUUID().toString().replace("-", ""), employeeRequired);
        return data(mvc.perform(post("/admin-api/apis").session(session()).header("X-CSRF-Token", CSRF)
                .contentType("application/json").content(body)).andExpect(status().isOk())).path("id").asText();
    }
    private static String identity(String tenantGrantId, String userGrantId) {
        return "{\"tenantGrantId\":\"" + tenantGrantId + "\"" + (userGrantId == null ? "" : ",\"userGrantId\":\"" + userGrantId + "\"") + "}";
    }
    private MockHttpServletRequestBuilder debug(String api, boolean preflight, String identity) {
        return post("/admin-api/apis/" + api + "/debug" + (preflight ? "/preflight" : "")).session(session()).header("X-CSRF-Token", CSRF)
                .contentType("application/json").content("{\"expectedRevision\":1,\"input\":{\"count\":7},\"identity\":" + identity + "}");
    }
    private static org.springframework.mock.web.MockHttpSession session() { return io.github.chenyilei2016.openplatform.testing.TestSessions.session("test-session"); }
    private JsonNode data(org.springframework.test.web.servlet.ResultActions result) throws Exception {
        return json.readTree(result.andReturn().getResponse().getContentAsString()).get("data");
    }
}
