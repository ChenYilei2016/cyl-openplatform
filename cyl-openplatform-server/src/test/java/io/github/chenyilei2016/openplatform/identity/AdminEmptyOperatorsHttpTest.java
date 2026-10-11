package io.github.chenyilei2016.openplatform.identity;


import io.github.chenyilei2016.openplatform.application.identity.AccountAuthentication;
import io.github.chenyilei2016.openplatform.testing.TestAccount;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@io.github.chenyilei2016.openplatform.testing.TestAdministrators
@SpringBootTest(properties = { "test.admin.operators="})
@AutoConfigureMockMvc
class AdminEmptyOperatorsHttpTest {
    @Autowired
    private MockMvc mvc;
    @MockitoBean
    private AccountAuthentication identityService;

    @Test
    void validIdentityDoesNotBypassTheConfiguredAdminBoundary() throws Exception {
        TestAccount user = new TestAccount();
        user.setId(10001L);
        user.setTenantId("tenant-1");
        user.setEmployeeNoStr("operator-1");
        when(identityService.current("test-session")).thenAnswer(invocation -> user.toAccount());
        mvc.perform(get("/admin-api/session").session(io.github.chenyilei2016.openplatform.testing.TestSessions.session("test-session")))
                .andExpect(status().isForbidden());
    }
}
