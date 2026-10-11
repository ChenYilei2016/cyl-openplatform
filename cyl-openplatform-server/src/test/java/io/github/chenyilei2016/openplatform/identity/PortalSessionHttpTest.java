package io.github.chenyilei2016.openplatform.identity;

import io.github.chenyilei2016.openplatform.domain.administration.AdminPermission;


import io.github.chenyilei2016.openplatform.application.identity.AccountAuthentication;
import io.github.chenyilei2016.openplatform.testing.TestAccount;
import io.github.chenyilei2016.openplatform.testing.TestTenant;
import io.github.chenyilei2016.openplatform.testing.TestEmployee;
import io.github.chenyilei2016.openplatform.domain.access.EmployeeDirectory;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.webmvc.test.autoconfigure.MockMvcPrint;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import static org.mockito.Mockito.when;
import static org.mockito.ArgumentMatchers.argThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@io.github.chenyilei2016.openplatform.testing.TestAdministrators
@SpringBootTest(properties = {

        "test.admin.operators[0].tenant-id=101", "test.admin.operators[0].employee-no=admin",
        "test.admin.operators[0].permissions[0]=MANAGE_APPLICATIONS"
})
@AutoConfigureMockMvc(print = MockMvcPrint.NONE)
class PortalSessionHttpTest {
    @Autowired MockMvc mvc;
    @MockitoBean AccountAuthentication identity;
    @MockitoBean EmployeeDirectory employees;

    @Test
    void everyVerifiedEmployeeCanUseTheirTenantPortalWithoutGainingAdminPermissions() throws Exception {
        login("customer", "101", "customer");
        mvc.perform(get("/portal-api/session").session(io.github.chenyilei2016.openplatform.testing.TestSessions.session("customer")))
                .andExpect(status().isOk()).andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(header().string("X-Content-Type-Options", "nosniff"))
                .andExpect(header().exists("X-CSRF-Token"))
                .andExpect(jsonPath("$.data.tenantId").value("101"))
                .andExpect(jsonPath("$.data.userId").value("9007199254740993"))
                .andExpect(jsonPath("$.data.tenantName").value("租户101"))
                .andExpect(jsonPath("$.data.permissions").doesNotExist());
        mvc.perform(get("/admin-api/session").session(io.github.chenyilei2016.openplatform.testing.TestSessions.session("customer"))).andExpect(status().isForbidden());
        login("admin", "101", "admin");
        mvc.perform(get("/admin-api/session").session(io.github.chenyilei2016.openplatform.testing.TestSessions.session("admin"))).andExpect(status().isOk());
        mvc.perform(get("/portal-api/session").session(io.github.chenyilei2016.openplatform.testing.TestSessions.session("admin"))).andExpect(status().isOk());
        login("customer", "202", "customer");
        mvc.perform(get("/portal-api/session").session(io.github.chenyilei2016.openplatform.testing.TestSessions.session("customer")))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.tenantId").value("202"));
    }

    @Test
    void anonymousAndForgedTenantCannotEstablishPortalSession() throws Exception {
        mvc.perform(get("/portal-api/session").header("X-Tenant-Id", "101").header("X-Employee-No", "customer")
                        .header("X-Skip-Authentication", "false")).andExpect(status().isUnauthorized());
        login("customer", "101", "customer");
        mvc.perform(get("/portal-api/session").session(io.github.chenyilei2016.openplatform.testing.TestSessions.session("customer")).header("X-Tenant-Id", "202")
                        .param("tenantName", "伪造租户"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.tenantId").value("101"))
                .andExpect(jsonPath("$.data.tenantName").value("租户101"));
        mvc.perform(get("/platform/portal-api/session").contextPath("/platform")
                        .session(io.github.chenyilei2016.openplatform.testing.TestSessions.session("customer")))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.tenantId").value("101"));
        mvc.perform(get("/portal-api/session")).andExpect(status().isUnauthorized());
    }

    @Test
    void aCachedLoginCannotKeepPortalAccessAfterPersonnelBecomesInvalid() throws Exception {
        TestEmployee person = login("customer", "101", "customer");
        mvc.perform(get("/portal-api/session").session(io.github.chenyilei2016.openplatform.testing.TestSessions.session("customer"))).andExpect(status().isOk());
        person.setEnabled(false);
        mvc.perform(get("/portal-api/session").session(io.github.chenyilei2016.openplatform.testing.TestSessions.session("customer"))).andExpect(status().isForbidden());
        person.setEnabled(true); person.setEmployeeStatus(6);
        mvc.perform(get("/portal-api/session").session(io.github.chenyilei2016.openplatform.testing.TestSessions.session("customer"))).andExpect(status().isForbidden());
        person.setEmployeeStatus(4); person.setTenantId(202L);
        mvc.perform(get("/portal-api/session").session(io.github.chenyilei2016.openplatform.testing.TestSessions.session("customer"))).andExpect(status().isForbidden());
        person.setTenantId(101L); person.setEmployeeNoStr("reassigned");
        mvc.perform(get("/portal-api/session").session(io.github.chenyilei2016.openplatform.testing.TestSessions.session("customer"))).andExpect(status().isForbidden());
        person.setEmployeeNoStr("customer"); person.setUserId(9007199254740995L);
        mvc.perform(get("/portal-api/session").session(io.github.chenyilei2016.openplatform.testing.TestSessions.session("customer"))).andExpect(status().isForbidden());
        mvc.perform(get("/portal-api/session")).andExpect(status().isUnauthorized());
    }

    private TestEmployee login(String cookie, String tenant, String employee) {
        TestAccount user = new TestAccount(); user.setId(9007199254740993L); user.setTenantId(tenant); user.setEmployeeNoStr(employee);
        TestTenant named = new TestTenant(); named.setId(Long.valueOf(tenant)); named.setName("租户" + tenant); user.setTenant(named);
        when(identity.current(cookie)).thenAnswer(invocation -> user.verified(employees));
        TestEmployee person = new TestEmployee();
        person.setId(1001L); person.setUserId(user.getId()); person.setTenantId(Long.valueOf(tenant));
        person.setEmployeeNoStr(employee); person.setName("有效员工"); person.setEnabled(true); person.setEmployeeStatus(4);
        when(employees.find(org.mockito.ArgumentMatchers.eq(tenant), org.mockito.ArgumentMatchers.eq(employee)))
                .thenAnswer(invocation -> person.toIdentity());
        return person;
    }
}
