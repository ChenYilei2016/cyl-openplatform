package io.github.chenyilei2016.openplatform.connection;

import io.github.chenyilei2016.openplatform.domain.connection.DubboConnection;
import io.github.chenyilei2016.openplatform.domain.connection.DubboConnectionRepository;
import io.github.chenyilei2016.openplatform.infrastructure.connection.runtime.ManagedDubboConnectionRuntime;

import io.github.chenyilei2016.openplatform.application.identity.AccountAuthentication;
import io.github.chenyilei2016.openplatform.testing.TestAccount;
import jakarta.servlet.http.Cookie;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.webmvc.test.autoconfigure.MockMvcPrint;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.util.DigestUtils;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@io.github.chenyilei2016.openplatform.testing.TestAdministrators
@SpringBootTest(properties = {
        "spring.sql.init.schema-locations=classpath:db/access-schema.sql,classpath:db/mcp-schema.sql,classpath:db/catalog-schema.sql,classpath:db/token-schema.sql,classpath:db/publication-schema.sql,classpath:db/governance-schema.sql,classpath:db/observability-schema.sql,classpath:db/operations-metrics-schema.sql,classpath:db/environment-release-transfer-schema.sql,classpath:db/environment-release-receipt-schema.sql,classpath:db/sdk-asset-schema.sql,classpath:db/operations-alert-schema.sql,classpath:db/signature-schema.sql,classpath:db/dubbo-connection-schema.sql,classpath:db/administrator-schema.sql",
        "open-platform.environment-release.environment-id=connection-test",
        "test.admin.operators[0].tenant-id=tenant-1", "test.admin.operators[0].employee-no=manager",
        "test.admin.operators[0].permissions[0]=MANAGE_CONNECTIONS", "test.admin.operators[0].permissions[1]=VIEW_AUDIT",
        "test.admin.operators[1].tenant-id=tenant-1", "test.admin.operators[1].employee-no=author",
        "test.admin.operators[1].permissions[0]=MANAGE_APIS",
        "open-platform.dubbo-connections.credentials.nacos.username=test-user",
        "open-platform.dubbo-connections.credentials.nacos.password=private-nacos-password"
})
@AutoConfigureMockMvc(print = MockMvcPrint.NONE)
class DubboConnectionHttpTest {
    private static final String PATH = "/admin-api/dubbo-connections";
    @Autowired MockMvc mvc;
    @MockitoBean AccountAuthentication login;
    @MockitoBean ManagedDubboConnectionRuntime runtime;
    @MockitoSpyBean DubboConnectionRepository repository;
    private final JsonMapper json = JsonMapper.builder().build();

    @BeforeEach
    void identities() {
        TestAccount manager = new TestAccount();
        manager.setId(101L); manager.setTenantId("tenant-1"); manager.setEmployeeNoStr("manager");
        TestAccount author = new TestAccount();
        author.setId(102L); author.setTenantId("tenant-1"); author.setEmployeeNoStr("author");
        when(login.current("test-session")).thenAnswer(invocation -> manager.toAccount());
        when(login.current("author-session")).thenAnswer(invocation -> author.toAccount());
    }

    @Test
    void authorReadsOnlyCurrentEnvironmentSafeSummariesAndCannotManageConfiguration() throws Exception {
        mvc.perform(get(PATH + "/options")).andExpect(status().isUnauthorized());
        ObjectNode request = createRequest();
        JsonNode created = send(post(PATH).content(request.toString()));
        String id = created.at("/connection/id").asText();
        assertThat(id).matches("CON_[0-9a-f]{32}");
        assertThat(created.at("/connection/environmentId").asText()).isEqualTo("connection-test");
        String header = mvc.perform(as("author-session", get(PATH + "/" + id + "/summary")))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        assertThat(json.readTree(header).at("/data/id").asText()).isEqualTo(id);
        assertThat(header).doesNotContain("registry.example", "credentialRef", "private-nacos-password", "config");
        org.mockito.Mockito.verify(runtime, org.mockito.Mockito.never()).warmup(anyString(), anyLong());
        mvc.perform(get(PATH + "/" + id + "/summary")).andExpect(status().isUnauthorized());
        mvc.perform(as("author-session", get(PATH + "/" + id))).andExpect(status().isForbidden());
        mvc.perform(as("author-session", get(PATH + "/configuration"))).andExpect(status().isForbidden());
        mvc.perform(as("author-session", post(PATH).content(request.toString()))).andExpect(status().isForbidden());
        mvc.perform(post(PATH).session(io.github.chenyilei2016.openplatform.testing.TestSessions.session("test-session")).contentType("application/json").content(request.toString()))
                .andExpect(status().isForbidden());
        String options = mvc.perform(as("author-session", get(PATH))).andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        assertThat(options).doesNotContain("registry.example", "metadata.example", "credentialRef", "private-nacos-password", "test-only-provider");
        // 无对应管理入口时仍经默认权限保护；不为404测试放宽未映射路由。
        mvc.perform(as("author-session", get(PATH + "/" + id + "/services").param("revision", "1"))).andExpect(status().isForbidden());
        mvc.perform(as("author-session", get(PATH + "/" + id + "/methods").param("revision", "1").param("interfaceName", "com.example.OrderService"))).andExpect(status().isForbidden());
        mvc.perform(as("author-session", get(PATH + "/" + id + "/revisions/1"))).andExpect(status().isForbidden());
        String configuration = send(get(PATH + "/configuration")).toString();
        assertThat(configuration).contains("connection-test", "nacos").doesNotContain("private-nacos-password", "test-only-provider");
        String foreign = UUID.randomUUID().toString();
        repository.create(new DubboConnection(foreign, "other environment", "another", "", 1, null, true, 1, Instant.now()));
        mvc.perform(as("test-session", get(PATH + "/" + foreign))).andExpect(status().isNotFound());
        mvc.perform(as("author-session", get(PATH + "/" + foreign + "/summary"))).andExpect(status().isNotFound());
        assertThat(send(get(PATH).param("query", "other environment")).get("total").asLong()).isZero();
        request.put("environmentId", "another");
        mvc.perform(as("test-session", post(PATH).content(request.toString()))).andExpect(status().isBadRequest());
    }

    @Test
    void immutableDraftsActivationAndGlobalDisableUseIndependentCompareAndSetState() throws Exception {
        ObjectNode request = createRequest();
        JsonNode first = send(post(PATH).content(request.toString()));
        String id = first.at("/connection/id").asText();
        assertThat(first.at("/connection/activeRevision").isNull()).isTrue();
        assertThat(send(get(PATH + "/options").param("query", request.get("name").asText())).get("total").asLong()).isZero();
        send(post(PATH + "/" + id + "/activate").content("{\"expectedStateVersion\":1,\"revision\":1}"));
        verify(runtime).warmup(id, 1);
        request.put("expectedStateVersion", 2);
        ((ObjectNode) request.at("/config/registry")).put("namespace", "next-namespace");
        ((ObjectNode) request.get("config")).set("metadata", json.readTree("{\"type\":\"REDIS\",\"address\":\"redis://metadata.example:6379\",\"group\":\"metadata\",\"database\":1}"));
        ((ObjectNode) request.get("config")).put("discoveryMode", "APPLICATION").put("providerMetadataMode", "REMOTE");
        JsonNode saved = send(put(PATH + "/" + id + "/draft").content(request.toString()));
        assertThat(saved.at("/connection/draftRevision").asLong()).isEqualTo(2);
        assertThat(saved.at("/connection/activeRevision").asLong()).isEqualTo(1);
        assertThat(saved.at("/active/config/registry/namespace").asText()).isEqualTo("test");
        assertThat(saved.at("/draft/config/registry/namespace").asText()).isEqualTo("next-namespace");
        JsonNode summary = send(get(PATH).param("query", request.get("name").asText())).at("/items/0");
        assertThat(summary.get("metadataType").asText()).isEqualTo("NONE");
        assertThat(summary.get("discoveryMode").asText()).isEqualTo("INTERFACE");
        assertThat(summary.get("providerMetadataMode").asText()).isEqualTo("LOCAL");
        mvc.perform(as("test-session", put(PATH + "/" + id + "/draft").content(request.toString()))).andExpect(status().isConflict());
        send(put(PATH + "/" + id + "/status").content("{\"expectedStateVersion\":3,\"enabled\":false}"));
        JsonNode activated = send(post(PATH + "/" + id + "/activate").content("{\"expectedStateVersion\":4,\"revision\":2}"));
        assertThat(activated.at("/connection/enabled").asBoolean()).isFalse();
        assertThat(activated.at("/connection/activeRevision").asLong()).isEqualTo(2);
        verify(runtime, never()).warmup(id, 2);
        JsonNode changedSummary = send(get(PATH).param("query", request.get("name").asText())).at("/items/0");
        assertThat(changedSummary.get("metadataType").asText()).isEqualTo("REDIS");
        assertThat(changedSummary.get("discoveryMode").asText()).isEqualTo("APPLICATION");
        assertThat(changedSummary.get("providerMetadataMode").asText()).isEqualTo("REMOTE");
        assertThat(send(get(PATH + "/options").param("query", request.get("name").asText())).get("total").asLong()).isZero();
        assertThat(send(get(PATH + "/" + id + "/revisions/1")).at("/config/registry/namespace").asText()).isEqualTo("test");
        JsonNode history = send(get(PATH + "/" + id + "/revisions").param("pageSize", "1"));
        assertThat(history.get("total").asLong()).isEqualTo(2);
        assertThat(history.at("/items/0/revision").asLong()).isEqualTo(2);
        assertThat(history.toString()).doesNotContain("config", "registry.example");
        JsonNode restored = send(put(PATH + "/" + id + "/status").content("{\"expectedStateVersion\":5,\"enabled\":true}"));
        assertThat(restored.at("/connection/activeRevision").asLong()).isEqualTo(2);
        assertThat(send(get(PATH + "/options").param("query", request.get("name").asText())).get("total").asLong()).isEqualTo(1);
    }

    @Test
    void acceptsUnlistedEndpointsAndRejectsMalformedConfiguration() throws Exception {
        for (String endpoint : List.of("nacos://user:password@registry.example:8848", "nacos://registry.example:8848?namespace=other")) {
            ObjectNode body = createRequest(); ((ObjectNode) body.at("/config/registry")).put("address", endpoint);
            mvc.perform(as("test-session", post(PATH).content(body.toString()))).andExpect(status().isBadRequest());
        }
        ObjectNode missing = createRequest(); ((ObjectNode) missing.at("/config/registry")).put("credentialRef", "unknown");
        mvc.perform(as("test-session", post(PATH).content(missing.toString()))).andExpect(status().isBadRequest());
        ObjectNode noMetadata = createRequest(); ((ObjectNode) noMetadata.get("config")).put("discoveryMode", "APPLICATION");
        mvc.perform(as("test-session", post(PATH).content(noMetadata.toString()))).andExpect(status().isBadRequest());
        for (String number : List.of("1.5", "\"1\"", "-1", "2147483648")) {
            ObjectNode body = createRequest();
            ((ObjectNode) body.get("config")).set("metadata", json.readTree("{\"type\":\"REDIS\",\"address\":\"redis://metadata.example:6379\",\"group\":\"metadata\",\"database\":" + number + "}"));
            mvc.perform(as("test-session", post(PATH).content(body.toString()))).andExpect(status().isBadRequest());
        }
        ObjectNode unlisted = createRequest();
        ((ObjectNode) unlisted.at("/config/registry")).put("address", "nacos://another.example:8848");
        JsonNode accepted = send(post(PATH).content(unlisted.toString()));
        assertThat(accepted.at("/draft/config").has("allowedServices")).isFalse();
        mvc.perform(as("test-session", get(PATH).param("pageSize", "101"))).andExpect(status().isBadRequest());
        mvc.perform(as("test-session", get(PATH).param("page", "100002").param("pageSize", "1"))).andExpect(status().isBadRequest());
    }

    @Test
    void aFailedRevisionInsertRollsBackHeaderAndRecordsOnlyFailureAudit() throws Exception {
        ObjectNode body = createRequest();
        doThrow(new DataIntegrityViolationException("injected revision conflict")).when(repository).insertRevision(any());
        String requestId = mvc.perform(as("test-session", post(PATH).content(body.toString())))
                .andExpect(status().isConflict()).andReturn().getResponse().getHeader("X-Request-Id");
        assertThat(send(get(PATH).param("query", body.get("name").asText())).get("total").asLong()).isZero();
        JsonNode audits = send(get("/admin-api/observability/audits").param("requestId", requestId));
        assertThat(audits.get("total").asLong()).isEqualTo(1);
        assertThat(audits.at("/items/0/outcome").asText()).isEqualTo("FAILURE");
        assertThat(audits.toString()).doesNotContain("injected revision conflict", "private-nacos-password");
    }

    private ObjectNode createRequest() {
        ObjectNode body = (ObjectNode) json.readTree("""
                {"name":"测试连接","description":"登记与检查分开", "config":{
                 "registry":{"address":"nacos://registry.example:8848","namespace":"test","group":"TEST","credentialRef":"nacos"},
                 "metadata":{"type":"NONE"},"discoveryMode":"INTERFACE","providerMetadataMode":"LOCAL"}}
                """);
        body.put("name", "连接-" + UUID.randomUUID());
        return body;
    }

    private MockHttpServletRequestBuilder as(String cookie, MockHttpServletRequestBuilder request) {
        return request.session(io.github.chenyilei2016.openplatform.testing.TestSessions.session(cookie)).header("X-CSRF-Token",
                DigestUtils.md5DigestAsHex(cookie.getBytes(StandardCharsets.UTF_8))).contentType("application/json");
    }

    private JsonNode send(MockHttpServletRequestBuilder request) throws Exception {
        String response = mvc.perform(as("test-session", request)).andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        return json.readTree(response).get("data");
    }
}
