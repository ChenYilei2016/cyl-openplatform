package io.github.chenyilei2016.openplatform.mcp;

import io.github.chenyilei2016.openplatform.application.access.TenantScopeAccessService;
import io.github.chenyilei2016.openplatform.application.mcp.McpGatewayCredentialService;
import io.github.chenyilei2016.openplatform.application.mcp.McpTenantActivationService;
import io.github.chenyilei2016.openplatform.application.mcp.McpToolSetService;
import io.github.chenyilei2016.openplatform.application.signature.SigningKeyService;
import io.github.chenyilei2016.openplatform.domain.access.AccessOperator;
import io.github.chenyilei2016.openplatform.domain.access.EmployeeDirectory;
import io.github.chenyilei2016.openplatform.domain.access.EmployeeIdentity;
import io.github.chenyilei2016.openplatform.domain.access.EmployeeStatus;
import io.github.chenyilei2016.openplatform.domain.access.Scope;
import io.github.chenyilei2016.openplatform.domain.access.ScopeRepository;
import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.ObjectIdType;
import io.github.chenyilei2016.openplatform.domain.governance.GovernanceDecision;
import io.github.chenyilei2016.openplatform.domain.governance.GovernanceGuard;
import io.github.chenyilei2016.openplatform.domain.observability.CallChannel;
import io.github.chenyilei2016.openplatform.domain.observability.CallRecord;
import io.github.chenyilei2016.openplatform.domain.observability.CallRecordRepository;
import io.github.chenyilei2016.openplatform.domain.observability.ObservationQuery;
import io.github.chenyilei2016.openplatform.domain.runtime.HttpApiInvoker;
import io.github.chenyilei2016.openplatform.domain.runtime.IdempotencyGuard;
import io.github.chenyilei2016.openplatform.domain.runtime.InvocationContext;
import io.github.chenyilei2016.openplatform.domain.runtime.InvocationDiagnostics;
import io.github.chenyilei2016.openplatform.domain.runtime.ProviderCallFailure;
import io.github.chenyilei2016.openplatform.domain.signature.SignatureReplayGuard;

import io.github.chenyilei2016.openplatform.application.identity.AccountAuthentication;
import io.github.chenyilei2016.openplatform.testing.TestAccount;
import jakarta.servlet.http.Cookie;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
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
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** H2真实授权/发布/签名/目录/日志；替换身份、治理、Redis端口和提供方，不能当作公司网关联调。 */
@io.github.chenyilei2016.openplatform.testing.TestAdministrators
@org.springframework.context.annotation.Import(io.github.chenyilei2016.openplatform.testing.CatalogReferenceFixture.class)
@SpringBootTest(properties = {
          "open-platform.publish.audit.enabled=false",
        "open-platform.signature.active-wrapping-key-id=mcp", "open-platform.signature.wrapping-keys.mcp=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
        "test.admin.operators[0].tenant-id=101", "test.admin.operators[0].employee-no=operator-1",
        "test.admin.operators[0].permissions[0]=MANAGE_APPLICATIONS", "test.admin.operators[0].permissions[1]=MANAGE_APIS",
        "test.admin.operators[0].permissions[2]=PUBLISH_APIS", "test.admin.operators[0].permissions[3]=VIEW_AUDIT"
})
@AutoConfigureMockMvc(print = MockMvcPrint.NONE)
class McpEndpointHttpTest {
    private static final AccessOperator OPERATOR = new AccessOperator("101", "operator-1", "mcp-test", null, null);
    @Autowired MockMvc mvc;
    @Autowired JsonMapper json;
    @Autowired McpGatewayCredentialService gateways;
    @Autowired SigningKeyService keys;
    @Autowired McpTenantActivationService activations;
    @Autowired McpToolSetService sets;
    @Autowired ScopeRepository scopes;
    @Autowired TenantScopeAccessService access;
    @Autowired CallRecordRepository records;
    @MockitoBean AccountAuthentication login;
    @MockitoBean EmployeeDirectory employees;
    @MockitoBean HttpApiInvoker provider;
    @MockitoBean GovernanceGuard governance;
    @MockitoBean SignatureReplayGuard replays;
    @MockitoBean IdempotencyGuard idempotency;
    private String keyId;
    private String secret;
    private String tenant;
    private String scopeId;
    private String scopeCode;
    private Instant started;

    @BeforeEach void prepare() {
        started = Instant.now();
        TestAccount user = new TestAccount();
        user.setId(1001L); user.setTenantId("101"); user.setEmployeeNoStr("operator-1");
        when(login.current("test-session")).thenAnswer(invocation -> user.toAccount());
        if (gateways.overview().credential() == null) gateways.create(OPERATOR);
        McpGatewayCredentialService.CredentialView credential = gateways.overview().credential();
        keyId = credential.key().keyId();
        secret = Base64.getUrlEncoder().withoutPadding().encodeToString(keys.requireSecret(credential.key()));
        tenant = "tenant-" + UUID.randomUUID();
        scopeId = ObjectIdType.SCOPE.nextId(); scopeCode = "scope_" + UUID.randomUUID().toString().replace("-", "");
        scopes.create(new Scope(scopeId, scopeCode, "MCP测试", true, false, false));
        when(governance.evaluate(any())).thenReturn(new GovernanceDecision(true, GovernanceDecision.Reason.NONE, 0, List.of()));
        when(provider.invoke(any(), any(), any(), anyString())).thenAnswer(call -> Map.of("tenant", ((InvocationContext) call.getArgument(2)).tenantId()));
    }

    @Test void discoveryIsSignedStatelessAndDoesNotCreateBusinessLogs() throws Exception {
        JsonNode api = api(false);
        JsonNode initialized = rpc("/mcp/v1", null, null, message("initialize", Map.of("protocolVersion", "2025-06-18", "capabilities", Map.of(),
                "clientInfo", Map.of("name", "test-client", "version", "1"))));
        assertThat(initialized.at("/result/protocolVersion").asText()).isEqualTo("2025-06-18");
        mvc.perform(signed("/mcp/v1", null, null, json.writeValueAsBytes(Map.of("jsonrpc", "2.0", "method", "notifications/initialized"))))
                .andExpect(status().isAccepted()).andExpect(content().string("")).andExpect(header().doesNotExist("Mcp-Session-Id"));
        JsonNode page = rpc("/mcp/v1", null, null, message("tools/list", Map.of()));
        assertThat(page.at("/result/tools").toString()).contains(toolName(api));
        assertThat(page.at("/result/tools/0/inputSchema/type").asText()).isEqualTo("object");
        assertThat(rpc("/mcp/v1", null, null, message("ping", Map.of())).has("result")).isTrue();
        assertThat(rpc("/mcp/v1", null, null, message("not/a/method", Map.of())).at("/error/code").asInt()).isEqualTo(-32601);
        mvc.perform(get("/mcp/v1")).andExpect(status().isMethodNotAllowed());
        assertThat(logs()).isEmpty();
    }

    @Test void tenantActivationPermissionAndOptionalEmployeeAreEnforcedBeforeProvider() throws Exception {
        JsonNode api = api(false);
        Map<String, Object> request = call(api);
        assertThat(rpc("/mcp/v1", tenant, null, request).at("/result/isError").asBoolean()).isTrue();
        activations.open(new AccessOperator(tenant, "E1", "open", null, null));
        assertThat(rpc("/mcp/v1", tenant, null, request).at("/result/isError").asBoolean()).isTrue();
        verifyNoInteractions(provider);
        access.grant(scopeId, tenant, OPERATOR);
        JsonNode success = rpc("/mcp/v1", tenant, null, request);
        assertThat(success.at("/result/isError").asBoolean()).isFalse();
        assertThat(success.at("/result/structuredContent/data/tenant").asText()).isEqualTo(tenant);
        JsonNode employeeApi = api(true);
        assertThat(rpc("/mcp/v1", tenant, null, call(employeeApi)).at("/result/isError").asBoolean()).isTrue();
        when(employees.find(tenant, "E1")).thenReturn(new EmployeeIdentity(tenant, "user-1", "employee-1", "E1", "测试员工", true, EmployeeStatus.PERMANENT));
        assertThat(rpc("/mcp/v1", tenant, "E1", call(employeeApi)).at("/result/isError").asBoolean()).isFalse();
        List<CallRecord> logs = logs();
        assertThat(logs).hasSize(5).allMatch(log -> log.channel() == CallChannel.MCP);
        assertThat(logs.stream().filter(log -> log.outcome().equals("FAILURE"))).hasSize(3);
        assertThat(logs.stream().filter(log -> "E1".equals(log.employeeNo())).findFirst().orElseThrow().employeeId()).isEqualTo("employee-1");
        activations.changeOwnStatus(false, new AccessOperator(tenant, "E1", "disable", null, null));
        clearInvocations(provider);
        assertThat(rpc("/mcp/v1", tenant, null, request).at("/result/isError").asBoolean()).isTrue();
        verifyNoInteractions(provider);
    }

    @Test void alteredBodyIdentityPathDuplicateHeadersAndOriginAreRejected() throws Exception {
        byte[] body = json.writeValueAsBytes(message("tools/list", Map.of()));
        mvc.perform(signed("/mcp/v1", tenant, null, body).content(json.writeValueAsBytes(message("ping", Map.of())))).andExpect(status().isUnauthorized());
        mvc.perform(signed("/mcp/v1", tenant, null, body).header("X-SZ-Tenant", "different")).andExpect(status().isBadRequest());
        mvc.perform(signed("/mcp/v1", null, null, body).header("X-MCP-User-Tenant-Id", tenant)).andExpect(status().isBadRequest());
        mvc.perform(signed("/mcp/v1", null, null, body).queryParam("tenantId", tenant)).andExpect(status().isBadRequest());
        mvc.perform(signed("/mcp/v1", null, null, body).header("Origin", "https://example.invalid")).andExpect(status().isForbidden());
        mvc.perform(signed("/mcp/v1", null, null, body).header("MCP-Protocol-Version", "unsupported")).andExpect(status().isBadRequest());
        mvc.perform(signed("/mcp/v1", null, null, "[{}]".getBytes(StandardCharsets.UTF_8))).andExpect(status().isBadRequest()).andExpect(jsonPath("$.error.code").value(-32600));
        verifyNoInteractions(provider);
    }

    @Test void toolSetOnlyListsAndCallsItsMembersAndDisableTakesEffectImmediately() throws Exception {
        JsonNode included = api(false), excluded = api(false);
        activations.open(new AccessOperator(tenant, "E1", "open", null, null));
        access.grant(scopeId, tenant, OPERATOR);
        String code = "orders-" + UUID.randomUUID().toString().substring(0, 8);
        McpToolSetService.Detail set = sets.create(code, "订单工具", "", true, List.of(included.get("id").asText()), OPERATOR);
        String path = "/mcp/v1/sets/" + code;
        JsonNode list = rpc(path, null, null, message("tools/list", Map.of()));
        assertThat(list.at("/result/tools")).hasSize(1);
        assertThat(list.at("/result/tools/0/name").asText()).isEqualTo(toolName(included));
        assertThat(rpc(path, tenant, null, call(included)).at("/result/isError").asBoolean()).isFalse();
        assertThat(rpc(path, tenant, null, call(excluded)).at("/result/isError").asBoolean()).isTrue();
        sets.update(set.toolSet().id(), "订单工具", "", false, set.apiIds(), 0, OPERATOR);
        mvc.perform(signed(path, null, null, json.writeValueAsBytes(message("tools/list", Map.of())))).andExpect(status().isNotFound());
        assertThat(rpc("/mcp/v1", tenant, null, call(included)).at("/result/isError").asBoolean()).isFalse();
    }

    @Test void providerTimeoutIsAnErrorResultWithUnknownDispatchAndFailureLog() throws Exception {
        JsonNode api = api(false);
        activations.open(new AccessOperator(tenant, "E1", "open", null, null));
        access.grant(scopeId, tenant, OPERATOR);
        doThrow(new ProviderCallFailure(ErrorCode.DOWNSTREAM_TIMEOUT,
                "提供方超时", InvocationDiagnostics.Dispatch.UNKNOWN, null)).when(provider).invoke(any(), any(), any(), anyString());
        JsonNode result = rpc("/mcp/v1", tenant, null, call(api));
        assertThat(result.at("/result/isError").asBoolean()).isTrue();
        JsonNode error = json.readTree(result.at("/result/content/0/text").asText());
        assertThat(error.get("dispatch").asText()).isEqualTo("UNKNOWN");
        assertThat(logs()).hasSize(1);
        assertThat(logs().getFirst().outcome()).isEqualTo("FAILURE");
        assertThat(logs().getFirst().httpStatus()).isEqualTo(200);
    }

    @Test void infrastructureRejectionUses429AndCredentialRotationDuringPersonnelLookupPreventsDispatch() throws Exception {
        JsonNode api = api(false);
        activations.open(new AccessOperator(tenant, "E1", "open", null, null));
        access.grant(scopeId, tenant, OPERATOR);
        doThrow(new ProviderCallFailure(ErrorCode.RATE_LIMITED, "并发已满", InvocationDiagnostics.Dispatch.NOT_SENT, null))
                .when(provider).invoke(any(), any(), any(), anyString());
        mvc.perform(signed("/mcp/v1", tenant, null, json.writeValueAsBytes(call(api))))
                .andExpect(status().isTooManyRequests()).andExpect(header().string("Retry-After", "1"));
        clearInvocations(provider);
        when(employees.find(tenant, "E1")).thenAnswer(invocation -> {
            gateways.rotate(gateways.overview().credential().key().revision(), OPERATOR);
            return new EmployeeIdentity(tenant, "u1", "e1", "E1", "员工", true, EmployeeStatus.PERMANENT);
        });
        mvc.perform(signed("/mcp/v1", tenant, "E1", json.writeValueAsBytes(call(api)))).andExpect(status().isUnauthorized());
        verifyNoInteractions(provider);
    }

    @Test void preDispatchDependencyFailureIs503AndNeverCallsProvider() throws Exception {
        JsonNode api = api(false);
        activations.open(new AccessOperator(tenant, "E1", "open", null, null));
        access.grant(scopeId, tenant, OPERATOR);
        when(employees.find(tenant, "E1")).thenThrow(new IllegalStateException("身份依赖故障"));
        mvc.perform(signed("/mcp/v1", tenant, "E1", json.writeValueAsBytes(call(api))))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.error.data.code").value(ErrorCode.DEPENDENCY_UNAVAILABLE.getCode()));
        when(governance.evaluate(any())).thenThrow(new IllegalStateException("治理依赖故障"));
        mvc.perform(signed("/mcp/v1", tenant, null, json.writeValueAsBytes(call(api))))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.error.data.code").value(ErrorCode.DEPENDENCY_UNAVAILABLE.getCode()));
        verifyNoInteractions(provider);
        assertThat(logs()).hasSize(2).allMatch(log -> log.httpStatus() == 503 && "FAILURE".equals(log.outcome()));
    }

    @Test void cursorPagesNeverRepeatOrSkipToolSetMembers() throws Exception {
        List<String> members = new java.util.ArrayList<>();
        for (int index = 0; index < 101; index++) members.add(api(false).get("id").asText());
        String code = "paged-" + UUID.randomUUID().toString().substring(0, 8);
        sets.create(code, "分页目录", "", true, members, OPERATOR);
        String path = "/mcp/v1/sets/" + code;
        JsonNode first = rpc(path, null, null, message("tools/list", Map.of())).get("result");
        assertThat(first.get("tools")).hasSize(100);
        JsonNode second = rpc(path, null, null, message("tools/list", Map.of("cursor", first.get("nextCursor").asText()))).get("result");
        assertThat(second.get("tools")).hasSize(1);
        assertThat(second.has("nextCursor")).isFalse();
        java.util.Set<String> names = new java.util.HashSet<>();
        first.get("tools").forEach(tool -> names.add(tool.get("name").asText()));
        second.get("tools").forEach(tool -> names.add(tool.get("name").asText()));
        assertThat(names).hasSize(101);
        mvc.perform(signed("/mcp/v1", null, null, json.writeValueAsBytes(message("tools/list", Map.of("cursor", first.get("nextCursor").asText())))))
                .andExpect(status().isBadRequest());
    }

    private JsonNode api(boolean employeeRequired) throws Exception {
        Map<String, Object> draft = new LinkedHashMap<>();
        draft.put("service", "mcp_" + UUID.randomUUID().toString().replace("-", "").substring(0, 12));
        draft.put("version", "v1"); draft.put("method", "query"); draft.put("name", "查询订单"); draft.put("category", "订单"); draft.put("owner", "测试");
        draft.put("scopeCodes", List.of(scopeCode)); draft.put("employeeRequired", employeeRequired);
        draft.put("errorDefinitions", List.of());
        draft.put("requestSchema", Map.of("type", "OBJECT", "properties", Map.of("orderNo", Map.of("type", "STRING", "required", true))));
        draft.put("responseSchema", Map.of("type", "OBJECT", "properties", Map.of("tenant", Map.of("type", "STRING", "required", true))));
        draft.put("binding", Map.of("protocol", "HTTP", "timeoutMillis", 2000, "http", Map.of("url", "http://127.0.0.1:18089/orders", "method", "POST")));
        draft.put("mappings", List.of(Map.of("target", "tenantId", "source", "CONTEXT", "path", "tenantId"), Map.of("target", "orderNo", "source", "REQUEST", "path", "orderNo")));
        draft.put("operationKind", "QUERY"); draft.put("mcpTool", Map.of("enabled", true, "aiDescription", "查询订单"));
        JsonNode created = admin("/admin-api/apis", draft);
        admin("/admin-api/publications/apis/" + created.get("id").asText() + "/submissions", Map.of("expectedDraftRevision", 1,
                "expectedStateVersion", 0, "submissionKey", UUID.randomUUID().toString(), "comment", "MCP测试"));
        return created;
    }
    private List<CallRecord> logs() {
        return records.page(ObservationQuery.builder().page(1).pageSize(100).channel(CallChannel.MCP).from(started).to(Instant.now()).build()).items();
    }
    private Map<String, Object> call(JsonNode api) { return message("tools/call", Map.of("name", toolName(api), "arguments", Map.of("orderNo", "001"))); }
    private static String toolName(JsonNode api) { return api.get("service").asText() + "_query_v1"; }
    private Map<String, Object> message(String method, Map<String, Object> params) { return Map.of("jsonrpc", "2.0", "id", 1, "method", method, "params", params); }
    private JsonNode rpc(String path, String tenantId, String employeeNo, Map<String, Object> body) throws Exception {
        return json.readTree(mvc.perform(signed(path, tenantId, employeeNo, json.writeValueAsBytes(body)))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
    }
    private MockHttpServletRequestBuilder signed(String path, String tenantId, String employeeNo, byte[] body) throws Exception {
        String nonce = UUID.randomUUID().toString().replace("-", "");
        String timestamp = Long.toString(Instant.now().getEpochSecond());
        String canonical = String.join("\n", "SZ-HMAC-SHA256", "POST", path, keyId, tenantId == null ? "" : tenantId,
                employeeNo == null ? "" : employeeNo, timestamp, nonce, HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(body)));
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(Base64.getUrlDecoder().decode(secret), "HmacSHA256"));
        MockHttpServletRequestBuilder request = post(path).contentType("application/json").content(body)
                .header("Authorization", "SZ-HMAC-SHA256 " + keyId + ":" + HexFormat.of().formatHex(mac.doFinal(canonical.getBytes(StandardCharsets.UTF_8))))
                .header("X-SZ-Timestamp", timestamp).header("X-SZ-Nonce", nonce).header("MCP-Protocol-Version", "2025-06-18")
                .header("Accept", "application/json, text/event-stream");
        if (tenantId != null) request.header("X-SZ-Tenant", tenantId);
        if (employeeNo != null) request.header("X-SZ-Employee", employeeNo);
        return request;
    }
    private JsonNode admin(String path, Map<String, Object> body) throws Exception {
        org.springframework.mock.web.MockHttpServletResponse response = mvc.perform(post(path).session(io.github.chenyilei2016.openplatform.testing.TestSessions.session("test-session"))
                .header("X-CSRF-Token", "76832d7fdbcdbf4a72129f8b7def9016").contentType("application/json").content(json.writeValueAsString(body)))
                .andReturn().getResponse();
        assertThat(response.getStatus()).withFailMessage(response.getContentAsString()).isEqualTo(200);
        return json.readTree(response.getContentAsString()).get("data");
    }
}
