package io.github.chenyilei2016.openplatform.mcp;

import io.github.chenyilei2016.openplatform.application.mcp.McpGatewayCredentialService;
import io.github.chenyilei2016.openplatform.application.mcp.McpTenantActivationService;
import io.github.chenyilei2016.openplatform.application.signature.SigningKeyService;
import io.github.chenyilei2016.openplatform.domain.access.AccessOperator;
import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.github.chenyilei2016.openplatform.domain.signature.SigningKeyRepository;

import io.github.chenyilei2016.openplatform.application.identity.AccountAuthentication;
import io.github.chenyilei2016.openplatform.testing.TestEmployee;
import io.github.chenyilei2016.openplatform.testing.TestAccount;
import jakarta.servlet.http.Cookie;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
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

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowable;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** 121：MCP 网关凭据（唯一、一次性密钥、轮换即失效、停用）与租户开通（唯一含并发、门户不能指定租户、平台停用）。 */
@io.github.chenyilei2016.openplatform.testing.TestAdministrators
@SpringBootTest(properties = {

        "test.admin.operators[0].tenant-id=101",
        "test.admin.operators[0].employee-no=operator-1",
        "test.admin.operators[0].permissions[0]=MANAGE_APPLICATIONS",
        "test.admin.operators[0].permissions[1]=VIEW_AUDIT",
        "open-platform.signature.active-wrapping-key-id=mcp-test",
        "open-platform.signature.wrapping-keys.mcp-test=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
})
@AutoConfigureMockMvc(print = MockMvcPrint.NONE)
class McpAccessHttpTest {
    @Autowired MockMvc mvc;
    @Autowired McpGatewayCredentialService gateways;
    @Autowired McpTenantActivationService activations;
    @Autowired SigningKeyService signingKeys;
    @Autowired SigningKeyRepository keys;
    @MockitoBean AccountAuthentication identityService;
    @MockitoBean io.github.chenyilei2016.openplatform.domain.access.EmployeeDirectory employeeFacade;
    private final JsonMapper json = JsonMapper.builder().build();

    @BeforeEach
    void login() {
        login("test-session", 9007199254740993L, "101", "operator-1", 201L);
        login("other-session", 9007199254740995L, "102", "operator-2", 202L);
        login("plain-session", 9007199254740997L, "101", "member-1", 203L);
    }

    private void login(String cookie, long userId, String tenantId, String employeeNo, long employeeId) {
        var user = new TestAccount();
        user.setId(userId); user.setTenantId(tenantId); user.setEmployeeNoStr(employeeNo);
        when(identityService.current(cookie)).thenAnswer(invocation -> user.toAccount());
        TestEmployee employee = new TestEmployee();
        employee.setId(employeeId); employee.setUserId(userId); employee.setTenantId(Long.valueOf(tenantId));
        employee.setEmployeeNoStr(employeeNo); employee.setName("员工" + employeeNo);
        employee.setEnabled(true); employee.setEmployeeStatus(4);
        when(employeeFacade.find(org.mockito.ArgumentMatchers.eq(tenantId), org.mockito.ArgumentMatchers.eq(employeeNo))).thenAnswer(invocation -> employee.toIdentity());
    }

    @Test
    void gatewayCredentialIsUniqueOneTimeRotatesImmediatelyAndStaysOutOfOrdinaryManagement() throws Exception {
        assertThat(send(admin(get("/admin-api/mcp/gateway-credential"))).get("credential").isNull()).isTrue();
        mvc.perform(admin(post("/admin-api/mcp/gateway-credential").content("{\"ownerTenantId\":\"999\"}"))).andExpect(status().isBadRequest());
        JsonNode issued = send(admin(post("/admin-api/mcp/gateway-credential").content("{}")));
        String id = issued.at("/credential/id").asText();
        String keyId = issued.get("keyId").asText();
        String secret = issued.get("signingSecret").asText();
        assertThat(keyId).matches("[a-f0-9]{32}");
        assertThat(secret).matches("[A-Za-z0-9_-]{43}");
        assertThat(issued.at("/credential/key/keyId").asText()).isEqualTo(keyId);
        mvc.perform(admin(post("/admin-api/mcp/gateway-credential").content("{}"))).andExpect(status().isConflict());

        String overview = mvc.perform(admin(get("/admin-api/mcp/gateway-credential")))
                .andExpect(header().string("Cache-Control", "no-store")).andReturn().getResponse().getContentAsString();
        assertThat(overview).contains(keyId).doesNotContain(secret, "signingSecret", "secretDigest");
        // 普通凭据管理看不到、改不了网关凭据。
        assertThat(mvc.perform(admin(get("/admin-api/applications"))).andReturn().getResponse().getContentAsString()).doesNotContain(id);
        mvc.perform(admin(get("/admin-api/applications/" + id))).andExpect(status().isNotFound());
        mvc.perform(admin(get("/admin-api/applications/" + id + "/signing-key"))).andExpect(status().isNotFound());
        mvc.perform(admin(post("/admin-api/applications/" + id + "/signing-key/revoke").content("{\"expectedRevision\":1}")))
                .andExpect(status().isNotFound());
        mvc.perform(admin(post("/admin-api/applications/" + id + "/secret/rotate").content("{}"))).andExpect(status().isNotFound());

        var original = keys.findByKeyId(keyId).orElseThrow();
        mvc.perform(admin(post("/admin-api/mcp/gateway-credential/rotate").content("{\"expectedRevision\":0}"))).andExpect(status().isConflict());
        JsonNode rotated = send(admin(post("/admin-api/mcp/gateway-credential/rotate").content("{\"expectedRevision\":1}")));
        assertThat(rotated.get("keyId").asText()).isNotEqualTo(keyId);
        assertThat(rotated.get("signingSecret").asText()).isNotEqualTo(secret);
        assertThat(keys.findByKeyId(keyId)).isEmpty();
        assertThat(catchThrowable(() -> signingKeys.requireSecret(original))).isInstanceOf(PlatformException.class);
        var current = keys.findByKeyId(rotated.get("keyId").asText()).orElseThrow();
        assertThat(gateways.requireActiveGateway(current).id()).isEqualTo(id);

        assertThat(send(admin(put("/admin-api/mcp/gateway-credential/status").content("{\"enabled\":false}"))).get("status").asText()).isEqualTo("DISABLED");
        assertThat(errorOf(catchThrowable(() -> gateways.requireActiveGateway(current)))).isEqualTo(ErrorCode.FORBIDDEN);
        send(admin(put("/admin-api/mcp/gateway-credential/status").content("{\"enabled\":true}")));
        assertThat(gateways.requireActiveGateway(current).id()).isEqualTo(id);

        String audit = mvc.perform(admin(get("/admin-api/applications/" + id + "/audit"))).andReturn().getResponse().getContentAsString();
        assertThat(audit).contains("CREATE_MCP_GATEWAY_CREDENTIAL", "CREATE_SIGNING_KEY", "ROTATE_SIGNING_KEY", "SET_MCP_GATEWAY_STATUS")
                .doesNotContain(secret);
        mvc.perform(get("/admin-api/mcp/gateway-credential").session(io.github.chenyilei2016.openplatform.testing.TestSessions.session("other-session"))).andExpect(status().isForbidden());
    }

    @Test
    void portalActivationUsesSessionTenantAndPlatformDisableLocksTenantSelfService() throws Exception {
        assertThat(send(other(get("/portal-api/mcp/activation"))).isNull()).isTrue();
        mvc.perform(other(post("/portal-api/mcp/activation").content("{\"tenantId\":\"101\"}"))).andExpect(status().isBadRequest());
        JsonNode opened = send(other(post("/portal-api/mcp/activation").content("{}")));
        String id = opened.get("id").asText();
        assertThat(opened.get("tenantId").asText()).isEqualTo("102");
        assertThat(opened.get("keyCode").asText()).matches("MCP_[0-9A-F]{16}");
        assertThat(opened.get("status").asText()).isEqualTo("ENABLED");
        assertThat(opened.get("activatedByEmployeeNo").asText()).isEqualTo("operator-2");
        assertThat(activations.activeTenantActivation("102")).isPresent();
        assertThat(activations.activeTenantActivation("101")).isEmpty();
        mvc.perform(other(post("/portal-api/mcp/activation"))).andExpect(status().isConflict());
        // 其他租户看不到、改不到。
        assertThat(send(portal(get("/portal-api/mcp/activation"))).isNull()).isTrue();
        mvc.perform(portal(put("/portal-api/mcp/activation/status").content("{\"enabled\":false}"))).andExpect(status().isNotFound());
        mvc.perform(other(put("/portal-api/mcp/activation/status").content("{\"enabled\":false,\"tenantId\":\"101\"}"))).andExpect(status().isBadRequest());

        assertThat(send(other(put("/portal-api/mcp/activation/status").content("{\"enabled\":false}"))).get("status").asText()).isEqualTo("DISABLED");
        assertThat(activations.activeTenantActivation("102")).isEmpty();
        send(other(put("/portal-api/mcp/activation/status").content("{\"enabled\":true}")));
        assertThat(activations.activeTenantActivation("102")).isPresent();

        JsonNode listed = send(admin(get("/admin-api/mcp/tenant-activations").param("tenantId", "102")));
        assertThat(listed.get("total").asLong()).isEqualTo(1);
        assertThat(listed.at("/items/0/id").asText()).isEqualTo(id);
        JsonNode disabled = send(admin(put("/admin-api/mcp/tenant-activations/" + id + "/status").content("{\"enabled\":false}")));
        assertThat(disabled.get("disabledByPlatform").asBoolean()).isTrue();
        mvc.perform(other(put("/portal-api/mcp/activation/status").content("{\"enabled\":true}"))).andExpect(status().isConflict());
        assertThat(activations.activeTenantActivation("102")).isEmpty();
        assertThat(send(admin(get("/admin-api/mcp/tenant-activations").param("status", "DISABLED"))).at("/items/0/id").asText()).isEqualTo(id);
        send(admin(put("/admin-api/mcp/tenant-activations/" + id + "/status").content("{\"enabled\":true}")));
        assertThat(activations.activeTenantActivation("102")).isPresent();
        mvc.perform(plain(get("/admin-api/mcp/tenant-activations"))).andExpect(status().isForbidden());
    }

    @Test
    void concurrentActivationOfOneTenantSucceedsExactlyOnce() throws Exception {
        int attempts = 6;
        CountDownLatch start = new CountDownLatch(1);
        List<Future<Throwable>> results = new ArrayList<>();
        try (ExecutorService pool = Executors.newFixedThreadPool(attempts)) {
            for (int index = 0; index < attempts; index++) {
                AccessOperator operator = new AccessOperator("103", "employee-" + index, "mcp-concurrency-" + index, null, null);
                results.add(pool.submit(() -> {
                    start.await();
                    return catchThrowable(() -> activations.open(operator));
                }));
            }
            start.countDown();
            int succeeded = 0;
            for (Future<Throwable> result : results) {
                Throwable failure = result.get();
                if (failure == null) succeeded++;
                else assertThat(errorOf(failure)).isEqualTo(ErrorCode.CONFLICT);
            }
            assertThat(succeeded).isEqualTo(1);
        }
        assertThat(activations.activeTenantActivation("103")).isPresent();
    }

    private static ErrorCode errorOf(Throwable failure) {
        assertThat(failure).isInstanceOf(PlatformException.class);
        return ((PlatformException) failure).getErrorCode();
    }

    private JsonNode send(MockHttpServletRequestBuilder request) throws Exception {
        String body = mvc.perform(request).andExpect(status().isOk()).andExpect(jsonPath("$.code").value(200))
                .andReturn().getResponse().getContentAsString();
        return json.readTree(body).get("data");
    }

    private MockHttpServletRequestBuilder admin(MockHttpServletRequestBuilder request) {
        return request.session(io.github.chenyilei2016.openplatform.testing.TestSessions.session("test-session")).header("X-CSRF-Token", "76832d7fdbcdbf4a72129f8b7def9016").contentType("application/json");
    }

    /** 租户 101 的门户员工（同时是管理员，门户接口只取其会话租户）。 */
    private MockHttpServletRequestBuilder portal(MockHttpServletRequestBuilder request) {
        return admin(request);
    }

    private MockHttpServletRequestBuilder other(MockHttpServletRequestBuilder request) {
        return request.session(io.github.chenyilei2016.openplatform.testing.TestSessions.session("other-session")).header("X-CSRF-Token", "5cad80ad570259209f805583acd4e8b0").contentType("application/json");
    }

    private MockHttpServletRequestBuilder plain(MockHttpServletRequestBuilder request) {
        return request.session(io.github.chenyilei2016.openplatform.testing.TestSessions.session("plain-session")).contentType("application/json");
    }
}
