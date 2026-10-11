package io.github.chenyilei2016.openplatform.debug;


import io.github.chenyilei2016.openplatform.application.identity.AccountAuthentication;
import io.github.chenyilei2016.openplatform.testing.TestAccount;
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

import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@io.github.chenyilei2016.openplatform.testing.TestAdministrators
@SpringBootTest(properties = {
        "spring.sql.init.schema-locations=classpath:db/access-schema.sql,classpath:db/mcp-schema.sql,classpath:db/catalog-schema.sql,classpath:db/dubbo-connection-schema.sql,classpath:db/token-schema.sql,classpath:db/publication-schema.sql,classpath:db/governance-schema.sql,classpath:db/observability-schema.sql,classpath:db/operations-metrics-schema.sql",

        "test.admin.operators[0].tenant-id=tenant-1",
        "test.admin.operators[0].employee-no=author",
        "test.admin.operators[0].permissions[0]=MANAGE_APIS",
        "test.admin.operators[1].tenant-id=tenant-1",
        "test.admin.operators[1].employee-no=viewer",
        "test.admin.operators[1].permissions[0]=VIEW_AUDIT"
})
@AutoConfigureMockMvc(print = MockMvcPrint.NONE)
@org.springframework.context.annotation.Import(io.github.chenyilei2016.openplatform.testing.CatalogReferenceFixture.class)
class DebugManagementHttpTest {
    @Autowired MockMvc mvc;
    @MockitoBean AccountAuthentication identityService;

    @MockitoBean io.github.chenyilei2016.openplatform.application.token.TokenVerifier tokens;
    @MockitoBean io.github.chenyilei2016.openplatform.domain.access.ScopeRepository scopes;
    @MockitoBean io.github.chenyilei2016.openplatform.domain.governance.GovernanceGuard governance;
    @MockitoBean io.github.chenyilei2016.openplatform.application.observability.ObservationService observations;

    @BeforeEach
    void login() {
        TestAccount user = new TestAccount();
        user.setId(11L); user.setTenantId("tenant-1"); user.setEmployeeNoStr("author");
        when(identityService.current("test-session")).thenAnswer(invocation -> user.toAccount());
        TestAccount viewer = new TestAccount();
        viewer.setId(12L); viewer.setTenantId("tenant-1"); viewer.setEmployeeNoStr("viewer");
        when(identityService.current("viewer-session")).thenAnswer(invocation -> viewer.toAccount());
    }

    @Test
    void debugRequiresManagementPermissionCsrfAndExplicitBusinessToken() throws Exception {
        mvc.perform(post("/admin-api/apis/missing/debug").contentType("application/json")
                .content("{\"expectedRevision\":1,\"input\":{}}"))
                .andExpect(status().isUnauthorized());
        mvc.perform(debug().session(io.github.chenyilei2016.openplatform.testing.TestSessions.session("viewer-session")))
                .andExpect(status().isForbidden());
        mvc.perform(post("/admin-api/apis/missing/debug").session(io.github.chenyilei2016.openplatform.testing.TestSessions.session("test-session"))
                .contentType("application/json").content("{\"expectedRevision\":1,\"input\":{}}"))
                .andExpect(status().isForbidden());
        mvc.perform(debug().session(io.github.chenyilei2016.openplatform.testing.TestSessions.session("test-session")))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void debugRejectsUnknownFieldsInvalidRevisionsIdentityHeadersAndOversizeBeforeCallingProvider() throws Exception {
        for (String body : new String[]{
                "{\"expectedRevision\":1,\"input\":{},\"tenantId\":\"202\"}",
                "{\"expectedRevision\":0,\"input\":{}}",
                "{\"expectedRevision\":1.5,\"input\":{}}",
                "{\"expectedRevision\":1.0,\"input\":{}}",
                "{\"expectedRevision\":9223372036854775808,\"input\":{}}",
                "{\"expectedRevision\":\"1\",\"input\":{}}",
                "{\"expectedRevision\":1,\"input\":[]}",
                "{\"expectedRevision\":1,\"input\":{},\"input\":{}}",
                "{\"expectedRevision\":1,\"input\":{}} {}"}) {
            mvc.perform(debug().session(io.github.chenyilei2016.openplatform.testing.TestSessions.session("test-session"))
                    .header("Authorization", "Bearer unusable-token").content(body))
                    .andExpect(status().isBadRequest());
        }
        mvc.perform(debug().session(io.github.chenyilei2016.openplatform.testing.TestSessions.session("test-session"))
                .header("Authorization", "Bearer unusable-token").header("X-Tenant-Id", "202"))
                .andExpect(status().isBadRequest());
        mvc.perform(debug().session(io.github.chenyilei2016.openplatform.testing.TestSessions.session("test-session"))
                .header("Authorization", "Bearer unusable-token").content(" ".repeat(65_537)))
                .andExpect(status().isPayloadTooLarge());
    }


    @Autowired tools.jackson.databind.json.JsonMapper json;
    @MockitoBean io.github.chenyilei2016.openplatform.domain.runtime.HttpApiInvoker http;
    @MockitoBean io.github.chenyilei2016.openplatform.domain.runtime.DubboApiInvoker dubbo;

    @Test
    void responsePreviewIsOfflineProjectsFieldsAndPreservesPreciseNumbersAndNull() throws Exception {
        String schema = """
                {"type":"OBJECT","properties":{"amount":{"type":"NUMBER","required":true},
                 "optional":{"type":"STRING"},"empty":{"type":"STRING","nullable":true,"required":true}}}
                """;
        tools.jackson.databind.JsonNode result = preview("{\"mode\":\"ENVELOPE\",\"successPath\":\"code\",\"successValues\":[0],\"dataPath\":\"data\"}", schema,
                "{\"code\":0.0,\"token\":\"private-token-value\",\"X-Open-Platform-Signature\":\"private-proof-value\",\"data\":{\"amount\":9007199254740993.0000000000000000001,\"empty\":null,\"internal\":\"never-public\"}}");
        org.assertj.core.api.Assertions.assertThat(result.path("succeeded").asBoolean()).isTrue();
        org.assertj.core.api.Assertions.assertThat(result.at("/publicResponse/value/data/amount").decimalValue())
                .isEqualByComparingTo("9007199254740993.0000000000000000001");
        org.assertj.core.api.Assertions.assertThat(result.at("/publicResponse/value/data").has("optional")).isFalse();
        org.assertj.core.api.Assertions.assertThat(result.at("/publicResponse/value/data").has("internal")).isFalse();
        org.assertj.core.api.Assertions.assertThat(result.at("/publicResponse/value/data/empty").isNull()).isTrue();
        org.assertj.core.api.Assertions.assertThat(result.at("/warnings/0/reason").asText()).isEqualTo("FIELD_PROJECTED");
        org.assertj.core.api.Assertions.assertThat(result.toString()).doesNotContain("private-token-value", "private-proof-value");
        org.assertj.core.api.Assertions.assertThat(preview("{\"mode\":\"DIRECT\"}",
                "{\"type\":\"OBJECT\",\"properties\":{\"a\":{\"type\":\"NUMBER\"}},\"enumValues\":[{\"a\":1}]}",
                "{\"a\":1.0,\"private\":2}").path("succeeded").asBoolean()).isTrue();
        org.mockito.Mockito.verifyNoInteractions(http, dubbo);
    }

    @Test
    void responsePreviewDistinguishesBusinessExtractionAndSchemaFailures() throws Exception {
        String adapter = "{\"mode\":\"ENVELOPE\",\"successPath\":\"code\",\"successValues\":[0],\"dataPath\":\"data\",\"messagePath\":\"message\"}";
        String schema = "{\"type\":\"OBJECT\",\"properties\":{\"name\":{\"type\":\"STRING\",\"required\":true}}}";
        String[][] cases = {
            {"{}", "PATH_MISSING", "$.code"},
            {"{\"code\":null}", "NULL_NOT_ALLOWED", "$.code"},
            {"{\"code\":\"0\"}", "TYPE_MISMATCH", "$.code"},
            {"{\"code\":1}", "PROVIDER_BUSINESS_REJECTED", "$.code"},
            {"{\"code\":0}", "PATH_MISSING", "$.data"},
            {"{\"code\":0,\"data\":null}", "NULL_NOT_ALLOWED", "$"},
            {"{\"code\":0,\"data\":{}}", "REQUIRED_MISSING", "$.name"},
            {"{\"code\":0,\"data\":{\"name\":12}}", "TYPE_MISMATCH", "$.name"}
        };
        for (String[] item : cases) {
            tools.jackson.databind.JsonNode result = preview(adapter, schema, item[0]);
            org.assertj.core.api.Assertions.assertThat(result.at("/issue/reason").asText()).isEqualTo(item[1]);
            org.assertj.core.api.Assertions.assertThat(result.at("/issue/path").asText()).isEqualTo(item[2]);
        }
        tools.jackson.databind.JsonNode rejected = preview(adapter, schema, "{\"code\":1,\"message\":\"password=hidden业务消息\"}");
        org.assertj.core.api.Assertions.assertThat(rejected.at("/publicResponse/value/code").asInt()).isEqualTo(50200002);
        org.assertj.core.api.Assertions.assertThat(rejected.at("/publicResponse/value/resultMsg").asText()).isEqualTo("提供方业务拒绝");
        org.assertj.core.api.Assertions.assertThat(rejected.toString()).doesNotContain("hidden业务消息");
        org.assertj.core.api.Assertions.assertThat(preview(adapter, schema, "{\"code\":1,\"message\":23}").at("/warnings/0/reason").asText()).isEqualTo("MESSAGE_UNAVAILABLE");
    }

    @Test
    void responsePreviewSeparatesRuntimeArrayLimitsAndValidatesRuleBeforeCallingProvider() throws Exception {
        String array = "[" + String.join(",", java.util.Collections.nCopies(250, "1")) + "]";
        org.assertj.core.api.Assertions.assertThat(preview("{\"mode\":\"DIRECT\"}", "{\"type\":\"ARRAY\",\"items\":{\"type\":\"INTEGER\"}}", array)
                .at("/publicResponse/value/data").size()).isEqualTo(250);
        String deep = "1";
        for (int i = 0; i < 33; i++) deep = "[" + deep + "]";
        org.assertj.core.api.Assertions.assertThat(preview("{\"mode\":\"DIRECT\"}", "{\"type\":\"NUMBER\"}", deep)
                .at("/issue/reason").asText()).isEqualTo("LIMIT_EXCEEDED");
        for (String adapter : java.util.List.of(
                "{\"mode\":\"DIRECT\",\"dataPath\":\"data\"}",
                "{\"mode\":\"ENVELOPE\",\"successPath\":\"code\",\"successValues\":[0,\"0\"],\"dataPath\":\"data\"}",
                "{\"mode\":\"ENVELOPE\",\"successPath\":\"code\",\"successValues\":[null],\"dataPath\":\"data\"}")) {
            mvc.perform(previewRequest("{\"responseAdapter\":" + adapter + ",\"responseSchema\":{\"type\":\"STRING\"},\"sample\":null}"))
                    .andExpect(status().isBadRequest());
        }
        mvc.perform(post("/admin-api/apis/response-preview").contentType("application/json").content("{}"))
                .andExpect(status().isUnauthorized());
        org.mockito.Mockito.verifyNoInteractions(http, dubbo);
    }

    private tools.jackson.databind.JsonNode preview(String adapter, String schema, String sample) throws Exception {
        String response = mvc.perform(previewRequest("{\"responseAdapter\":" + adapter + ",\"responseSchema\":" + schema + ",\"sample\":" + sample + "}"))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        return json.readTree(response).get("data");
    }
    private MockHttpServletRequestBuilder previewRequest(String body) {
        return post("/admin-api/apis/response-preview").session(io.github.chenyilei2016.openplatform.testing.TestSessions.session("test-session"))
                .header("X-CSRF-Token", "76832d7fdbcdbf4a72129f8b7def9016").contentType("application/json").content(body);
    }


    @Test
    void preflightChecksAllInputsAndMappingWithoutCallingProviderOrQuota() throws Exception {
        String id = apiForDebug();
        tools.jackson.databind.JsonNode invalid = debugData(id, true, "{}");
        org.assertj.core.api.Assertions.assertThat(invalid.at("/checks/1/status").asText()).isEqualTo("FAILED");
        org.assertj.core.api.Assertions.assertThat(invalid.at("/checks/1/issues").size()).isEqualTo(2);
        org.assertj.core.api.Assertions.assertThat(invalid.at("/mappedInput/available").asBoolean()).isFalse();
        tools.jackson.databind.JsonNode ready = debugData(id, true, "{\"count\":7,\"label\":\"demo\"}");
        org.assertj.core.api.Assertions.assertThat(ready.path("outcome").asText()).isEqualTo("SUCCEEDED");
        org.assertj.core.api.Assertions.assertThat(ready.path("providerDispatch").asText()).isEqualTo("NOT_SENT");
        org.assertj.core.api.Assertions.assertThat(ready.at("/mappedInput/value/body/tenantId").asText()).isEqualTo("tenant-1");
        org.assertj.core.api.Assertions.assertThat(ready.at("/mappedInput/redacted").asBoolean()).isTrue();
        org.assertj.core.api.Assertions.assertThat(ready.toString()).doesNotContain("mapped-private-secret");
        org.assertj.core.api.Assertions.assertThat(ready.at("/publicResponse/available").asBoolean()).isFalse();
        org.mockito.Mockito.verifyNoInteractions(http, dubbo, governance, observations);
        when(tokens.verify("valid-token")).thenThrow(new io.github.chenyilei2016.openplatform.domain.common.PlatformException(
                io.github.chenyilei2016.openplatform.domain.common.ErrorCode.INVALID_TOKEN, "Token无效或已失效"));
        mvc.perform(executionRequest(id, false, "{\"count\":7,\"label\":\"demo\"}")).andExpect(status().isUnauthorized());
        org.mockito.Mockito.verifyNoInteractions(http, dubbo, governance);
    }

    @Test
    void executionPreservesPrivateRawStructureAndRecordsFailureDespiteManagementHttp200() throws Exception {
        String id = apiForDebug();
        Object raw = json.readValue("{\"code\":0,\"data\":{\"count\":\"wrong-type\",\"accessToken\":\"provider-private-token\"}}", Object.class);
        when(http.invoke(org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.anyString())).thenReturn(raw);
        tools.jackson.databind.JsonNode result = debugData(id, false, "{\"count\":9007199254740993,\"label\":\"demo\"}");
        org.assertj.core.api.Assertions.assertThat(result.path("outcome").asText()).isEqualTo("FAILED");
        org.assertj.core.api.Assertions.assertThat(result.path("providerDispatch").asText()).isEqualTo("SENT");
        org.assertj.core.api.Assertions.assertThat(result.at("/providerResponse/value/data/count").asText()).isEqualTo("wrong-type");
        org.assertj.core.api.Assertions.assertThat(result.at("/adaptedData/available").asBoolean()).isTrue();
        org.assertj.core.api.Assertions.assertThat(result.at("/checks/7/issues/0/path").asText()).isEqualTo("$.count");
        org.assertj.core.api.Assertions.assertThat(result.at("/publicResponse/value/code").asInt()).isEqualTo(50200001);
        org.assertj.core.api.Assertions.assertThat(result.toString()).doesNotContain("provider-private-token", "mapped-private-secret");
        org.assertj.core.api.Assertions.assertThat(result.at("/mappedInput/value/body/count").asText()).isEqualTo("9007199254740993");
        org.mockito.Mockito.verify(observations).record(org.mockito.ArgumentMatchers.argThat(record -> record.httpStatus() == 200
                && "FAILURE".equals(record.outcome()) && record.errorCode() == 50200001));
    }

    @Test
    void successfulPublicDiagnosticRedactsWrappedDataWithoutLosingPrecision() throws Exception {
        String id = apiForDebug();
        when(http.invoke(org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.anyString()))
                .thenReturn(java.util.Map.of("code", 0, "data", java.util.Map.of("count", new java.math.BigInteger("9007199254740993"), "accessToken", "never-display-me")));
        tools.jackson.databind.JsonNode result = debugData(id, false, "{\"count\":7,\"label\":\"demo\"}");
        org.assertj.core.api.Assertions.assertThat(result.path("outcome").asText()).isEqualTo("SUCCEEDED");
        org.assertj.core.api.Assertions.assertThat(result.at("/publicResponse/redacted").asBoolean()).isTrue();
        org.assertj.core.api.Assertions.assertThat(result.at("/publicResponse/value/data/count").asText()).isEqualTo("9007199254740993");
        org.assertj.core.api.Assertions.assertThat(result.toString()).doesNotContain("never-display-me");
    }

    @Test
    void sdkRejectionTimeoutAndBusinessFailureAreDifferentAndContentIsBounded() throws Exception {
        String id = apiForDebug();
        when(http.invoke(org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.anyString()))
                .thenThrow(new io.github.chenyilei2016.openplatform.domain.runtime.ProviderCallFailure(io.github.chenyilei2016.openplatform.domain.common.ErrorCode.FORBIDDEN,
                        "提供方拒绝", io.github.chenyilei2016.openplatform.domain.runtime.InvocationDiagnostics.Dispatch.SENT, "INVALID_CREDENTIAL"))
                .thenThrow(new io.github.chenyilei2016.openplatform.domain.runtime.ProviderCallFailure(io.github.chenyilei2016.openplatform.domain.common.ErrorCode.DOWNSTREAM_TIMEOUT,
                        "超时", io.github.chenyilei2016.openplatform.domain.runtime.InvocationDiagnostics.Dispatch.UNKNOWN, null))
                .thenReturn(json.readValue("{\"code\":12,\"message\":\"token=private-value\"}", Object.class))
                .thenReturn(java.util.Map.of("code", 0, "data", java.util.Map.of("count", 7, "large", "x".repeat(60000))));
        String input = "{\"count\":7,\"label\":\"demo\"}";
        org.assertj.core.api.Assertions.assertThat(debugData(id, false, input).at("/checks/3/reason").asText()).isEqualTo("INVALID_CREDENTIAL");
        tools.jackson.databind.JsonNode timeout = debugData(id, false, input);
        org.assertj.core.api.Assertions.assertThat(timeout.path("outcome").asText()).isEqualTo("UNKNOWN");
        org.assertj.core.api.Assertions.assertThat(timeout.at("/providerResponse/available").asBoolean()).isFalse();
        tools.jackson.databind.JsonNode business = debugData(id, false, input);
        org.assertj.core.api.Assertions.assertThat(business.at("/publicResponse/value/code").asInt()).isEqualTo(50200002);
        org.assertj.core.api.Assertions.assertThat(business.toString()).doesNotContain("private-value");
        tools.jackson.databind.JsonNode large = debugData(id, false, input);
        org.assertj.core.api.Assertions.assertThat(large.at("/providerResponse/truncated").asBoolean()).isTrue();
        org.assertj.core.api.Assertions.assertThat(large.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8).length).isLessThan(128 * 1024);
        org.assertj.core.api.Assertions.assertThat(large.path("outcome").asText()).isEqualTo("SUCCEEDED");
        mvc.perform(executionRequest(id, true, input).content("{\"expectedRevision\":2,\"input\":{}}"))
                .andExpect(status().isConflict());
    }

    private String apiForDebug() throws Exception {
        when(scopes.allEnabled(org.mockito.ArgumentMatchers.anyList())).thenReturn(true);
        when(scopes.enabledCodes(org.mockito.ArgumentMatchers.anyList())).thenReturn(java.util.List.of("orders"));
        when(tokens.verify("valid-token")).thenReturn(new io.github.chenyilei2016.openplatform.domain.token.TokenContext("token-id", "app-id", "app-key", "tenant-1", null, null, null, java.util.List.of("orders"), java.time.Instant.now().plusSeconds(3600)));
        when(governance.evaluate(org.mockito.ArgumentMatchers.any())).thenReturn(new io.github.chenyilei2016.openplatform.domain.governance.GovernanceDecision(true,
                io.github.chenyilei2016.openplatform.domain.governance.GovernanceDecision.Reason.NONE, 0, java.util.List.of()));
        String body = """
                {"service":"debug_%s","version":"v1","method":"query","name":"调试契约","category":"测试","owner":"测试",
                 "scopeCodes":["orders"],"requestSchema":{"type":"OBJECT","properties":{"count":{"type":"INTEGER","required":true},"label":{"type":"STRING","required":true}}},
                 "responseSchema":{"type":"OBJECT","properties":{"count":{"type":"INTEGER","required":true},"accessToken":{"type":"STRING"}}},
                 "responseAdapter":{"mode":"ENVELOPE","successPath":"code","successValues":[0],"dataPath":"data","messagePath":"message"},
                 "errorDefinitions":[],"binding":{"protocol":"HTTP","timeoutMillis":2000,"http":{"url":"http://provider.invalid/query","method":"POST"}},
                 "mappings":[{"target":"count","source":"REQUEST","path":"count"},{"target":"tenantId","source":"CONTEXT","path":"tenantId"},{"target":"secret","source":"FIXED","value":"mapped-private-secret"}]}
                """.formatted(java.util.UUID.randomUUID().toString().replace("-", ""));
        String response = mvc.perform(post("/admin-api/apis").session(io.github.chenyilei2016.openplatform.testing.TestSessions.session("test-session"))
                .header("X-CSRF-Token", "76832d7fdbcdbf4a72129f8b7def9016").contentType("application/json").content(body))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        return json.readTree(response).at("/data/id").asText();
    }
    private MockHttpServletRequestBuilder executionRequest(String id, boolean preflight, String input) {
        return post("/admin-api/apis/" + id + "/debug" + (preflight ? "/preflight" : "")).session(io.github.chenyilei2016.openplatform.testing.TestSessions.session("test-session"))
                .header("X-CSRF-Token", "76832d7fdbcdbf4a72129f8b7def9016").header("Authorization", "Bearer valid-token")
                .contentType("application/json").content("{\"expectedRevision\":1,\"input\":" + input + "}");
    }
    private tools.jackson.databind.JsonNode debugData(String id, boolean preflight, String input) throws Exception {
        return json.readTree(mvc.perform(executionRequest(id, preflight, input)).andExpect(status().isOk()).andReturn().getResponse().getContentAsString()).get("data");
    }

    private MockHttpServletRequestBuilder debug() {
        return post("/admin-api/apis/missing/debug").header("X-CSRF-Token", "76832d7fdbcdbf4a72129f8b7def9016")
                .contentType("application/json").content("{\"expectedRevision\":1,\"input\":{}}");
    }
}
