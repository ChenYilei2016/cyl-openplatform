package io.github.chenyilei2016.openplatform.token;


import io.github.chenyilei2016.openplatform.application.identity.AccountAuthentication;
import io.github.chenyilei2016.openplatform.testing.TestAccount;
import io.github.chenyilei2016.openplatform.domain.access.EmployeeDirectory;
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

import java.util.Map;
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

        "spring.sql.init.schema-locations=classpath:db/access-schema.sql,classpath:db/mcp-schema.sql,classpath:db/catalog-schema.sql,classpath:db/dubbo-connection-schema.sql,classpath:db/token-schema.sql,classpath:db/publication-schema.sql,classpath:db/governance-schema.sql,classpath:db/observability-schema.sql,classpath:db/operations-metrics-schema.sql"
})
@AutoConfigureMockMvc(print = MockMvcPrint.NONE)
class TokenLifecycleHttpTest {
    @Autowired MockMvc mvc;
    @Autowired io.github.chenyilei2016.openplatform.infrastructure.properties.token.TokenProperties tokenProperties;
    @MockitoBean AccountAuthentication identityService;
    @MockitoBean EmployeeDirectory employeeFacade;
    @org.springframework.test.context.bean.override.mockito.MockitoSpyBean javax.sql.DataSource dataSource;
    @org.springframework.test.context.bean.override.mockito.MockitoSpyBean java.time.Clock tokenClock;
    private final JsonMapper json = JsonMapper.builder().build();

    @BeforeEach
    void login() {
        TestAccount user = new TestAccount();
        user.setId(9007199254740993L); user.setTenantId("tenant-1"); user.setEmployeeNoStr("operator-1");
        when(identityService.current("test-session")).thenAnswer(invocation -> user.toAccount());
    }

    @Test
    void updatedTtlAppliesToNewAndRefreshedTokensWithoutChangingExistingExpiry() throws Exception {
        JsonNode app = application();
        java.time.Duration original = tokenProperties.ttl();
        java.time.Instant now = java.time.Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MILLIS);
        org.mockito.Mockito.doReturn(now).when(tokenClock).instant();
        try {
            tokenProperties.setTtl(java.time.Duration.ofDays(2));
            JsonNode first = send(post("/api/token").content(issueBody(app, "101")));
            assertThat(first.get("expiresAt").asText()).isEqualTo(now.plus(java.time.Duration.ofDays(2)).toString());
            tokenProperties.setTtl(java.time.Duration.ofDays(3));
            JsonNode second = send(post("/api/token").content(issueBody(app, "101")));
            assertThat(second.get("expiresAt").asText()).isEqualTo(now.plus(java.time.Duration.ofDays(3)).toString());
            JsonNode reused = send(post("/api/token").content(json.writeValueAsString(Map.of(
                    "appKey", app.at("/application/appKey").asText(), "appSecret", app.get("appSecret").asText(),
                    "tenantId", "101", "existingToken", first.get("accessToken").asText()))));
            assertThat(reused.get("expiresAt").asText()).isEqualTo(first.get("expiresAt").asText());
            JsonNode refreshed = send(post("/api/token/refresh").header("Authorization", "Bearer " + first.get("accessToken").asText())
                    .content(credentials(app)));
            assertThat(refreshed.get("expiresAt").asText()).isEqualTo(now.plus(java.time.Duration.ofDays(3)).toString());
        } finally {
            tokenProperties.setTtl(original);
            org.mockito.Mockito.doCallRealMethod().when(tokenClock).instant();
        }
    }

    @Test
    void tokenFiltersApplyEffectiveStateBeforePagingAndKeepSubjectsSeparate() throws Exception {
        JsonNode app = application();
        String appId = app.at("/application/id").asText();
        String path = "/admin-api/applications/" + appId + "/tokens";
        java.time.Instant now = java.time.Instant.now();
        try {
            org.mockito.Mockito.doReturn(now.minus(java.time.Duration.ofDays(8))).when(tokenClock).instant();
            send(post("/api/token").content(issueBody(app, "101")));
            org.mockito.Mockito.doReturn(now).when(tokenClock).instant();
            JsonNode revoked = send(post("/api/token").content(issueBody(app, "101")));
            send(admin(delete("/admin-api/tokens/" + revoked.at("/context/tokenId").asText())));
            send(post("/api/token").content(issueBody(app, "101")));
            send(admin(put("/admin-api/applications/" + appId + "/status").content("{\"enabled\":false}")));
            send(admin(put("/admin-api/applications/" + appId + "/status").content("{\"enabled\":true}")));
            send(post("/api/token").content(issueBody(app, "101")));
            grantEmployee(app);
            JsonNode user = send(post("/api/token").content(json.writeValueAsString(Map.of(
                    "appKey", app.at("/application/appKey").asText(), "appSecret", app.get("appSecret").asText(),
                    "tenantId", "101", "employeeNo", "E001"))));
            for (String state : java.util.List.of("REVOKED", "EXPIRED", "INVALIDATED")) {
                JsonNode page = send(admin(get(path).param("status", state).param("pageSize", "1")));
                assertThat(page.get("total").asLong()).isEqualTo(1);
                assertThat(page.at("/items/0/status").asText()).isEqualTo(state);
            }
            JsonNode active = send(admin(get(path).param("status", "ACTIVE").param("pageSize", "1")));
            assertThat(active.get("total").asLong()).isEqualTo(2);
            assertThat(send(admin(get(path).param("status", "ACTIVE").param("page", "2").param("pageSize", "1")))
                    .at("/items/0/tokenId").asText()).isNotEqualTo(active.at("/items/0/tokenId").asText());
            JsonNode exact = send(admin(get(path).param("tokenId", user.at("/context/tokenId").asText())
                    .param("tenantId", "101").param("employeeNo", "E001").param("subjectType", "USER").param("status", "ACTIVE", "EXPIRED")));
            assertThat(exact.get("total").asLong()).isEqualTo(1);
            assertThat(exact.toString()).doesNotContain(user.get("accessToken").asText(), "tokenDigest");
            assertThat(send(admin(get(path).param("employeeNo", "E001").param("subjectType", "APPLICATION"))).get("total").asLong()).isZero();
            assertThat(send(admin(get(path).param("subjectType", "APPLICATION", "USER"))).get("total").asLong()).isEqualTo(5);
            assertThat(send(admin(get(path).param("tenantId", "different"))).get("total").asLong()).isZero();
            mvc.perform(admin(get(path).param("status", "UNKNOWN"))).andExpect(status().isBadRequest());
            mvc.perform(admin(get(path).param("employeeNo", " "))).andExpect(status().isBadRequest());
        } finally { org.mockito.Mockito.doCallRealMethod().when(tokenClock).instant(); }
    }

    @Test
    void applicationCanIssueAndInspectAnOpaqueTokenWithoutAdminLogin() throws Exception {
        JsonNode app = application();
        JsonNode response = send(post("/api/token").content(issueBody(app, "101")));
        assertThat(response.get("accessToken").asText()).matches("[A-Za-z0-9_-]{43}");
        assertThat(response.get("tokenType").asText()).isEqualTo("Bearer");
        assertThat(response.get("expiresIn").asLong()).isBetween(604795L, 604800L);
        assertThat(response.at("/context/tenantId").asText()).isEqualTo("101");
        assertThat(response.at("/context/applicationId").asText()).isEqualTo(app.at("/application/id").asText());
        JsonNode context = send(post("/api/token/introspect").header("Authorization", "Bearer " + response.get("accessToken").asText()));
        assertThat(context.get("tokenId").asText()).isEqualTo(response.at("/context/tokenId").asText());
        assertThat(context.toString()).doesNotContain("digest", "invocationContext", response.get("accessToken").asText());
    }

    @Test
    void reuseDoesNotExtendExpiryAndRefreshImmediatelyRevokesTheOriginalToken() throws Exception {
        JsonNode app = application();
        JsonNode first = send(post("/api/token").content(issueBody(app, "101")));
        String raw = first.get("accessToken").asText();
        JsonNode reused = send(post("/api/token").content(json.writeValueAsString(Map.of(
                "appKey", app.at("/application/appKey").asText(), "appSecret", app.get("appSecret").asText(), "tenantId", "101", "existingToken", raw))));
        assertThat(reused.get("accessToken").asText()).isEqualTo(raw);
        assertThat(reused.get("expiresAt").asText()).isEqualTo(first.get("expiresAt").asText());
        assertThat(reused.get("expiresIn").asLong()).isLessThanOrEqualTo(first.get("expiresIn").asLong());
        JsonNode next = send(post("/api/token/refresh").header("Authorization", "Bearer " + raw).content(credentials(app)));
        assertThat(next.get("accessToken").asText()).isNotEqualTo(raw);
        assertThat(next.at("/context/tenantId").asText()).isEqualTo("101");
        assertThat(next.at("/context/scopeCodes")).isEqualTo(first.at("/context/scopeCodes"));
        mvc.perform(post("/api/token/introspect").header("Authorization", "Bearer " + raw))
                .andExpect(status().isUnauthorized()).andExpect(jsonPath("$.code").value(40100003));
        mvc.perform(post("/api/token").contentType("application/json").content(json.writeValueAsString(Map.of(
                "appKey", app.at("/application/appKey").asText(), "appSecret", app.get("appSecret").asText(), "tenantId", "101", "existingToken", raw))))
                .andExpect(status().isUnauthorized());
        send(post("/api/token/revoke").header("Authorization", "Bearer " + next.get("accessToken").asText()));
        mvc.perform(post("/api/token/introspect").header("Authorization", "Bearer " + next.get("accessToken").asText())).andExpect(status().isUnauthorized());
        JsonNode page = send(admin(get("/admin-api/applications/" + app.at("/application/id").asText() + "/tokens")));
        assertThat(page.get("total").asLong()).isEqualTo(2);
        assertThat(page.at("/items/0/status").asText()).isEqualTo("REVOKED");
        assertThat(page.toString()).doesNotContain(raw, next.get("accessToken").asText(), "digest", "accessToken");
    }

    @Test
    void immutableRequestBoundariesRejectCredentialsIdentityAndScopeInjection() throws Exception {
        JsonNode app = application();
        mvc.perform(post("/api/token").contentType("application/json").content(issueBody(app, "102"))).andExpect(status().isForbidden());
        mvc.perform(post("/api/token").contentType("application/json").content(json.writeValueAsString(Map.of(
                "appKey", app.at("/application/appKey").asText(), "appSecret", "wrong", "tenantId", "101"))))
                .andExpect(status().isUnauthorized()).andExpect(jsonPath("$.code").value(40100002));
        for (String extra : new String[]{"userId", "scopeCodes", "employeeId"}) {
            var body = json.createObjectNode();
            body.put("appKey", app.at("/application/appKey").asText()); body.put("appSecret", app.get("appSecret").asText()); body.put("tenantId", "101"); body.put(extra, "evil");
            mvc.perform(post("/api/token").contentType("application/json").content(json.writeValueAsString(body))).andExpect(status().isBadRequest());
        }
        mvc.perform(post("/api/token").contentType("application/json").content("{\"appKey\":\"" + "x".repeat(70_000) + "\"}"))
                .andExpect(status().isBadRequest());
        JsonNode issued = send(post("/api/token").content(issueBody(app, "101")));
        String raw = issued.get("accessToken").asText();
        mvc.perform(post("/api/token/introspect").header("Authorization", "Bearer " + raw).contentType("application/json").content("{\"tenantId\":\"102\"}"))
                .andExpect(status().isBadRequest());
        mvc.perform(post("/api/token/refresh").header("Authorization", "Bearer " + raw).contentType("application/json")
                .content(credentials(app).replace("}", ",\"scopeCodes\":[\"evil\"]}"))).andExpect(status().isBadRequest());
        mvc.perform(post("/api/token/introspect")).andExpect(status().isUnauthorized());
        assertThat(send(admin(get("/admin-api/applications/" + app.at("/application/id").asText() + "/tokens"))).get("total").asLong()).isEqualTo(1);
    }

    @Test
    void credentialRotationAndReenablingCannotRestoreOldTokens() throws Exception {
        JsonNode app = application();
        String appId = app.at("/application/id").asText();
        JsonNode issued = send(post("/api/token").content(issueBody(app, "101")));
        String raw = issued.get("accessToken").asText();
        send(admin(put("/admin-api/applications/" + appId).content(json.writeValueAsString(java.util.Map.of("name", "仅改名称", "expectedName", app.at("/application/name").asText())))));
        send(post("/api/token/introspect").header("Authorization", "Bearer " + raw));
        send(admin(put("/admin-api/applications/" + appId + "/status").content("{\"enabled\":false}")));
        send(admin(put("/admin-api/applications/" + appId + "/status").content("{\"enabled\":true}")));
        mvc.perform(post("/api/token/introspect").header("Authorization", "Bearer " + raw)).andExpect(status().isUnauthorized());
        assertThat(send(admin(get("/admin-api/applications/" + appId + "/tokens"))).at("/items/0/status").asText()).isEqualTo("INVALIDATED");
        JsonNode current = send(post("/api/token").content(issueBody(app, "101")));
        send(admin(post("/admin-api/applications/" + appId + "/secret/rotate")));
        mvc.perform(post("/api/token/introspect").header("Authorization", "Bearer " + current.get("accessToken").asText())).andExpect(status().isUnauthorized());
        mvc.perform(post("/api/token/refresh").header("Authorization", "Bearer " + current.get("accessToken").asText()).contentType("application/json").content(credentials(app)))
                .andExpect(status().isUnauthorized()).andExpect(jsonPath("$.code").value(40100002));
    }

    @Test
    void expiryBoundaryAndAdminRevocationAreEffectiveOnNextValidation() throws Exception {
        JsonNode app = application();
        JsonNode issued = send(post("/api/token").content(issueBody(app, "101")));
        String raw = issued.get("accessToken").asText();
        java.time.Instant expiresAt = java.time.Instant.parse(issued.get("expiresAt").asText());
        org.mockito.Mockito.doReturn(expiresAt.minusMillis(1)).when(tokenClock).instant();
        send(post("/api/token/introspect").header("Authorization", "Bearer " + raw));
        org.mockito.Mockito.doReturn(expiresAt).when(tokenClock).instant();
        mvc.perform(post("/api/token/introspect").header("Authorization", "Bearer " + raw)).andExpect(status().isUnauthorized());
        mvc.perform(post("/api/token/refresh").header("Authorization", "Bearer " + raw).contentType("application/json").content(credentials(app))).andExpect(status().isUnauthorized());
        JsonNode page = send(admin(get("/admin-api/applications/" + app.at("/application/id").asText() + "/tokens")));
        assertThat(page.at("/items/0/status").asText()).isEqualTo("EXPIRED");
        org.mockito.Mockito.doCallRealMethod().when(tokenClock).instant();
        JsonNode other = send(post("/api/token").content(issueBody(app, "101")));
        String id = other.at("/context/tokenId").asText();
        mvc.perform(delete("/admin-api/tokens/" + id)).andExpect(status().isUnauthorized());
        mvc.perform(delete("/admin-api/tokens/" + id).session(io.github.chenyilei2016.openplatform.testing.TestSessions.session("test-session"))).andExpect(status().isForbidden());
        send(admin(delete("/admin-api/tokens/" + id)));
        mvc.perform(post("/api/token/introspect").header("Authorization", "Bearer " + other.get("accessToken").asText())).andExpect(status().isUnauthorized());
    }

    @Test
    void databaseConnectionFailureIs503ForIntrospectionAndReuse() throws Exception {
        JsonNode app = application();
        JsonNode issued = send(post("/api/token").content(issueBody(app, "101")));
        String raw = issued.get("accessToken").asText();
        org.mockito.Mockito.doThrow(new java.sql.SQLNonTransientConnectionException("database-password-do-not-expose"))
                .when(dataSource).getConnection();
        try {
            mvc.perform(post("/api/token/introspect").header("Authorization", "Bearer " + raw))
                    .andExpect(status().isServiceUnavailable()).andExpect(content().string(org.hamcrest.Matchers.not(org.hamcrest.Matchers.containsString("database-password-do-not-expose"))));
            mvc.perform(post("/api/token").contentType("application/json").content(json.writeValueAsString(Map.of(
                    "appKey", app.at("/application/appKey").asText(), "appSecret", app.get("appSecret").asText(), "tenantId", "101", "existingToken", raw))))
                    .andExpect(status().isServiceUnavailable());
        } finally { org.mockito.Mockito.doCallRealMethod().when(dataSource).getConnection(); }
    }

    @Test
    void personnelTokensRequireCurrentDirectoryIdentityAndExplicitTenantGrant() throws Exception {
        JsonNode app = application();
        String userBody = json.writeValueAsString(Map.of("appKey", app.at("/application/appKey").asText(), "appSecret", app.get("appSecret").asText(), "tenantId", "101", "employeeNo", "E001"));
        mvc.perform(post("/api/token").contentType("application/json").content(userBody)).andExpect(status().isForbidden());
        grantEmployee(app);
        JsonNode issued = send(post("/api/token").content(userBody));
        assertThat(issued.at("/context/userId").asText()).isEqualTo("9007199254740995");
        assertThat(issued.at("/context/employeeId").asText()).isEqualTo("9007199254740993");
        String raw = issued.get("accessToken").asText();
        var employee = validEmployee();
        employee.setUserId(2L);
        when(employeeFacade.find(org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.anyString())).thenAnswer(invocation -> employee.toIdentity());
        mvc.perform(post("/api/token/introspect").header("Authorization", "Bearer " + raw)).andExpect(status().isUnauthorized());
        employee.setUserId(9007199254740995L); employee.setEmployeeStatus(6);
        mvc.perform(post("/api/token/introspect").header("Authorization", "Bearer " + raw)).andExpect(status().isUnauthorized());
        employee.setEmployeeStatus(4); employee.setEnabled(false);
        mvc.perform(post("/api/token/introspect").header("Authorization", "Bearer " + raw)).andExpect(status().isUnauthorized());
        employee.setEnabled(true); employee.setTenantId(102L);
        mvc.perform(post("/api/token/introspect").header("Authorization", "Bearer " + raw)).andExpect(status().isUnauthorized());
        when(employeeFacade.find(org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.anyString())).thenThrow(new io.github.chenyilei2016.openplatform.domain.common.PlatformException(io.github.chenyilei2016.openplatform.domain.common.ErrorCode.DEPENDENCY_UNAVAILABLE, "人员目录暂不可用"));
        mvc.perform(post("/api/token/introspect").header("Authorization", "Bearer " + raw)).andExpect(status().isServiceUnavailable())
                .andExpect(content().string(org.hamcrest.Matchers.not(org.hamcrest.Matchers.containsString("directory-private-body"))));
    }

    @Test
    void rebindingTenantAndScopeExpansionCannotReviveOrExpandPreviousTokens() throws Exception {
        JsonNode app = application();
        String appId = app.at("/application/id").asText();
        JsonNode issued = send(post("/api/token").content(issueBody(app, "101")));
        String raw = issued.get("accessToken").asText();
        String grantId = send(admin(get("/admin-api/applications/" + appId + "/tenant-grants"))).at("/items/0/id").asText();
        send(admin(delete("/admin-api/tenant-grants/" + grantId)));
        send(admin(post("/admin-api/tenant-grants").content(issueBody(app, "101"))));
        mvc.perform(post("/api/token/introspect").header("Authorization", "Bearer " + raw)).andExpect(status().isUnauthorized());
        JsonNode current = send(post("/api/token").content(issueBody(app, "101")));
        String additional = "extra-" + UUID.randomUUID();
        send(admin(post("/admin-api/scopes").content(json.writeValueAsString(Map.of("code", additional, "name", "扩展范围", "enabled", true, "defaultForNewApplication", false)))));
        var expanded = new java.util.ArrayList<String>();
        current.at("/context/scopeCodes").forEach(code -> expanded.add(code.asText())); expanded.add(additional);
        send(admin(put("/admin-api/applications/" + appId + "/scopes").content(json.writeValueAsString(Map.of("scopeCodes", expanded)))));
        mvc.perform(post("/api/token/refresh").header("Authorization", "Bearer " + current.get("accessToken").asText())
                .contentType("application/json").content(credentials(app))).andExpect(status().isUnauthorized());
        assertThat(send(post("/api/token").content(issueBody(app, "101"))).at("/context/scopeCodes").size()).isEqualTo(2);
    }

    @Test
    void onlyOneConcurrentRefreshSucceeds() throws Exception {
        JsonNode app = application();
        JsonNode issued = send(post("/api/token").content(issueBody(app, "101")));
        String raw = issued.get("accessToken").asText();
        var start = new java.util.concurrent.CountDownLatch(1);
        try (var executor = java.util.concurrent.Executors.newFixedThreadPool(2)) {
            java.util.concurrent.Callable<Integer> refresh = () -> {
                start.await();
                return mvc.perform(post("/api/token/refresh").header("Authorization", "Bearer " + raw).contentType("application/json")
                        .content(credentials(app))).andReturn().getResponse().getStatus();
            };
            var one = executor.submit(refresh); var two = executor.submit(refresh); start.countDown();
            assertThat(java.util.List.of(one.get(10, java.util.concurrent.TimeUnit.SECONDS), two.get(10, java.util.concurrent.TimeUnit.SECONDS)))
                    .containsExactlyInAnyOrder(200, 401);
        }
        JsonNode list = send(admin(get("/admin-api/applications/" + app.at("/application/id").asText() + "/tokens")));
        assertThat(list.get("total").asLong()).isEqualTo(2);
        assertThat(list.get("items").toString()).contains("ACTIVE", "REVOKED");
    }

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(booleans = {false, true})
    void personnelRevocationDuringDirectoryLookupRejectsPendingIssueOrValidationWithoutHoldingLocks(boolean issuing) throws Exception {
        JsonNode app = application();
        JsonNode person = grantEmployee(app);
        JsonNode issued = send(post("/api/token").content(json.writeValueAsString(Map.of("appKey", app.at("/application/appKey").asText(),
                "appSecret", app.get("appSecret").asText(), "tenantId", "101", "employeeNo", "E001"))));
        String raw = issued.get("accessToken").asText();
        var queried = new java.util.concurrent.CountDownLatch(1);
        var release = new java.util.concurrent.CountDownLatch(1);
        when(employeeFacade.find(org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.anyString())).thenAnswer(invocation -> {
            queried.countDown();
            if (!release.await(10, java.util.concurrent.TimeUnit.SECONDS)) throw new IllegalStateException("lookup timeout");
            return validEmployee().toIdentity();
        });
        try (var executor = java.util.concurrent.Executors.newFixedThreadPool(2)) {
            var pending = executor.submit(() -> {
                var request = issuing ? post("/api/token").contentType("application/json").content(json.writeValueAsString(Map.of(
                        "appKey", app.at("/application/appKey").asText(), "appSecret", app.get("appSecret").asText(), "tenantId", "101", "employeeNo", "E001")))
                        : post("/api/token/introspect").header("Authorization", "Bearer " + raw);
                return mvc.perform(request).andReturn().getResponse().getStatus();
            });
            try {
                assertThat(queried.await(5, java.util.concurrent.TimeUnit.SECONDS)).isTrue();
                executor.submit(() -> send(admin(delete("/admin-api/user-grants/" + person.get("id").asText())))).get(3, java.util.concurrent.TimeUnit.SECONDS);
            } finally { release.countDown(); }
            assertThat(pending.get(5, java.util.concurrent.TimeUnit.SECONDS)).isEqualTo(issuing ? 403 : 401);
        }
        assertThat(send(admin(get("/admin-api/applications/" + app.at("/application/id").asText() + "/tokens"))).at("/items/0/status").asText()).isEqualTo("INVALIDATED");
    }

    private JsonNode grantEmployee(JsonNode app) throws Exception {
        when(employeeFacade.find(org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.anyString())).thenReturn(validEmployee().toIdentity());
        String grantId = send(admin(get("/admin-api/applications/" + app.at("/application/id").asText() + "/tenant-grants"))).at("/items/0/id").asText();
        return send(admin(post("/admin-api/tenant-grants/" + grantId + "/users").content("{\"employeeNo\":\"E001\"}")));
    }

    private io.github.chenyilei2016.openplatform.testing.TestEmployee validEmployee() {
        var employee = new io.github.chenyilei2016.openplatform.testing.TestEmployee();
        employee.setId(9007199254740993L); employee.setUserId(9007199254740995L); employee.setTenantId(101L);
        employee.setEmployeeNoStr("E001"); employee.setName("真实人员"); employee.setEnabled(true); employee.setEmployeeStatus(4);
        return employee;
    }

    private String credentials(JsonNode app) {
        return json.writeValueAsString(Map.of("appKey", app.at("/application/appKey").asText(), "appSecret", app.get("appSecret").asText()));
    }

    private JsonNode application() throws Exception {
        String code = "token-" + UUID.randomUUID();
        send(admin(post("/admin-api/scopes").content(json.writeValueAsString(Map.of(
                "code", code, "name", "Token范围", "enabled", true, "defaultForNewApplication", false)))));
        JsonNode app = send(admin(post("/admin-api/applications").content("{\"name\":\"Token应用\",\"ownerTenantId\":\"100\"}")));
        send(admin(put("/admin-api/applications/" + app.at("/application/id").asText() + "/scopes")
                .content(json.writeValueAsString(Map.of("scopeCodes", java.util.List.of(code))))));
        send(admin(post("/admin-api/tenant-grants").content(issueBody(app, "101"))));
        return app;
    }

    private String issueBody(JsonNode app, String tenantId) {
        return json.writeValueAsString(Map.of("appKey", app.at("/application/appKey").asText(), "appSecret", app.get("appSecret").asText(), "tenantId", tenantId));
    }

    private JsonNode send(MockHttpServletRequestBuilder request) throws Exception {
        var result = mvc.perform(request.contentType("application/json")).andExpect(status().isOk()).andExpect(jsonPath("$.code").value(200)).andReturn();
        if (result.getRequest().getRequestURI().startsWith("/api/token")) {
            assertThat(result.getResponse().getHeader("Cache-Control")).isEqualTo("no-store");
        }
        return json.readTree(result.getResponse().getContentAsString()).get("data");
    }

    private MockHttpServletRequestBuilder admin(MockHttpServletRequestBuilder request) {
        return request.session(io.github.chenyilei2016.openplatform.testing.TestSessions.session("test-session")).header("X-CSRF-Token", "76832d7fdbcdbf4a72129f8b7def9016");
    }
}
