package io.github.chenyilei2016.openplatform.identity;

import io.github.chenyilei2016.openplatform.domain.administration.AdminPermission;

import io.github.chenyilei2016.openplatform.common.ApiResponse;

import io.github.chenyilei2016.openplatform.application.identity.AccountAuthentication;
import io.github.chenyilei2016.openplatform.testing.TestAccount;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpMethod;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RestController;

import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.request;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@io.github.chenyilei2016.openplatform.testing.TestAdministrators
@SpringBootTest(properties = {



        "test.admin.operators[0].tenant-id=tenant-1",
        "test.admin.operators[0].employee-no=operator-1",
        "test.admin.operators[0].permissions[0]=MANAGE_APPLICATIONS",
        "test.admin.operators[0].permissions[1]=VIEW_AUDIT"
})
@AutoConfigureMockMvc
@Import(AdminSessionHttpTest.WriteEndpoint.class)
class AdminSessionHttpTest {
    @Autowired
    private MockMvc mvc;
    @MockitoBean
    private AccountAuthentication identityService;

    @Test
    void clientCookiesCannotDeclareALocalIdentity() throws Exception {
        mvc.perform(get("/admin-api/session").cookie(new Cookie("LOGIN_KEY", "local:admin")))
                .andExpect(status().isUnauthorized());
        org.mockito.Mockito.verifyNoInteractions(identityService);
    }

    @Test
    void businessHttpFixtureKeepsTrustedIdentityAndActionPermissions() throws Exception {
        TestAccount user = new TestAccount();
        user.setId(9007199254740993L);
        user.setTenantId("tenant-1");
        user.setEmployeeNoStr("operator-1");
        user.setEmployeeName("平台运营");
        when(identityService.current("test-session")).thenAnswer(invocation -> user.toAccount());

        mvc.perform(get("/admin-api/session").session(io.github.chenyilei2016.openplatform.testing.TestSessions.session("test-session"))
                        .header("X-Tenant-Id", "other-tenant"))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(header().string("X-CSRF-Token", "76832d7fdbcdbf4a72129f8b7def9016"))
                .andExpect(jsonPath("$.code").value(200))
                .andExpect(jsonPath("$.data.tenantId").value("tenant-1"))
                .andExpect(jsonPath("$.data.userId").value("9007199254740993"))
                .andExpect(jsonPath("$.data.employeeNo").value("operator-1"))
                .andExpect(jsonPath("$.data.displayName").value("平台运营"))
                .andExpect(jsonPath("$.data.permissions", org.hamcrest.Matchers.containsInAnyOrder(
                        "MANAGE_APPLICATIONS", "VIEW_AUDIT")))
                .andExpect(jsonPath("$.requestId").isNotEmpty());
    }

    @Test
    void writesRequireCsrfProofForEveryUnsafeHttpMethod() throws Exception {
        TestAccount user = new TestAccount();
        user.setId(9007199254740993L);
        user.setTenantId("tenant-1");
        user.setEmployeeNoStr("operator-1");
        when(identityService.current("test-session")).thenAnswer(invocation -> user.toAccount());
        for (HttpMethod method : new HttpMethod[]{HttpMethod.POST, HttpMethod.PUT, HttpMethod.DELETE}) {
            mvc.perform(request(method, "/admin-api/test-write").session(io.github.chenyilei2016.openplatform.testing.TestSessions.session("test-session")))
                    .andExpect(status().isForbidden())
                    .andExpect(jsonPath("$.code").value(40300001));
        }
    }

    @Test
    void validCsrfProofAllowsAuthorizedWritesAndDoesNotCarryIdentityToLaterRequests() throws Exception {
        TestAccount user = new TestAccount();
        user.setId(9007199254740993L);
        user.setTenantId("tenant-1");
        user.setEmployeeNoStr("operator-1");
        when(identityService.current("test-session")).thenAnswer(invocation -> user.toAccount());
        String csrfProof = mvc.perform(get("/admin-api/session").session(io.github.chenyilei2016.openplatform.testing.TestSessions.session("test-session")))
                .andExpect(status().isOk())
                .andExpect(header().exists("X-CSRF-Token"))
                .andReturn().getResponse().getHeader("X-CSRF-Token");
        for (HttpMethod method : new HttpMethod[]{HttpMethod.POST, HttpMethod.PUT, HttpMethod.DELETE}) {
            mvc.perform(request(method, "/admin-api/test-write")
                            .session(io.github.chenyilei2016.openplatform.testing.TestSessions.session("test-session"))
                            .header("X-CSRF-Token", csrfProof))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.data").value(true));
        }
        mvc.perform(get("/admin-api/session")).andExpect(status().isUnauthorized());
    }

    @Test
    void tenantOrEmployeeMismatchAndInvalidIdentityAreRejected() throws Exception {
        TestAccount user = new TestAccount();
        user.setId(9007199254740993L);
        user.setTenantId("other-tenant");
        user.setEmployeeNoStr("operator-1");
        when(identityService.current("test-session")).thenAnswer(invocation -> user.toAccount());
        mvc.perform(get("/admin-api/session").session(io.github.chenyilei2016.openplatform.testing.TestSessions.session("test-session")))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value(40300001));
        user.setTenantId("tenant-1");
        user.setEmployeeNoStr("other-employee");
        mvc.perform(get("/admin-api/session").session(io.github.chenyilei2016.openplatform.testing.TestSessions.session("test-session")))
                .andExpect(status().isForbidden());
        user.setEmployeeNoStr("operator-1");
        user.setId(null);
        mvc.perform(get("/admin-api/session").session(io.github.chenyilei2016.openplatform.testing.TestSessions.session("test-session")))
                .andExpect(status().isUnauthorized());
        when(identityService.current("test-session")).thenReturn(null);
        mvc.perform(get("/admin-api/session").session(io.github.chenyilei2016.openplatform.testing.TestSessions.session("test-session")))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void aPlatformOperatorCannotUseAnEndpointWithoutItsRequiredPermission() throws Exception {
        TestAccount user = new TestAccount();
        user.setId(9007199254740993L);
        user.setTenantId("tenant-1");
        user.setEmployeeNoStr("operator-1");
        when(identityService.current("test-session")).thenAnswer(invocation -> user.toAccount());
        mvc.perform(get("/admin-api/test-publish-access").session(io.github.chenyilei2016.openplatform.testing.TestSessions.session("test-session")))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value(40300001));
    }

    @RestController
    static class WriteEndpoint {
        @RequireAdmin(permissions=AdminPermission.MANAGE_APPLICATIONS)
        @RequestMapping(path = "/admin-api/test-write", method = {RequestMethod.POST, RequestMethod.PUT, RequestMethod.DELETE})
        ApiResponse<Boolean> write(jakarta.servlet.http.HttpServletRequest request) {
            AdminSession.current(request).requirePermission(AdminPermission.MANAGE_APPLICATIONS);
            return ApiResponse.success(true);
        }

        @RequireAdmin(permissions=AdminPermission.PUBLISH_APIS)
        @GetMapping("/admin-api/test-publish-access")
        ApiResponse<Boolean> publishAccess(jakarta.servlet.http.HttpServletRequest request) {
            AdminSession.current(request).requirePermission(AdminPermission.PUBLISH_APIS);
            return ApiResponse.success(true);
        }
    }

    @Test
    void anonymousAndForgedIdentityHeadersCannotAccessAdminSession() throws Exception {
        mvc.perform(get("/admin-api/session")
                        .header("X-Tenant-Id", "tenant-1")
                        .header("X-User-Id", "10001")
                        .header("X-Employee-No", "operator-1")
                        .header("X-Skip-Authentication", "false"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value(40100001));
    }
}
