package io.github.chenyilei2016.openplatform.access;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import io.github.chenyilei2016.openplatform.domain.access.*;
import io.github.chenyilei2016.openplatform.domain.administration.*;
import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;

import io.github.chenyilei2016.openplatform.application.identity.AccountAuthentication;
import io.github.chenyilei2016.openplatform.testing.TestAccount;
import io.github.chenyilei2016.openplatform.testing.TestTenant;

import jakarta.servlet.http.Cookie;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.webmvc.test.autoconfigure.MockMvcPrint;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.context.jdbc.Sql;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/** HTTP→实际认证编排→MyBatis/H2档案；仅平台登录及平台人员边界替身。 */
@SpringBootTest(
        properties = {



            })
@AutoConfigureMockMvc(print = MockMvcPrint.NONE)
@Sql("classpath:db/administrator-schema.sql")
class EmployeeProfileHttpTest {
    private static final String USER = "9007199254740993";
    private static final String EMPLOYEE = "9007199254740111";
    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate database;
    @Autowired AdministratorRepository administrators;
    @Autowired PlatformTransactionManager transactions;
    @MockitoBean AccountAuthentication login;
    @MockitoBean EmployeeDirectory employees;
    @MockitoSpyBean EmployeeProfileRepository profiles;
    private final JsonMapper json = JsonMapper.builder().build();

    @BeforeEach
    void setup() {
        database.update("DELETE FROM access_employee_profile");
        database.update("DELETE FROM platform_administrator_permission");
        database.update("DELETE FROM platform_administrator_audit");
        database.update("DELETE FROM platform_administrator");
        new TransactionTemplate(transactions)
                .executeWithoutResult(
                        status -> {
                            administrators.lockControl();
                            administrators.createAll(
                                    List.of(
                                            new Administrator(
                                                    UUID.randomUUID().toString(),
                                                    "101",
                                                    USER,
                                                    EMPLOYEE,
                                                    "E1001",
                                                    "历史管理员姓名",
                                                    true,
                                                    true,
                                                    1,
                                                    Set.of(AdminPermission.MANAGE_APPLICATIONS))));
                        });
        identity("primary", "101", USER, EMPLOYEE, "E1001", "当前员工", "主租户");
        identity("other", "202", "9007199254740994", "9007199254740222", "E1001", "当前员工", "另一租户");
    }

    private void identity(
            String cookie,
            String tenant,
            String userId,
            String employeeId,
            String number,
            String name,
            String tenantName) {
        TestAccount user = new TestAccount();
        user.setId(Long.valueOf(userId));
        user.setTenantId(tenant);
        user.setEmployeeNoStr(number);
        user.setEmployeeName("平台登录缓存姓名");
        TestTenant named = new TestTenant();
        named.setId(Long.valueOf(tenant));
        named.setName(tenantName);
        user.setTenant(named);
        when(login.current(cookie)).thenAnswer(invocation -> user.verified(employees));
        when(employees.find(tenant, number))
                .thenReturn(
                        new EmployeeIdentity(
                                tenant,
                                userId,
                                employeeId,
                                number,
                                name,
                                true,
                                EmployeeStatus.PERMANENT));
    }

    private MockHttpServletRequestBuilder as(String cookie, MockHttpServletRequestBuilder request) {
        return request.session(io.github.chenyilei2016.openplatform.testing.TestSessions.session(cookie))
                .header("X-CSRF-Token", org.springframework.util.DigestUtils.md5DigestAsHex(cookie.getBytes(java.nio.charset.StandardCharsets.UTF_8)))
                .contentType("application/json");
    }

    private JsonNode data(String cookie, MockHttpServletRequestBuilder request) throws Exception {
        String response =
                mvc.perform(as(cookie, request))
                        .andExpect(status().isOk())
                        .andReturn()
                        .getResponse()
                        .getContentAsString();
        return json.readTree(response).get("data");
    }

    @Test
    void sessionsRegisterOneVerifiedPersonAndOrdinaryRequestsNeverRegister() throws Exception {
        data(
                "primary",
                get("/admin-api/session")
                        .param("tenantId", "202")
                        .param("displayName", "伪造名称")
                        .param("tenantName", "伪造租户"));
        JsonNode portal = data("primary", get("/portal-api/session"));
        assertThat(portal.get("employeeId").asText()).isEqualTo(EMPLOYEE);
        assertThat(portal.get("userId").asText()).isEqualTo(USER);
        data("primary", get("/portal-api/session"));
        assertThat(
                        database.queryForObject(
                                "SELECT COUNT(*) FROM access_employee_profile", Integer.class))
                .isEqualTo(1);
        assertThat(
                        database.queryForMap(
                                "SELECT tenant_name,user_id,employee_id,display_name FROM"
                                    + " access_employee_profile"))
                .containsEntry("tenant_name", "主租户")
                .containsEntry("user_id", USER)
                .containsEntry("employee_id", EMPLOYEE)
                .containsEntry("display_name", "当前员工");
        clearInvocations(profiles, employees);
        JsonNode page =
                data("primary", get("/admin-api/employee-profiles").param("tenantId", "101"));
        assertThat(page.get("total").asLong()).isEqualTo(1);
        verify(profiles, never()).remember(any(), any());
        verify(employees, times(1)).find("101", "E1001");
        assertThat(page.toString()).doesNotContain("userId", USER);
    }

    @Test
    void tenantBoundarySameNamesAndPaginationAreExplicit() throws Exception {
        data("primary", get("/portal-api/session"));
        data("other", get("/portal-api/session"));
        JsonNode current =
                data(
                        "primary",
                        get("/portal-api/employee-profiles")
                                .param("tenantId", "202")
                                .param("employeeNo", "E1001"));
        assertThat(current.get("total").asLong()).isEqualTo(1);
        assertThat(current.at("/items/0/tenantId").asText()).isEqualTo("101");
        assertThat(current.at("/items/0/tenantName").asText()).isEqualTo("主租户");
        assertThat(
                        data("primary", get("/portal-api/employee-profiles").param("name", "不存在"))
                                .get("total")
                                .asLong())
                .isZero();
        mvc.perform(as("primary", get("/portal-api/employee-profiles").param("pageSize", "101")))
                .andExpect(status().isBadRequest());
        mvc.perform(get("/portal-api/employee-profiles").header("X-Tenant-Id", "101"))
                .andExpect(status().isUnauthorized());
        mvc.perform(as("other", get("/admin-api/employee-profiles").param("tenantId", "101")))
                .andExpect(status().isForbidden());
        assertThat(
                        data(
                                        "primary",
                                        get("/admin-api/administrators/employee-profiles")
                                                .param("tenantId", "202"))
                                .at("/items/0/tenantId")
                                .asText())
                .isEqualTo("202");
    }

    @Test
    void atomicUpsertThrottlesSeenTimeButUpdatesChangedFactsAndDoesNotMergeReusedNumbers()
            throws Exception {
        Instant first = Instant.parse("2026-09-20T00:00:00Z");
        profiles.remember(
                new EmployeeProfile(null, "101", "租户A", "person-a", "account-a", "E1", "旧名", first),
                first.minusSeconds(900));
        profiles.remember(
                new EmployeeProfile(null,
                        "101", "租户A", "person-a", "account-a", "E1", "旧名", first.plusSeconds(30)),
                first.minusSeconds(870));
        assertThat(
                        profiles.page(new EmployeeProfileQuery("101", "E1", null, 1, 20))
                                .items()
                                .getFirst()
                                .lastSeenAt())
                .isEqualTo(first);
        profiles.remember(
                new EmployeeProfile(null,
                        "101", "租户A", "person-a", "account-a", "E2", "改名_%", first.plusSeconds(60)),
                first.minusSeconds(840));
        profiles.remember(
                new EmployeeProfile(null,
                        "101", null, "person-a", "account-a", "OLD", "迟到旧名", first.plusSeconds(10)),
                first.minusSeconds(890));
        profiles.remember(
                new EmployeeProfile(null,
                        "101",
                        "租户A",
                        "person-b",
                        "account-b",
                        "E1",
                        "回收工号的新员工",
                        first.plusSeconds(90)),
                first.minusSeconds(810));
        assertThat(
                        profiles.page(new EmployeeProfileQuery("101", "E1", null, 1, 20))
                                .items()
                                .getFirst()
                                .employeeId())
                .isEqualTo("person-b");
        EmployeeProfile renamed =
                profiles.page(new EmployeeProfileQuery("101", "E2", "_%", 1, 20))
                        .items()
                        .getFirst();
        assertThat(renamed.employeeId()).isEqualTo("person-a");
        assertThat(renamed.displayName()).isEqualTo("改名_%");
        assertThat(renamed.tenantName()).isEqualTo("租户A");
    }

    @Test
    void displayFailureDoesNotBreakLoginButDirectoryFailureStillDeniesIt() throws Exception {
        doThrow(new DataAccessResourceFailureException("do-not-log-personal-data"))
                .when(profiles)
                .remember(any(), any());
        data("primary", get("/portal-api/session"));
        when(employees.find("101", "E1001"))
                .thenThrow(new PlatformException(ErrorCode.DEPENDENCY_UNAVAILABLE, "人员服务不可用"));
        mvc.perform(as("primary", get("/portal-api/session")))
                .andExpect(status().isServiceUnavailable());
    }

    @Test
    void grantingAnEmployeeWhoNeverLoggedInRecordsDisplayAfterCommitAndFailureDoesNotRollbackGrant()
            throws Exception {
        data("primary", get("/portal-api/session"));
        when(employees.find("101", "E2"))
                .thenReturn(
                        new EmployeeIdentity(
                                "101",
                                "5002",
                                "6002",
                                "E2",
                                "从未登录人员",
                                true,
                                EmployeeStatus.PERMANENT));
        JsonNode created =
                data(
                        "primary",
                        post("/admin-api/applications")
                                .content(
                                        "{\"name\":\"profile-test-"
                                                + UUID.randomUUID()
                                                + "\",\"ownerTenantId\":\"101\"}"));
        String appKey = created.at("/application/appKey").asText();
        String secret = created.get("appSecret").asText();
        JsonNode grant =
                data(
                        "primary",
                        post("/admin-api/tenant-grants")
                                .content(
                                        json.writeValueAsString(
                                                java.util.Map.of(
                                                        "appKey",
                                                        appKey,
                                                        "appSecret",
                                                        secret,
                                                        "tenantId",
                                                        "101"))));
        String grantId = grant.get("id").asText();
        data(
                "primary",
                post("/admin-api/tenant-grants/" + grantId + "/users")
                        .content("{\"employeeNo\":\"E2\"}"));
        EmployeeProfile target =
                profiles.page(new EmployeeProfileQuery("101", "E2", null, 1, 20))
                        .items()
                        .getFirst();
        assertThat(target.employeeId()).isEqualTo("6002");
        assertThat(target.tenantName()).isEqualTo("主租户");
        JsonNode token =
                json.readTree(
                                mvc.perform(
                                                post("/api/token")
                                                        .contentType("application/json")
                                                        .content(
                                                                json.writeValueAsString(
                                                                        java.util.Map.of(
                                                                                "appKey",
                                                                                appKey,
                                                                                "appSecret",
                                                                                secret,
                                                                                "tenantId",
                                                                                "101",
                                                                                "employeeNo",
                                                                                "E2"))))
                                        .andExpect(status().isOk())
                                        .andReturn()
                                        .getResponse()
                                        .getContentAsString())
                        .get("data");
        String tokenId = token.at("/context/tokenId").asText();
        java.util.Map<String, Object> tokenBefore =
                database.queryForMap(
                        "SELECT status,application_version,tenant_version,user_version FROM"
                            + " platform_token WHERE id=?",
                        tokenId);
        identity("target", "101", "5002", "6002", "E2", "变更后的姓名", "主租户");
        data("target", get("/portal-api/session"));
        assertThat(
                        profiles.page(new EmployeeProfileQuery("101", "E2", null, 1, 20))
                                .items()
                                .getFirst()
                                .displayName())
                .isEqualTo("变更后的姓名");
        assertThat(
                        database.queryForMap(
                                "SELECT status,application_version,tenant_version,user_version FROM"
                                    + " platform_token WHERE id=?",
                                tokenId))
                .isEqualTo(tokenBefore);
        assertThat(
                        database.queryForObject(
                                "SELECT display_name FROM access_user_grant WHERE tenant_grant_id=?"
                                    + " AND employee_id='6002'",
                                String.class,
                                grantId))
                .isEqualTo("从未登录人员");
        assertThat(
                        database.queryForObject(
                                "SELECT authorization_version FROM access_user_grant WHERE"
                                    + " tenant_grant_id=? AND employee_id='6002'",
                                Long.class,
                                grantId))
                .isZero();
        when(employees.find("101", "E3"))
                .thenReturn(
                        new EmployeeIdentity(
                                "101",
                                "5003",
                                "6003",
                                "E3",
                                "目录暂不可写人员",
                                true,
                                EmployeeStatus.PERMANENT));
        doThrow(new DataAccessResourceFailureException("profile-storage-unavailable"))
                .when(profiles)
                .remember(any(), any());
        JsonNode successful =
                data(
                        "primary",
                        post("/admin-api/tenant-grants/" + grantId + "/users")
                                .content("{\"employeeNo\":\"E3\"}"));
        assertThat(successful.get("status").asText()).isEqualTo("ACTIVE");
        assertThat(
                        database.queryForObject(
                                "SELECT COUNT(*) FROM access_user_grant WHERE id=? AND"
                                    + " status='ACTIVE'",
                                Integer.class,
                                successful.get("id").asText()))
                .isEqualTo(1);
        assertThat(
                        database.queryForObject(
                                "SELECT COUNT(*) FROM access_audit WHERE application_id=? AND"
                                    + " action='GRANT_USER' AND outcome='SUCCESS'",
                                Integer.class,
                                created.at("/application/id").asText()))
                .isEqualTo(2);
    }

    @Test
    void simultaneousInitializationKeepsOnePersonRecord() throws Exception {
        java.util.concurrent.ExecutorService workers =
                java.util.concurrent.Executors.newFixedThreadPool(4);
        Instant now = Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MICROS);
        EmployeeProfile profile =
                new EmployeeProfile(null,
                        "101", "主租户", "concurrent-person", "concurrent-account", "C1", "并发人员", now);
        try {
            java.util.List<java.util.concurrent.Future<?>> calls = new java.util.ArrayList<>();
            for (int index = 0; index < 12; index++)
                calls.add(workers.submit(() -> profiles.remember(profile, now.minusSeconds(900))));
            for (java.util.concurrent.Future<?> call : calls)
                call.get(10, java.util.concurrent.TimeUnit.SECONDS);
            assertThat(profiles.page(new EmployeeProfileQuery("101", "C1", null, 1, 20)).total())
                    .isEqualTo(1);
        } finally {
            workers.shutdownNow();
            assertThat(workers.awaitTermination(5, java.util.concurrent.TimeUnit.SECONDS)).isTrue();
        }
    }

    @Test
    void anOldProfileNeverProvesEmployeeEligibility() throws Exception {
        data("primary", get("/portal-api/session"));
        when(employees.find("101", "E1001"))
                .thenReturn(
                        new EmployeeIdentity(
                                "101",
                                USER,
                                EMPLOYEE,
                                "E1001",
                                "当前员工",
                                false,
                                EmployeeStatus.LEFT));
        mvc.perform(as("primary", get("/portal-api/session"))).andExpect(status().isForbidden());
        assertThat(
                        database.queryForObject(
                                "SELECT COUNT(*) FROM access_employee_profile", Integer.class))
                .isEqualTo(1);
    }
}
