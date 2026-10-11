package io.github.chenyilei2016.openplatform.identity;

import io.github.chenyilei2016.openplatform.infrastructure.identity.LocalAccountAdapter;
import io.github.chenyilei2016.openplatform.infrastructure.properties.identity.LocalAccountProperties;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import tools.jackson.databind.json.JsonMapper;
import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(properties = {
    "open-platform.accounts.users[0].username=alice",
    "open-platform.accounts.users[0].password-hash=0000000000000000000000000000000037fb33a46bf7261436cc2fa97ee787357368d68d67b6a4bc7351fd38826ea172",
    "open-platform.accounts.users[0].tenant-id=tenant-a",
    "open-platform.accounts.users[0].tenant-name=测试租户",
    "open-platform.accounts.users[0].user-id=user-a",
    "open-platform.accounts.users[0].employee-id=employee-a",
    "open-platform.accounts.users[0].employee-no=A001",
    "open-platform.accounts.users[0].display-name=Alice",
    "open-platform.accounts.users[0].enabled=true"
})
@AutoConfigureMockMvc
class LocalAccountLoginHttpTest {
    @Autowired MockMvc mvc;
    private final JsonMapper json = JsonMapper.builder().build();

    @Test void loginRotatesSessionAndPreservesTenantAndAdminAuthorization() throws Exception {
        mvc.perform(get("/admin-api/session")).andExpect(status().isUnauthorized());
        mvc.perform(get("/portal-api/session").cookie(new jakarta.servlet.http.Cookie("LOGIN_KEY", "local:alice")))
                .andExpect(status().isUnauthorized());
        MvcResult csrf = mvc.perform(get("/auth/csrf")).andExpect(status().isOk()).andReturn();
        MockHttpSession before = (MockHttpSession) csrf.getRequest().getSession();
        String token = json.readTree(csrf.getResponse().getContentAsString()).at("/data/token").asText();
        mvc.perform(post("/auth/login").session(before).contentType("application/json")
                .content("{\"username\":\"alice\",\"password\":\"test-password\"}"))
                .andExpect(status().isForbidden());
        mvc.perform(post("/auth/login").session(before).header("X-CSRF-Token", token).contentType("application/json")
                .content("{\"username\":\"alice\",\"password\":\"wrong\"}"))
                .andExpect(status().isUnauthorized());
        MvcResult login = mvc.perform(post("/auth/login").session(before).header("X-CSRF-Token", token).contentType("application/json")
                .content("{\"username\":\"alice\",\"password\":\"test-password\"}"))
                .andExpect(status().isOk()).andReturn();
        MockHttpSession session = (MockHttpSession) login.getRequest().getSession(false);
        assertThat(before.isInvalid()).isTrue();
        assertThat(session.getId()).isNotEqualTo(before.getId());
        MvcResult portal = mvc.perform(get("/portal-api/session").session(session).header("X-Tenant-Id", "evil"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.tenantId").value("tenant-a")).andReturn();
        mvc.perform(get("/admin-api/session").session(session)).andExpect(status().isForbidden());
        mvc.perform(post("/auth/logout").session(session).header("X-CSRF-Token", token)).andExpect(status().isForbidden());
        mvc.perform(post("/auth/logout").session(session).header("X-CSRF-Token", portal.getResponse().getHeader("X-CSRF-Token")))
                .andExpect(status().isOk());
        assertThat(session.isInvalid()).isTrue();
    }

    @Test void disabledAccountsAndDuplicateIdentityCannotBypassDirectory() {
        LocalAccountProperties.User disabled = new LocalAccountProperties.User("alice", "0000000000000000000000000000000037fb33a46bf7261436cc2fa97ee787357368d68d67b6a4bc7351fd38826ea172", "tenant-a", "A", "user-a", "employee-a", "A001", "Alice", false);
        LocalAccountAdapter accounts = new LocalAccountAdapter(settings(List.of(disabled)));
        assertThatThrownBy(() -> accounts.authenticate("alice", "test-password")).isInstanceOf(PlatformException.class);
        assertThatThrownBy(() -> accounts.current("alice")).isInstanceOf(PlatformException.class);
        assertThatThrownBy(() -> new LocalAccountAdapter(settings(List.of(disabled, disabled)))).isInstanceOf(IllegalArgumentException.class);
    }
    private static LocalAccountProperties settings(List<LocalAccountProperties.User> users) {
        LocalAccountProperties settings = new LocalAccountProperties();
        settings.setUsers(users);
        return settings;
    }

}
