package io.github.chenyilei2016.openplatform.signature;

import io.github.chenyilei2016.openplatform.application.access.GrantManagementService;
import io.github.chenyilei2016.openplatform.application.signature.SigningKeyService;
import io.github.chenyilei2016.openplatform.domain.access.*;
import io.github.chenyilei2016.openplatform.domain.common.CredentialSecrets;
import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.github.chenyilei2016.openplatform.domain.observability.*;
import io.github.chenyilei2016.openplatform.domain.runtime.HttpApiInvoker;
import io.github.chenyilei2016.openplatform.domain.runtime.InvocationContext;
import io.github.chenyilei2016.openplatform.domain.signature.SignatureReplayGuard;

import io.github.chenyilei2016.openplatform.application.identity.AccountAuthentication;
import io.github.chenyilei2016.openplatform.testing.TestAccount;
import jakarta.servlet.http.Cookie;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.*;
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
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** 真实H2授权/密钥/发布/记录，替换外部身份、Provider与Redis；Redis原子边界由P1真实环境覆盖。 */
@io.github.chenyilei2016.openplatform.testing.TestAdministrators
@SpringBootTest(properties = {
        "spring.sql.init.schema-locations=classpath:db/access-schema.sql,classpath:db/mcp-schema.sql,classpath:db/catalog-schema.sql,classpath:db/dubbo-connection-schema.sql,classpath:db/token-schema.sql,classpath:db/publication-schema.sql,classpath:db/governance-schema.sql,classpath:db/observability-schema.sql,classpath:db/operations-metrics-schema.sql,classpath:db/signature-schema.sql",
          "open-platform.publish.audit.enabled=false",
        "open-platform.signature.active-wrapping-key-id=test",
        "open-platform.signature.wrapping-keys.test=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
        "test.admin.operators[0].tenant-id=tenant-1",
        "test.admin.operators[0].employee-no=operator-1",
        "test.admin.operators[0].permissions[0]=MANAGE_APIS",
        "test.admin.operators[0].permissions[1]=PUBLISH_APIS"
})
@AutoConfigureMockMvc(print = MockMvcPrint.NONE)
@org.springframework.context.annotation.Import(io.github.chenyilei2016.openplatform.testing.CatalogReferenceFixture.class)
class SignatureGatewayHttpTest {
    private static final AccessOperator OPERATOR = new AccessOperator("tenant-1", "operator-1", "signature-test", null, null);
    private static final String APP_SECRET = "signature-test-application-secret";
    private static final byte[] BODY = "{\"orderNo\":\"订单-001\"}".getBytes(StandardCharsets.UTF_8);
    @Autowired MockMvc mvc;
    @Autowired JsonMapper json;
    @Autowired ApplicationRepository applications;
    @Autowired TenantGrantRepository tenants;
    @Autowired UserGrantRepository users;
    @Autowired ScopeRepository scopes;
    @Autowired SigningKeyService keys;
    @Autowired GrantManagementService grants;
    @Autowired io.github.chenyilei2016.openplatform.application.mcp.McpGatewayCredentialService gateways;
    @Autowired CallRecordRepository records;
    @MockitoBean AccountAuthentication login;
    @MockitoBean EmployeeDirectory employees;
    @MockitoBean HttpApiInvoker provider;
    @MockitoBean SignatureReplayGuard replays;
    @MockitoBean io.github.chenyilei2016.openplatform.domain.runtime.IdempotencyGuard idempotency;
    @MockitoBean io.github.chenyilei2016.openplatform.domain.governance.GovernanceGuard governance;
    private ClientApplication app;
    private TenantGrant tenant;
    private SigningKeyService.IssuedKey key;
    private String path;
    private String apiId;
    private Map<String, Object> definition;

    @BeforeEach
    void prepare() throws Exception {
        when(governance.evaluate(any())).thenReturn(new io.github.chenyilei2016.openplatform.domain.governance.GovernanceDecision(true, io.github.chenyilei2016.openplatform.domain.governance.GovernanceDecision.Reason.NONE, 0, List.of()));
        TestAccount operator = new TestAccount();
        operator.setId(11L); operator.setTenantId("tenant-1"); operator.setEmployeeNoStr("operator-1");
        when(login.current("test-session")).thenAnswer(invocation -> operator.toAccount());
        String id = UUID.randomUUID().toString();
        String code = "signature_" + id.replace("-", "");
        scopes.create(new Scope(UUID.randomUUID().toString(), code, "签名订单", true, false, false));
        app = new ClientApplication(id, id.replace("-", ""), "签名订单", "101", ApplicationStatus.ENABLED, 0, List.of(code), ApplicationKind.STANDARD);
        applications.create(app, CredentialSecrets.digest(APP_SECRET));
        tenant = new TenantGrant(UUID.randomUUID().toString(), app.id(), "101", GrantStatus.ACTIVE, 0, "", 0);
        tenants.create(tenant);
        tenants.create(new TenantGrant(UUID.randomUUID().toString(), app.id(), "202", GrantStatus.ACTIVE, 0, "", 0));
        key = keys.issue(app.id(), ApplicationKind.STANDARD, 0, false, OPERATOR);
        String service = "orders_" + id.replace("-", "");
        definition = new LinkedHashMap<>();
        definition.put("service", service); definition.put("version", "v1"); definition.put("method", "query");
        definition.put("name", "签名订单"); definition.put("category", "订单"); definition.put("owner", "验签测试");
        definition.put("scopeCodes", List.of(code));
        definition.put("requestSchema", Map.of("type", "OBJECT", "properties", Map.of("orderNo", Map.of("type", "STRING", "required", true))));
        definition.put("responseSchema", Map.of("type", "OBJECT", "properties", Map.of("tenantId", Map.of("type", "STRING", "required", true))));
        definition.put("binding", Map.of("protocol", "HTTP", "timeoutMillis", 2000,
                "http", Map.of("url", "http://127.0.0.1:18089/orders", "method", "POST")));
        definition.put("mappings", List.of(Map.of("target", "tenantId", "source", "CONTEXT", "path", "tenantId"),
                Map.of("target", "orderNo", "source", "REQUEST", "path", "orderNo")));
        definition.put("errorDefinitions", List.of());
        JsonNode api = admin("/admin-api/apis", definition);
        apiId = api.get("id").asText();
        admin("/admin-api/publications/apis/" + api.get("id").asText() + "/submissions",
                Map.of("expectedDraftRevision", 1, "expectedStateVersion", 0, "submissionKey", UUID.randomUUID().toString(), "comment", "签名认证边界"));
        path = "/api/sign/" + service + "/v1/query";
        when(provider.invoke(any(), any(), any(), anyString())).thenAnswer(call -> {
            InvocationContext context = call.getArgument(2);
            assertThat(((io.github.chenyilei2016.openplatform.domain.runtime.HttpParameters) call.getArgument(1)).body().get("tenantId")).isEqualTo(context.tenantId());
            return Map.of("tenantId", context.tenantId());
        });
    }

    @Test
    void idempotencyIsSharedByBearerAndSignatureAndRejectsBeforeProvider() throws Exception {
        definition.put("idempotencyField", "orderNo");
        definition.put("expectedRevision", 1);
        mvc.perform(put("/admin-api/apis/" + apiId).session(io.github.chenyilei2016.openplatform.testing.TestSessions.session("test-session"))
                .header("X-CSRF-Token", "76832d7fdbcdbf4a72129f8b7def9016").contentType("application/json")
                .content(json.writeValueAsString(definition))).andExpect(status().isOk());
        admin("/admin-api/publications/apis/" + apiId + "/submissions", Map.of("expectedDraftRevision", 2,
                "expectedStateVersion", 1, "submissionKey", UUID.randomUUID().toString(), "comment", "幂等"));
        String token = data(mvc.perform(post("/api/token").contentType("application/json").content(json.writeValueAsString(
                Map.of("appKey", app.appKey(), "appSecret", APP_SECRET, "tenantId", "101"))))
                .andExpect(status().isOk()).andReturn()).get("accessToken").asText();
        Map<String, String> occupied = new HashMap<>();
        doAnswer(call -> {
            io.github.chenyilei2016.openplatform.domain.runtime.IdempotencyGuard.Reservation reservation = call.getArgument(0);
            String scope = reservation.tenantId() + "/" + reservation.apiId() + "/" + reservation.valueDigest();
            String previous = occupied.putIfAbsent(scope, reservation.requestId());
            if (previous != null) throw new PlatformException(ErrorCode.IDEMPOTENT_REPLAY, "已提交过（原请求 requestId=" + previous + "）");
            return null;
        }).when(idempotency).reserve(any());
        doAnswer(call -> {
            io.github.chenyilei2016.openplatform.domain.runtime.IdempotencyGuard.Reservation reservation = call.getArgument(0);
            occupied.remove(reservation.tenantId() + "/" + reservation.apiId() + "/" + reservation.valueDigest(), reservation.requestId());
            return null;
        }).when(idempotency).release(any());
        mvc.perform(signed(key, path, "101", null, BODY)).andExpect(status().isOk());
        mvc.perform(post(path.replace("/sign/", "/oauth/")).header("Authorization", "Bearer " + token)
                .contentType("application/json").content(BODY)).andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value(ErrorCode.IDEMPOTENT_REPLAY.getCode()));
        mvc.perform(signed(key, path, "202", null, BODY)).andExpect(status().isOk());
        verify(provider, times(2)).invoke(any(), any(), any(), anyString());
        mvc.perform(signed(key, path, "101", null, "{}".getBytes(StandardCharsets.UTF_8))).andExpect(status().isBadRequest());
        byte[] retryBody = "{\"orderNo\":\"not-sent-order\"}".getBytes(StandardCharsets.UTF_8);
        doThrow(new io.github.chenyilei2016.openplatform.domain.runtime.ProviderCallFailure(ErrorCode.REQUEST_TOO_LARGE, "映射后的请求超限",
                io.github.chenyilei2016.openplatform.domain.runtime.InvocationDiagnostics.Dispatch.NOT_SENT, null))
                .doReturn(Map.of("tenantId", "101")).when(provider).invoke(any(), any(), any(), anyString());
        mvc.perform(signed(key, path, "101", null, retryBody)).andExpect(status().isPayloadTooLarge());
        mvc.perform(signed(key, path, "101", null, retryBody)).andExpect(status().isOk());
        verify(idempotency).release(any());
        byte[] uncertainBody = "{\"orderNo\":\"uncertain-order\"}".getBytes(StandardCharsets.UTF_8);
        doThrow(new io.github.chenyilei2016.openplatform.domain.runtime.ProviderCallFailure(ErrorCode.DOWNSTREAM_TIMEOUT, "执行状态未知",
                io.github.chenyilei2016.openplatform.domain.runtime.InvocationDiagnostics.Dispatch.UNKNOWN, null)).when(provider).invoke(any(), any(), any(), anyString());
        mvc.perform(signed(key, path, "101", null, uncertainBody)).andExpect(status().isGatewayTimeout());
        mvc.perform(signed(key, path, "101", null, uncertainBody)).andExpect(status().isConflict());
        doThrow(new PlatformException(ErrorCode.DEPENDENCY_UNAVAILABLE, "幂等服务不可用")).when(idempotency).reserve(any());
        mvc.perform(signed(key, path, "101", null, "{\"orderNo\":\"new-order\"}".getBytes(StandardCharsets.UTF_8)))
                .andExpect(status().isServiceUnavailable());
        verify(provider, times(5)).invoke(any(), any(), any(), anyString());
    }

    @Test
    void employeeRequirementAppliesToBearerHmacAndDraftBeforeGovernance() throws Exception {
        grantEmployee();
        String tenantToken = data(mvc.perform(post("/api/token").contentType("application/json").content(json.writeValueAsString(
                Map.of("appKey", app.appKey(), "appSecret", APP_SECRET, "tenantId", "101")))).andExpect(status().isOk()).andReturn()).get("accessToken").asText();
        String employeeToken = data(mvc.perform(post("/api/token").contentType("application/json").content(json.writeValueAsString(
                Map.of("appKey", app.appKey(), "appSecret", APP_SECRET, "tenantId", "101", "employeeNo", "E101")))).andExpect(status().isOk()).andReturn()).get("accessToken").asText();
        for (boolean required : List.of(true, false)) {
            long revision = required ? 2 : 3;
            definition.put("employeeRequired", required); definition.put("expectedRevision", revision - 1);
            mvc.perform(put("/admin-api/apis/" + apiId).session(io.github.chenyilei2016.openplatform.testing.TestSessions.session("test-session"))
                    .header("X-CSRF-Token", "76832d7fdbcdbf4a72129f8b7def9016").contentType("application/json")
                    .content(json.writeValueAsString(definition))).andExpect(status().isOk());
            admin("/admin-api/publications/apis/" + apiId + "/submissions", Map.of("expectedDraftRevision", revision,
                    "expectedStateVersion", revision - 1, "submissionKey", UUID.randomUUID().toString(), "comment", "人员要求"));
            int expected = required ? 403 : 200;
            mvc.perform(signed(key, path, "101", null, BODY)).andExpect(status().is(expected));
            mvc.perform(signed(key, path, "101", "E101", BODY)).andExpect(status().isOk());
            for (String raw : List.of(tenantToken, employeeToken)) {
                int tokenExpected = required && raw.equals(tenantToken) ? 403 : 200;
                mvc.perform(post(path.replace("/sign/", "/oauth/")).header("Authorization", "Bearer " + raw)
                        .contentType("application/json").content(BODY)).andExpect(status().is(tokenExpected));
                mvc.perform(post("/admin-api/apis/" + apiId + "/debug").session(io.github.chenyilei2016.openplatform.testing.TestSessions.session("test-session"))
                        .header("X-CSRF-Token", "76832d7fdbcdbf4a72129f8b7def9016").header("Authorization", "Bearer " + raw)
                        .contentType("application/json").content(json.writeValueAsString(Map.of("expectedRevision", revision,
                                "input", Map.of("orderNo", "订单-001"))))).andExpect(status().is(tokenExpected));
            }
        }
    }

    @Test
    void validSignaturesReuseTenantEmployeeAndProductionObservation() throws Exception {
        for (String target : List.of("101", "202")) {
            MvcResult result = mvc.perform(signed(key, path, target, null, BODY)).andExpect(status().isOk())
                    .andExpect(jsonPath("$.data.tenantId").value(target)).andReturn();
            var page = records.page(ObservationQuery.builder().page(1).pageSize(10)
                    .requestId(result.getResponse().getHeader("X-Request-Id"))
                    .applicationId(app.id()).tenantId(target).modes(java.util.Set.of(CallMode.PRODUCTION)).build());
            assertThat(page.items()).singleElement().satisfies(record -> {
                assertThat(record.mode()).isEqualTo(CallMode.PRODUCTION);
                assertThat(record.httpStatus()).isEqualTo(200);
                assertThat(record.applicationId()).isEqualTo(app.id());
            });
        }
        grantEmployee();
        mvc.perform(signed(key, path, "101", "E101", BODY)).andExpect(status().isOk());
        verify(provider).invoke(any(), any(), argThat(context -> "E101".equals(context.employeeNo())
                && "user-101".equals(context.userId()) && "employee-101".equals(context.employeeId())), anyString());
        verify(replays, times(3)).consume(eq(key.key().keyId()), anyString(), anyLong());
    }

    @Test
    void tamperedBodyPathOrIdentityCannotAuthenticateOrConsumeNonce() throws Exception {
        MvcResult rejected = mvc.perform(signed(key, path, "101", null, BODY).content("{\"orderNo\":\"changed\"}"))
                .andExpect(status().isUnauthorized()).andReturn();
        var failed = records.page(ObservationQuery.builder().page(1).pageSize(10)
                .requestId(rejected.getResponse().getHeader("X-Request-Id"))
                .modes(java.util.Set.of(CallMode.PRODUCTION)).build());
        assertThat(failed.items()).singleElement().satisfies(record -> {
            assertThat(record.httpStatus()).isEqualTo(401);
            assertThat(record.applicationId()).isNull();
            assertThat(record.tenantId()).isNull();
        });
        mvc.perform(signed(key, path + "Other", "101", null, BODY).with(request -> { request.setRequestURI(path); return request; }))
                .andExpect(status().isUnauthorized());
        mvc.perform(signed(key, path, "101", null, BODY).with(request -> { request.removeHeader("X-SZ-Tenant"); request.addHeader("X-SZ-Tenant", "202"); return request; }))
                .andExpect(status().isUnauthorized());
        mvc.perform(signed(key, path, "101", null, BODY).header("X-SZ-Employee", "E101"))
                .andExpect(status().isUnauthorized());
        verifyNoInteractions(replays, provider);
    }

    @Test
    void currentAuthorizationAndScopeConstrainTheSameApplication() throws Exception {
        mvc.perform(signed(key, path, "303", null, BODY)).andExpect(status().isForbidden());
        mvc.perform(signed(key, path, "101", "missing", BODY)).andExpect(status().isForbidden());
        verifyNoInteractions(replays);
        applications.replaceScopes(app.id(), List.of());
        mvc.perform(signed(key, path, "101", null, BODY)).andExpect(status().isForbidden());
        verify(replays).consume(eq(key.key().keyId()), anyString(), anyLong());
        verifyNoInteractions(provider);
        applications.changeStatus(app.id(), ApplicationStatus.DISABLED);
        mvc.perform(signed(key, path, "101", null, BODY)).andExpect(status().isForbidden());
        verifyNoMoreInteractions(replays);
    }

    @Test
    void authorizationIsRecheckedAfterEmployeeRpc() throws Exception {
        grantEmployee();
        when(employees.find("101", "E101")).thenAnswer(call -> {
            grants.revokeTenant(tenant.id(), OPERATOR);
            return identity();
        });
        mvc.perform(signed(key, path, "101", "E101", BODY)).andExpect(status().isUnauthorized());
        verifyNoInteractions(replays, provider);
    }

    @Test
    void keyRotationDuringEmployeeRpcAndSubsequentRevocationRejectOldRequests() throws Exception {
        grantEmployee();
        when(employees.find("101", "E101")).thenAnswer(call -> {
            keys.issue(app.id(), ApplicationKind.STANDARD, key.key().revision(), true, OPERATOR);
            return identity();
        });
        mvc.perform(signed(key, path, "101", "E101", BODY)).andExpect(status().isUnauthorized());
        verifyNoInteractions(replays, provider);
        mvc.perform(signed(key, path, "101", null, BODY)).andExpect(status().isUnauthorized());
        var current = keys.get(app.id(), ApplicationKind.STANDARD).key();
        var replacement = keys.issue(app.id(), ApplicationKind.STANDARD, current.revision(), true, OPERATOR);
        mvc.perform(signed(replacement, path, "101", null, BODY)).andExpect(status().isOk());
        keys.revoke(app.id(), ApplicationKind.STANDARD, replacement.key().revision(), OPERATOR);
        mvc.perform(signed(replacement, path, "101", null, BODY)).andExpect(status().isUnauthorized());
    }

    @Test
    void strictHttpEnvelopeRejectsAmbiguousIdentityAndInvalidRawInput() throws Exception {
        mvc.perform(post(path).contentType("application/json").content(BODY)).andExpect(status().isUnauthorized());
        mvc.perform(signed(key, path, "101", null, BODY).header("Authorization", "Bearer old-token")).andExpect(status().isBadRequest());
        mvc.perform(signed(key, path, "101", null, BODY).header("X-SZ-Tenant", "101")).andExpect(status().isBadRequest());
        mvc.perform(signed(key, path, "101", null, BODY).header("X-SZ-Unknown", "1")).andExpect(status().isBadRequest());
        for (String timestamp : List.of("01", "-1", "1.0", "99999999999999999999999")) {
            mvc.perform(signed(key, path, "101", null, BODY).with(request -> {
                request.removeHeader("X-SZ-Timestamp"); request.addHeader("X-SZ-Timestamp", timestamp); return request;
            })).andExpect(status().isBadRequest());
        }
        mvc.perform(signed(key, path, "101", null, BODY).header("X-Tenant-Id", "101")).andExpect(status().isBadRequest());
        mvc.perform(signed(key, path, "101", null, BODY).queryParam("extra", "1")).andExpect(status().isBadRequest());
        mvc.perform(signed(key, path, "101", null, BODY).header("Content-Encoding", "gzip")).andExpect(status().isBadRequest());
        mvc.perform(signed(key, path, "101", null, BODY).contentType("application/json;charset=ISO-8859-1")).andExpect(status().isBadRequest());
        mvc.perform(signed(key, path, "101", null, BODY).content(new byte[65_537])).andExpect(status().isPayloadTooLarge());
        for (byte[] body : List.of(new byte[]{'{', '"', 'x', '"', ':', '"', (byte) 0xc3, '"', '}'},
                "{\"orderNo\":\"a\",\"orderNo\":\"b\"}".getBytes(StandardCharsets.UTF_8), "[]".getBytes(StandardCharsets.UTF_8))) {
            mvc.perform(signed(key, path, "101", null, body)).andExpect(status().isBadRequest());
        }
        verifyNoInteractions(replays, provider);
    }

    @Test
    void replayOrDependencyFailureNeverCallsProviderAndCannotBeConfusedWithBearer() throws Exception {
        doThrow(new PlatformException(ErrorCode.INVALID_SIGNATURE, "重复请求")).when(replays).consume(anyString(), anyString(), anyLong());
        mvc.perform(signed(key, path, "101", null, BODY)).andExpect(status().isUnauthorized());
        doThrow(new PlatformException(ErrorCode.DEPENDENCY_UNAVAILABLE, "Redis不可用")).when(replays).consume(anyString(), anyString(), anyLong());
        mvc.perform(signed(key, path, "101", null, BODY)).andExpect(status().isServiceUnavailable());
        mvc.perform(signed(key, path.replace("/sign/", "/oauth/"), "101", null, BODY)).andExpect(status().isBadRequest());
        verifyNoInteractions(provider);
    }

    @Test
    void tokenPublicContextAndRevocationRemainIndependentOfSigningKey() throws Exception {
        JsonNode token = data(mvc.perform(post("/api/token").contentType("application/json").content(json.writeValueAsString(
                Map.of("appKey", app.appKey(), "appSecret", APP_SECRET, "tenantId", "101")))).andExpect(status().isOk()).andReturn());
        String raw = token.get("accessToken").asText();
        keys.revoke(app.id(), ApplicationKind.STANDARD, key.key().revision(), OPERATOR);
        JsonNode context = data(mvc.perform(post("/api/token/introspect").header("Authorization", "Bearer " + raw))
                .andExpect(status().isOk()).andReturn());
        assertThat(context.toString()).doesNotContain("invocationContext", "signingSecret", "keyId");
        assertThat(context.get("tokenId").asText()).isEqualTo(token.at("/context/tokenId").asText());
        mvc.perform(post(path.replace("/sign/", "/oauth/")).header("Authorization", "Bearer " + raw)
                .contentType("application/json").content(BODY)).andExpect(status().isOk());
        mvc.perform(post(path.replace("/sign/", "/oauth/")).header("Authorization", "Bearer " + raw, "Bearer " + raw)
                .contentType("application/json").content(BODY)).andExpect(status().isBadRequest());
    }

    /** 121 入口隔离：即使存在租户关联数据，MCP 网关凭据也不能换 Token、走普通签名或被绑定；普通凭据密钥不能用于 MCP 入口。 */
    @Test
    void mcpGatewayCredentialIsIsolatedFromOrdinaryEntries() throws Exception {
        String id = UUID.randomUUID().toString();
        String gatewaySecret = "mcp-gateway-test-secret";
        var gatewayApp = new ClientApplication(id, id.replace("-", ""), "网关", "", ApplicationStatus.ENABLED, 0,
                app.scopeCodes(), ApplicationKind.MCP_GATEWAY);
        applications.create(gatewayApp, CredentialSecrets.digest(gatewaySecret));
        tenants.create(new TenantGrant(UUID.randomUUID().toString(), id, "101", GrantStatus.ACTIVE, 0, "", 0));
        var gatewayKey = keys.issue(id, ApplicationKind.MCP_GATEWAY, 0, false, OPERATOR);

        mvc.perform(post("/api/token").contentType("application/json").content(json.writeValueAsString(
                Map.of("appKey", gatewayApp.appKey(), "appSecret", gatewaySecret, "tenantId", "101")))).andExpect(status().isUnauthorized());
        mvc.perform(signed(gatewayKey, path, "101", null, BODY)).andExpect(status().isUnauthorized());
        verifyNoInteractions(replays, provider);
        assertThat(errorOf(() -> grants.bindTenant(gatewayApp.appKey(), gatewaySecret, "303", OPERATOR))).isEqualTo(ErrorCode.FORBIDDEN);
        assertThat(errorOf(() -> keys.issue(id, ApplicationKind.STANDARD, gatewayKey.key().revision(), true, OPERATOR))).isEqualTo(ErrorCode.NOT_FOUND);

        assertThat(gateways.requireActiveGateway(gatewayKey.key()).id()).isEqualTo(id);
        assertThat(errorOf(() -> gateways.requireActiveGateway(key.key()))).isEqualTo(ErrorCode.INVALID_SIGNATURE);
        // 数据库约束保证每环境只有一个 MCP 网关凭据。
        String second = UUID.randomUUID().toString();
        assertThat(errorOf(() -> applications.create(
                new ClientApplication(second, second.replace("-", ""), "第二个网关", "", ApplicationStatus.ENABLED, 0, List.of(),
                        ApplicationKind.MCP_GATEWAY), "digest"))).isEqualTo(ErrorCode.CONFLICT);
        assertThat(applications.find(second)).isEmpty();
    }

    private static ErrorCode errorOf(org.assertj.core.api.ThrowableAssert.ThrowingCallable call) {
        Throwable failure = org.assertj.core.api.Assertions.catchThrowable(call);
        assertThat(failure).isInstanceOf(PlatformException.class);
        return ((PlatformException) failure).getErrorCode();
    }

    private void grantEmployee() {
        users.create(new UserGrant(UUID.randomUUID().toString(), tenant.id(), "101", "user-101", "employee-101", "E101", "人员101", GrantStatus.ACTIVE, 0));
        when(employees.find("101", "E101")).thenReturn(identity());
    }
    private EmployeeIdentity identity() { return new EmployeeIdentity("101", "user-101", "employee-101", "E101", "人员101", true, EmployeeStatus.PERMANENT); }

    private MockHttpServletRequestBuilder signed(SigningKeyService.IssuedKey credential, String signedPath,
                                                 String target, String employee, byte[] body) throws Exception {
        String nonce = UUID.randomUUID().toString().replace("-", "");
        String timestamp = Long.toString(Instant.now().getEpochSecond());
        String canonical = String.join("\n", "SZ-HMAC-SHA256", "POST", signedPath, credential.key().keyId(), target,
                employee == null ? "" : employee, timestamp, nonce,
                HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(body)));
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(Base64.getUrlDecoder().decode(credential.signingSecret()), "HmacSHA256"));
        var request = post(signedPath).contentType("application/json").content(body)
                .header("Authorization", "SZ-HMAC-SHA256 " + credential.key().keyId() + ":" + HexFormat.of().formatHex(mac.doFinal(canonical.getBytes(StandardCharsets.UTF_8))))
                .header("X-SZ-Tenant", target).header("X-SZ-Timestamp", timestamp).header("X-SZ-Nonce", nonce);
        if (employee != null) request.header("X-SZ-Employee", employee);
        return request;
    }
    private JsonNode admin(String url, Object body) throws Exception {
        return data(mvc.perform(post(url).session(io.github.chenyilei2016.openplatform.testing.TestSessions.session("test-session"))
                .header("X-CSRF-Token", "76832d7fdbcdbf4a72129f8b7def9016").contentType("application/json")
                .content(json.writeValueAsString(body))).andExpect(status().isOk()).andReturn());
    }
    private JsonNode data(MvcResult result) throws Exception { return json.readTree(result.getResponse().getContentAsString()).get("data"); }
}
