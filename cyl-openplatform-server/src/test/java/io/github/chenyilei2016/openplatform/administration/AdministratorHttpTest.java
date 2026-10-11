package io.github.chenyilei2016.openplatform.administration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import io.github.chenyilei2016.openplatform.domain.access.EmployeeDirectory;
import io.github.chenyilei2016.openplatform.domain.access.EmployeeIdentity;
import io.github.chenyilei2016.openplatform.domain.access.EmployeeStatus;
import io.github.chenyilei2016.openplatform.domain.administration.*;

import io.github.chenyilei2016.openplatform.application.identity.AccountAuthentication;
import io.github.chenyilei2016.openplatform.testing.TestAccount;

import jakarta.servlet.http.Cookie;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.webmvc.test.autoconfigure.MockMvcPrint;
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

import java.util.List;
import java.util.Set;

/** 真实HTTP+MyBatis/H2授权链；只有平台登录和USC外部边界使用替身。 */
@SpringBootTest(
        properties = {

            })
@AutoConfigureMockMvc(print = MockMvcPrint.NONE)
@Sql("classpath:db/administrator-schema.sql")
class AdministratorHttpTest {
    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate database;
    @Autowired PlatformTransactionManager transactions;
    @Autowired JsonMapper json;
    @MockitoBean AccountAuthentication login;
    @MockitoBean EmployeeDirectory employees;
    @MockitoSpyBean AdministratorRepository repository;
    private final EmployeeIdentity root = employee("E1", 101, 201);
    private final EmployeeIdentity target = employee("E2", 102, 202);
    private final EmployeeIdentity auditor = employee("E3", 103, 203);

    @BeforeEach
    void initialize() {
        database.update("DELETE FROM platform_administrator_audit");
        database.update("DELETE FROM platform_administrator_permission");
        database.update("DELETE FROM platform_administrator");
        for (EmployeeIdentity identity : List.of(root, target, auditor)) {
            when(employees.find(identity.tenantId(), identity.employeeNo())).thenReturn(identity);
            TestAccount user = new TestAccount();
            user.setId(Long.valueOf(identity.userId()));
            user.setEmployeeId(Long.valueOf(identity.employeeId()));
            user.setTenantId(identity.tenantId());
            user.setEmployeeNoStr(identity.employeeNo());
            user.setEmployeeName(identity.displayName());
            when(login.current(identity.employeeNo()))
                    .thenAnswer(invocation -> user.verified(employees));
        }
        new TransactionTemplate(transactions)
                .executeWithoutResult(transaction -> {
                    repository.lockControl();
                    repository.createAll(List.of(new Administrator(
                            "root",
                            root.tenantId(),
                            root.userId(),
                            root.employeeId(),
                            root.employeeNo(),
                            root.displayName(),
                            true,
                            true,
                            1,
                            Set.of())));
                });
    }

    @Test
    void databaseIsOnlyAuthorityAndSuperIdentityDoesNotGrantBusinessActions() throws Exception {
        mvc.perform(auth(get("/admin-api/session"), "E1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.superAdministrator").value(true))
                .andExpect(jsonPath("$.data.permissions").isEmpty());
        mvc.perform(auth(get("/admin-api/apis"), "E1")).andExpect(status().isForbidden());
        mvc.perform(auth(get("/admin-api/session"), "E2")).andExpect(status().isForbidden());
        mvc.perform(auth(get("/admin-api/administrators"), "E1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.total").value(1));
        mvc.perform(
                        auth(
                                post("/admin-api/administrators/employee-lookup")
                                        .content(
                                                "{\"tenantId\":\"tenant-1\",\"employeeNo\":\"E2\"}"),
                                "E1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.employeeId").value("202"));
    }

    @Test
    void detailUsesReadPermissionAndReturnsLatestRevision() throws Exception {
        JsonNode granted = create("E2", false, "MANAGE_APIS");
        String id = granted.get("id").asText();
        mvc.perform(auth(get("/admin-api/administrators/" + id), "E2")).andExpect(status().isForbidden());
        create("E3", false, "VIEW_AUDIT");
        mvc.perform(auth(get("/admin-api/administrators/" + id), "E3"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.revision").value(1));
        read(auth(put("/admin-api/administrators/" + id).content(update(1, false, false, "MANAGE_APIS")), "E1"));
        mvc.perform(auth(get("/admin-api/administrators/" + id), "E1"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.revision").value(2))
                .andExpect(jsonPath("$.data.enabled").value(false));
        mvc.perform(auth(get("/admin-api/administrators/missing"), "E1")).andExpect(status().isNotFound());
    }

    @Test
    void grantThenRevokeRejectsSameEmployeeCookieImmediatelyAndKeepsAudit() throws Exception {
        JsonNode granted = create("E2", false, "MANAGE_APIS");
        String id = granted.get("id").asText();
        mvc.perform(auth(get("/admin-api/apis"), "E2")).andExpect(status().isOk());
        mvc.perform(
                        auth(
                                put("/admin-api/administrators/" + id)
                                        .content(update(1, false, false, "MANAGE_APIS")),
                                "E1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.revision").value(2));
        mvc.perform(auth(get("/admin-api/apis"), "E2")).andExpect(status().isForbidden());
        JsonNode audit =
                read(
                        auth(
                                get("/admin-api/administrators/audit").param("administratorId", id),
                                "E1"));
        assertThat(audit.get("total").asInt()).isEqualTo(2);
        assertThat(audit.at("/items/0/operatorEmployeeNo").asText()).isEqualTo("E1");
        assertThat(audit.at("/items/0/before/enabled").asBoolean()).isTrue();
        assertThat(audit.at("/items/0/after/enabled").asBoolean()).isFalse();
        mvc.perform(auth(get("/portal-api/session"), "E2")).andExpect(status().isOk());
    }

    @Test
    void staleRevisionAndLastSuperAdministratorCannotBeOverwritten() throws Exception {
        mvc.perform(
                        auth(
                                put("/admin-api/administrators/root")
                                        .content(update(1, false, true)),
                                "E1"))
                .andExpect(status().isConflict());
        JsonNode granted = create("E2", true);
        String id = granted.get("id").asText();
        mvc.perform(
                        auth(
                                put("/admin-api/administrators/" + id)
                                        .content(update(7, false, false)),
                                "E1"))
                .andExpect(status().isConflict());
        mvc.perform(
                        auth(
                                put("/admin-api/administrators/root")
                                        .content(update(1, false, true)),
                                "E1"))
                .andExpect(status().isOk());
        mvc.perform(auth(get("/admin-api/administrators"), "E1")).andExpect(status().isForbidden());
        mvc.perform(auth(get("/admin-api/administrators/status"), "E2"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.enabledSuperAdministratorCount").value(1));
    }

    @Test
    void auditPermissionReadsHistoryButCannotLookupOrAssignPeople() throws Exception {
        create("E3", false, "VIEW_AUDIT");
        mvc.perform(auth(get("/admin-api/administrators/audit"), "E3")).andExpect(status().isOk());
        mvc.perform(auth(get("/admin-api/administrators"), "E3")).andExpect(status().isOk());
        mvc.perform(
                        auth(
                                post("/admin-api/administrators/employee-lookup")
                                        .content(
                                                "{\"tenantId\":\"tenant-1\",\"employeeNo\":\"E2\"}"),
                                "E3"))
                .andExpect(status().isForbidden());
        mvc.perform(
                        auth(
                                post("/admin-api/administrators")
                                        .content(createBody("E2", false, "MANAGE_APIS")),
                                "E3"))
                .andExpect(status().isForbidden());
    }

    @Test
    void employeeReplacementAndDatabaseOutageRejectAccess() throws Exception {
        create("E2", false, "MANAGE_APIS");
        when(employees.find("tenant-1", "E2")).thenReturn(employee("E2", 102, 999));
        mvc.perform(auth(get("/admin-api/session"), "E2")).andExpect(status().isForbidden());
        when(employees.find("tenant-1", "E2")).thenReturn(target);
        doThrow(new org.springframework.dao.DataAccessResourceFailureException("offline"))
                .when(repository)
                .findByIdentity("tenant-1", "E2");
        mvc.perform(auth(get("/admin-api/session"), "E2"))
                .andExpect(status().isServiceUnavailable());
    }

    @Test
    void csrfAndVerifiedIdentityCannotBeReplacedByCreationPayload() throws Exception {
        mvc.perform(
                        post("/admin-api/administrators")
                                .session(io.github.chenyilei2016.openplatform.testing.TestSessions.session("E1"))
                                .contentType("application/json")
                                .content(createBody("E2", false, "MANAGE_APIS")))
                .andExpect(status().isForbidden());
        mvc.perform(
                        auth(
                                post("/admin-api/administrators")
                                        .content(
                                                createBody("E2", false, "MANAGE_APIS")
                                                        .replace("\"202\"", "\"999\"")),
                                "E1"))
                .andExpect(status().isConflict());
        assertThat(read(auth(get("/admin-api/administrators"), "E1")).get("total").asInt())
                .isEqualTo(1);
    }

    private JsonNode create(String employeeNo, boolean superAdministrator, String... permissions)
            throws Exception {
        return read(
                auth(
                        post("/admin-api/administrators")
                                .content(createBody(employeeNo, superAdministrator, permissions)),
                        "E1"));
    }

    private String createBody(
            String employeeNo, boolean superAdministrator, String... permissions) {
        EmployeeIdentity identity = employeeNo.equals("E2") ? target : auditor;
        return json.writeValueAsString(
                java.util.Map.of(
                        "tenantId",
                        identity.tenantId(),
                        "employeeNo",
                        employeeNo,
                        "expectedUserId",
                        identity.userId(),
                        "expectedEmployeeId",
                        identity.employeeId(),
                        "permissions",
                        permissions,
                        "superAdministrator",
                        superAdministrator,
                        "reason",
                        "接手维护"));
    }

    private String update(
            long revision, boolean enabled, boolean superAdministrator, String... permissions) {
        return json.writeValueAsString(
                java.util.Map.of(
                        "expectedRevision",
                        revision,
                        "enabled",
                        enabled,
                        "superAdministrator",
                        superAdministrator,
                        "permissions",
                        permissions,
                        "reason",
                        "调整职责"));
    }

    private JsonNode read(MockHttpServletRequestBuilder request) throws Exception {
        return json.readTree(
                        mvc.perform(request)
                                .andExpect(status().isOk())
                                .andReturn()
                                .getResponse()
                                .getContentAsString())
                .get("data");
    }

    private MockHttpServletRequestBuilder auth(
            MockHttpServletRequestBuilder request, String employeeNo) {
        return request.session(io.github.chenyilei2016.openplatform.testing.TestSessions.session(employeeNo))
                .header(
                        "X-CSRF-Token",
                        org.springframework.util.DigestUtils.md5DigestAsHex(employeeNo.getBytes(java.nio.charset.StandardCharsets.UTF_8)))
                .contentType("application/json");
    }

    private static EmployeeIdentity employee(String no, long user, long employee) {
        return new EmployeeIdentity(
                "tenant-1",
                String.valueOf(user),
                String.valueOf(employee),
                no,
                "员工" + no,
                true,
                EmployeeStatus.PERMANENT);
    }
}
