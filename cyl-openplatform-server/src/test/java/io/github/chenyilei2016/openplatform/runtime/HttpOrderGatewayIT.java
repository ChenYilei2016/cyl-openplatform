package io.github.chenyilei2016.openplatform.runtime;

import io.github.chenyilei2016.openplatform.domain.catalog.ApiProtocol;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiBinding;
import com.alibaba.nacos.api.NacosFactory;
import com.alibaba.nacos.api.naming.NamingService;

import io.github.chenyilei2016.openplatform.application.identity.AccountAuthentication;
import io.github.chenyilei2016.openplatform.testing.TestEmployee;
import io.github.chenyilei2016.openplatform.testing.TestAccount;
import io.github.chenyilei2016.openplatform.domain.access.EmployeeDirectory;
import org.apache.dubbo.config.ApplicationConfig;
import org.apache.dubbo.config.ReferenceConfig;
import org.apache.dubbo.config.RegistryConfig;
import org.apache.dubbo.config.bootstrap.DubboBootstrap;
import org.apache.dubbo.rpc.RpcContext;
import org.apache.dubbo.rpc.service.GenericService;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfSystemProperty;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.junit.jupiter.api.TestMethodOrder;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.io.ByteArrayInputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.UUID;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

/** Gateway是真实随机端口HTTP服务，Provider是独立exec.jar进程；只替换外部本地账号身份来源。 */
@io.github.chenyilei2016.openplatform.testing.TestAdministrators
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "spring.sql.init.schema-locations=classpath:db/access-schema.sql,classpath:db/mcp-schema.sql,classpath:db/catalog-schema.sql,classpath:db/api-copy-schema.sql,classpath:db/dubbo-connection-schema.sql,classpath:db/token-schema.sql,classpath:db/publication-schema.sql,classpath:db/governance-schema.sql,classpath:db/observability-schema.sql,classpath:db/operations-metrics-schema.sql",
          "open-platform.publish.audit.enabled=false",
        "test.admin.operators[0].tenant-id=tenant-1",
        "test.admin.operators[0].employee-no=operator-1",
        "test.admin.operators[0].permissions[0]=MANAGE_APPLICATIONS",
        "test.admin.operators[0].permissions[1]=MANAGE_APIS",
        "test.admin.operators[0].permissions[2]=PUBLISH_APIS",
        "test.admin.operators[0].permissions[3]=VIEW_AUDIT"
})
@ExtendWith(OutputCaptureExtension.class)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@org.springframework.context.annotation.Import(io.github.chenyilei2016.openplatform.testing.CatalogReferenceFixture.class)
class HttpOrderGatewayIT {
    private static final String INTERNAL_CREDENTIAL = "integration-" + UUID.randomUUID();
    private static Process provider;
    private static Process redis;
    private static int redisPort;
    private static String providerOrigin;
    private static String providerDubboUrl;
    private static Path providerAccessLog;
    private static final String NACOS_GROUP = "task101-" + UUID.randomUUID();
    private static final String DUBBO_INTERFACE = "io.github.chenyilei2016.example.order.rpc.OrderQueryFacade";
    private static final String DUBBO_REQUEST_TYPE = "io.github.chenyilei2016.example.order.rpc.OrderQueryRequest";
    private static final HttpClient CLIENT = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).build();
    private static final JsonMapper JSON = JsonMapper.builder().build();
    @LocalServerPort int port;
    @Autowired JdbcTemplate database;
    @Autowired org.springframework.cloud.loadbalancer.support.LoadBalancerClientFactory hostLoadBalancers;
    @Autowired io.github.chenyilei2016.openplatform.domain.catalog.ApiCatalogRepository catalog;
    @MockitoBean AccountAuthentication identity;
    @MockitoBean EmployeeDirectory employees;
    @MockitoBean io.github.chenyilei2016.openplatform.infrastructure.connection.runtime.ManagedDubboConnectionRuntime connections;
    private static io.github.chenyilei2016.openplatform.testing.DirectDubboTestConnection directConnection;
    @Autowired io.github.chenyilei2016.openplatform.domain.connection.DubboConnectionRepository connectionRepository;
    @Autowired io.github.chenyilei2016.openplatform.domain.environmentrelease.ReleaseEnvironment environment;
    private String csrf;
    private String sessionCookie;

    @DynamicPropertySource
    static void providerProperties(DynamicPropertyRegistry properties) throws Exception {
        String nacosAddress = System.getProperty("task101.nacos.address");
        if (nacosAddress != null) {
            if (!nacosAddress.matches("127\\.0\\.0\\.1:[0-9]+"))
                throw new IllegalArgumentException("101验收仅允许显式本机隔离Nacos");
            properties.add("spring.cloud.nacos.discovery.enabled", () -> true);
            properties.add("spring.cloud.nacos.discovery.server-addr", () -> nacosAddress);
            properties.add("spring.cloud.nacos.discovery.namespace", () -> "");
            properties.add("spring.cloud.nacos.discovery.group", () -> NACOS_GROUP);
            properties.add("spring.cloud.nacos.discovery.register-enabled", () -> false);
            properties.add("spring.cloud.loadbalancer.cache.ttl", () -> "1s");
        }
        try (var reservation = new java.net.ServerSocket(0, 50, java.net.InetAddress.ofLiteral("127.0.0.1"))) {
            redisPort = reservation.getLocalPort();
        }
        startRedis();
        properties.add("spring.data.redis.host", () -> "127.0.0.1");
        properties.add("spring.data.redis.port", () -> redisPort);
        properties.add("spring.data.redis.password", () -> "");
        Path jar = Path.of(System.getProperty("order.provider.jar"));
        assertThat(Files.isRegularFile(jar)).as("Provider exec.jar必须先在package阶段构建").isTrue();
        Path log = Files.createTempFile("szopen07-provider-", ".log");
        ProcessBuilder builder = new ProcessBuilder(Path.of(System.getProperty("java.home"), "bin", "java").toString(),
                "-Dfile.encoding=UTF-8", "-DsocksProxyHost=", "-jar", jar.toAbsolutePath().toString(), "--server.port=" + providerPort(), "--server.address=127.0.0.1", "--example.order.dubbo.port=-1");
        if (nacosAddress != null) {
            Path logRoot = jar.toAbsolutePath().getParent().getParent().getParent().getParent().resolve(".local/logs/101");
            Files.createDirectories(logRoot);
            Path accessDirectory = Files.createTempDirectory(logRoot, "provider-");
            providerAccessLog = accessDirectory.resolve("access.log");
            // 标准Tomcat运维日志仅在隔离验收启用；不记录Token、proof、正文或签名。
            builder.command().addAll(List.of("--server.tomcat.accesslog.enabled=true", "--server.tomcat.accesslog.directory=" + accessDirectory,
                    "--server.tomcat.accesslog.prefix=access", "--server.tomcat.accesslog.suffix=.log",
                    "--server.tomcat.accesslog.rotate=false", "--server.tomcat.accesslog.buffered=false",
                    "--server.tomcat.accesslog.pattern=%{X-Request-Id}i|%{traceparent}i|%{tracestate}i|%{X-Open-Platform-Tenant-Id}i|%{X-Open-Platform-Employee-Id}i|%s"));
        }
        builder.environment().put("SPRING_APPLICATION_JSON", "{\"open-platform\":{\"provider\":{\"environment-id\":\"local\",\"public-keys\":{\"test\":\""
                + io.github.chenyilei2016.openplatform.testing.ProviderProofTestSupport.PUBLIC_KEY + "\"}}}}");
        provider = builder.redirectErrorStream(true).redirectOutput(log.toFile()).start();
        var pattern = Pattern.compile("Tomcat started on port (\\d+)");
        var dubboPattern = Pattern.compile("Order Dubbo provider listening on port (\\d+)");
        long deadline = System.nanoTime() + Duration.ofSeconds(40).toNanos();
        while (System.nanoTime() < deadline && provider.isAlive()) {
            String output = Files.readString(log);
            var matcher = pattern.matcher(output);
            var dubboMatcher = dubboPattern.matcher(output);
            if (matcher.find() && dubboMatcher.find()) {
                providerOrigin = "http://127.0.0.1:" + matcher.group(1);
                providerDubboUrl = "dubbo://[::1]:" + dubboMatcher.group(1);
                return;
            }
            Thread.sleep(100);
        }
        provider.destroyForcibly();
        redis.destroyForcibly();
        throw new IllegalStateException("Provider双协议未在40秒内启动，日志：" + log);
    }

    private static int providerPort() throws java.io.IOException {
        try (java.net.ServerSocket reservation = new java.net.ServerSocket(0, 50, java.net.InetAddress.ofLiteral("127.0.0.1"))) {
            return reservation.getLocalPort();
        }
    }

    private static void startRedis() throws Exception {
        Path redisLog = Files.createTempFile("szopen08-redis-", ".log");
        redis = new ProcessBuilder(System.getProperty("redis.server.binary", "redis-server"),
                "--bind", "127.0.0.1", "--port", Integer.toString(redisPort), "--save", "",
                "--appendonly", "no", "--protected-mode", "yes")
                .redirectErrorStream(true).redirectOutput(redisLog.toFile()).start();
        long redisDeadline = System.nanoTime() + Duration.ofSeconds(10).toNanos();
        while (redis.isAlive() && System.nanoTime() < redisDeadline
                && !Files.readString(redisLog).contains("Ready to accept connections")) Thread.sleep(50);
        if (!redis.isAlive() || !Files.readString(redisLog).contains("Ready to accept connections")) {
            redis.destroyForcibly();
            throw new IllegalStateException("独立测试Redis未启动，请安装redis-server，日志：" + redisLog);
        }
    }

    @AfterAll
    static void shutdown() throws Exception {
        CLIENT.close();
        if (directConnection != null) directConnection.close();
        if (redis != null && redis.isAlive()) {
            redis.destroy();
            if (!redis.waitFor(5, java.util.concurrent.TimeUnit.SECONDS)) redis.destroyForcibly();
        }
        if (provider != null) {
            provider.destroy();
            if (!provider.waitFor(5, java.util.concurrent.TimeUnit.SECONDS)) provider.destroyForcibly();
        }
    }

    @BeforeEach
    void login() throws Exception {
        if (directConnection == null) directConnection = new io.github.chenyilei2016.openplatform.testing.DirectDubboTestConnection(DUBBO_INTERFACE, "1.0.0", "order-example", providerDubboUrl, 2000);
        directConnection.install(connections);
        if (connectionRepository.find("it-connection").isEmpty()) {
            java.time.Instant now = java.time.Instant.now();
            connectionRepository.create(new io.github.chenyilei2016.openplatform.domain.connection.DubboConnection("it-connection", "传输IT连接", environment.environmentId(), "仅替换注册发现", 1, 1L, true, 1, now));
            io.github.chenyilei2016.openplatform.domain.connection.DubboConnectionConfig config = JSON.readValue("{\"registry\":{\"address\":\"nacos://127.0.0.1:8848\",\"namespace\":\"\",\"group\":\"IT\"},\"metadata\":{\"type\":\"NONE\"},\"discoveryMode\":\"INTERFACE\",\"providerMetadataMode\":\"LOCAL\"}", io.github.chenyilei2016.openplatform.domain.connection.DubboConnectionConfig.class);
            connectionRepository.insertRevision(new io.github.chenyilei2016.openplatform.domain.connection.DubboConnectionRevision("it-connection", 1, config, now));
        }
        TestAccount user = new TestAccount();
        user.setId(11L); user.setTenantId("tenant-1"); user.setEmployeeNoStr("operator-1");
        when(identity.current("test-session")).thenAnswer(invocation -> user.toAccount());
        when(identity.authenticate("test-session", "fixture-password")).thenReturn(new AccountAuthentication.Account("test-session", user.toAccount().employee(), null));
        when(employees.find(org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.anyString())).thenAnswer(invocation -> {
            String tenant = invocation.getArgument(0); String employeeNo = invocation.getArgument(1);
            TestEmployee employee = new TestEmployee();
            employee.setTenantId(Long.valueOf(tenant));
            employee.setId("E101".equals(employeeNo) ? 1011L : 1012L);
            employee.setUserId("E101".equals(employeeNo) ? 10101L : 10102L);
            employee.setEmployeeNoStr(employeeNo); employee.setName("集成人员");
            employee.setEnabled(true); employee.setEmployeeStatus(4);
            return employee.toIdentity();
        });
        HttpResponse<String> csrfResponse = CLIENT.send(request("GET", "/auth/csrf", null).build(), HttpResponse.BodyHandlers.ofString());
        String initialCookie = csrfResponse.headers().firstValue("Set-Cookie").orElseThrow().split(";", 2)[0];
        String loginCsrf = JSON.readTree(csrfResponse.body()).at("/data/token").asText();
        HttpResponse<String> loginResponse = CLIENT.send(request("POST", "/auth/login", Map.of("username", "test-session", "password", "fixture-password"))
                .header("Cookie", initialCookie).header("X-CSRF-Token", loginCsrf).build(), HttpResponse.BodyHandlers.ofString());
        assertThat(loginResponse.statusCode()).isEqualTo(200);
        sessionCookie = loginResponse.headers().firstValue("Set-Cookie").orElseThrow().split(";", 2)[0];
        var session = CLIENT.send(request("GET", "/admin-api/session", null).header("Cookie", sessionCookie).build(), HttpResponse.BodyHandlers.ofString());
        assertThat(session.statusCode()).isEqualTo(200);
        csrf = session.headers().firstValue("X-CSRF-Token").orElseThrow();
    }

    @ParameterizedTest
    @EnumSource(ApiProtocol.class)
    void twoProcessesExecuteTheSameOrderNumberWithTenantIsolationAndPublishedMappings(ApiProtocol protocol) throws Exception {
        Fixture fixture = fixture(protocol);
        String firstToken = token(fixture.application(), "101", null);
        String secondToken = token(fixture.application(), "202", null);
        JsonNode first = data(invoke(fixture.service(), firstToken, "{}"), 200);
        JsonNode second = data(invoke(fixture.service(), secondToken, "{\"orderNo\":\"COMMON-001\"}"), 200);
        assertThat(first.get("tenantId").asText()).isEqualTo("101");
        assertThat(first.get("amount").decimalValue()).isEqualByComparingTo("101.25");
        assertThat(second.get("tenantId").asText()).isEqualTo("202");
        assertThat(second.get("amount").decimalValue()).isEqualByComparingTo("202.50");
        assertThat(provider.pid()).isNotEqualTo(ProcessHandle.current().pid());
        assertThat(provider.isAlive()).isTrue();

        var changed = definition(fixture.service(), fixture.scope(), protocol);
        if (protocol == ApiProtocol.HTTP) {
            changed.put("binding", Map.of("protocol", "HTTP", "timeoutMillis", 2000,
                    "http", Map.of("url", "http://127.0.0.1:1/must-not-execute", "method", "POST")));
        } else {
            changed.put("binding", Map.of("protocol", "DUBBO", "timeoutMillis", 2000,
                    "dubbo", Map.of("interfaceName", DUBBO_INTERFACE, "method", "mustNotExecute", "version", "1.0.0",
                            "group", "order-example", "parameterTypes", List.of(DUBBO_REQUEST_TYPE), "connectionId", "it-connection", "connectionRevision", 1)));
        }
        changed.put("expectedRevision", 1);
        admin("PUT", "/admin-api/apis/" + fixture.apiId(), changed);
        assertThat(data(invoke(fixture.service(), firstToken, "{}"), 200).get("tenantId").asText()).isEqualTo("101");
        assertThat(invoke(fixture.service(), firstToken, "{\"orderNo\":\"COMMON-001\",\"tenantId\":\"202\"}").statusCode()).isEqualTo(400);
        var spoof = request("POST", "/api/oauth/" + fixture.service() + "/v1/query", Map.of("orderNo", "COMMON-001"))
                .header("Authorization", "Bearer " + firstToken).header("X-Open-Platform-Tenant-Id", "202");
        assertThat(CLIENT.send(spoof.build(), HttpResponse.BodyHandlers.ofString()).statusCode()).isEqualTo(400);
    }

    @ParameterizedTest
    @EnumSource(ApiProtocol.class)
    void providerRejectsForgedTrustAndDelegatedUserCannotReadAnotherOwnersOrder(ApiProtocol protocol) throws Exception {
        Fixture fixture = fixture(protocol);
        String grantId = fixture.firstTenantGrant();
        var denied = request("POST", "/api/token", Map.of("appKey", fixture.application().at("/application/appKey").asText(),
                "appSecret", fixture.application().get("appSecret").asText(), "tenantId", "101", "employeeNo", "E101"));
        assertThat(CLIENT.send(denied.build(), HttpResponse.BodyHandlers.ofString()).statusCode()).isEqualTo(403);
        JsonNode grant = admin("POST", "/admin-api/tenant-grants/" + grantId + "/users", Map.of("employeeNo", "E101"));
        String userToken = token(fixture.application(), "101", "E101");
        data(invoke(fixture.service(), userToken, "{}"), 200);
        assertThat(invoke(fixture.service(), userToken, "{\"orderNo\":\"PRIVATE-002\"}").statusCode()).isEqualTo(403);
        assertThat(invoke(fixture.service(), userToken, "{\"orderNo\":\"missing\"}").statusCode()).isEqualTo(404);
        admin("DELETE", "/admin-api/user-grants/" + grant.get("id").asText(), null);
        assertThat(invoke(fixture.service(), userToken, "{}").statusCode()).isEqualTo(401);

        if (protocol == ApiProtocol.HTTP) {
            var direct = HttpRequest.newBuilder(URI.create(providerOrigin + "/internal/orders/query"))
                    .header("Content-Type", "application/json").header("X-Open-Platform-Tenant-Id", "101")
                    .header("X-Open-Platform-Credential", "forged-credential-without-platform-trust")
                    .POST(HttpRequest.BodyPublishers.ofString("{\"orderNo\":\"COMMON-001\",\"tenantId\":\"101\"}"));
            assertThat(CLIENT.send(direct.build(), HttpResponse.BodyHandlers.ofString()).statusCode()).isEqualTo(403);
        } else {
            ApplicationConfig application = new ApplicationConfig("order-provider-trust-check");
            application.setQosEnable(false);
            DubboBootstrap bootstrap = DubboBootstrap.newInstance();
            ReferenceConfig<GenericService> reference = new ReferenceConfig<>();
            reference.setInterface(DUBBO_INTERFACE);
            reference.setVersion("1.0.0");
            reference.setGroup("order-example");
            reference.setGeneric("true");
            reference.setUrl(providerDubboUrl);
            reference.setTimeout(2000);
            reference.setRetries(0);
            reference.setCheck(false);
            reference.setInjvm(false);
            RpcContext.RestoreContext saved = new RpcContext.RestoreContext();
            RpcContext.removeContext();
            try {
                bootstrap.application(application).registry(new RegistryConfig("N/A")).reference(reference).start();
                RpcContext.getClientAttachment().setAttachment("x-open-platform-credential", "forged-credential-without-platform-trust");
                RpcContext.getClientAttachment().setAttachment("x-open-platform-tenant-id", "101");
                RpcContext.getClientAttachment().setAttachment("x-open-platform-application-id", "forged-application");
                RpcContext.getClientAttachment().setAttachment("x-open-platform-app-key", "forged-app-key");
                RpcContext.getClientAttachment().setAttachment("x-request-id", UUID.randomUUID().toString());
                // 伪造凭据应在泛化DTO解析前被拒绝，不允许先解析客户端提供的class类型提示。
                Object deniedResult = reference.get().$invoke("query", new String[]{DUBBO_REQUEST_TYPE},
                        new Object[]{Map.of("orderNo", "COMMON-001", "tenantId", "101", "class", "untrusted.MissingOrderType")});
                assertThat(RpcContext.getClientResponseContext().getAttachment("x-open-platform-status")).isEqualTo("403");
                assertThat(deniedResult).satisfiesAnyOf(value -> assertThat(value).isNull(),
                        value -> assertThat(value).isEqualTo(Map.of()));
            } finally {
                RpcContext.removeContext();
                saved.restore();
                reference.destroy();
                bootstrap.destroy();
            }
        }
    }

    @ParameterizedTest
    @EnumSource(ApiProtocol.class)
    void scopeDisableAndChunkedRequestLimitsAreEnforcedOverRealHttp(ApiProtocol protocol) throws Exception {
        Fixture fixture = fixture(protocol);
        String token = token(fixture.application(), "101", null);
        var nonJson = HttpRequest.newBuilder(URI.create(origin() + "/api/oauth/" + fixture.service() + "/v1/query"))
                .header("Content-Type", "text/plain").header("Authorization", "Bearer " + token)
                .POST(HttpRequest.BodyPublishers.ofString("{}"));
        assertThat(CLIENT.send(nonJson.build(), HttpResponse.BodyHandlers.ofString()).statusCode()).isEqualTo(415);
        byte[] excessive = ("{\"orderNo\":\"" + "x".repeat(66_000) + "\"}").getBytes(java.nio.charset.StandardCharsets.UTF_8);
        var oversized = HttpRequest.newBuilder(URI.create(origin() + "/api/oauth/" + fixture.service() + "/v1/query"))
                .timeout(Duration.ofSeconds(10)).header("Content-Type", "application/json").header("Authorization", "Bearer " + token)
                .POST(HttpRequest.BodyPublishers.ofInputStream(() -> new ByteArrayInputStream(excessive)));
        assertThat(CLIENT.send(oversized.build(), HttpResponse.BodyHandlers.ofString()).statusCode()).isEqualTo(413);
        data(invoke(fixture.service(), token, "{}"), 200);
        admin("PUT", "/admin-api/applications/" + fixture.application().at("/application/id").asText() + "/scopes", Map.of("scopeCodes", List.of()));
        String unscoped = token(fixture.application(), "101", null);
        assertThat(invoke(fixture.service(), unscoped, "{}").statusCode()).isEqualTo(403);
        JsonNode state = admin("GET", "/admin-api/publications/apis/" + fixture.apiId() + "/state", null);
        admin("PUT", "/admin-api/publications/apis/" + fixture.apiId() + "/status", Map.of("enabled", false,
                "expectedStateVersion", state.get("stateVersion").asLong(), "reason", "集成停用"));
        assertThat(invoke(fixture.service(), unscoped, "{}").statusCode()).isEqualTo(404);
    }

    @ParameterizedTest
    @EnumSource(ApiProtocol.class)
    void nestedDefaultExpansionIsRejectedBeforeUnboundedAllocation(ApiProtocol protocol) throws Exception {
        Fixture fixture = fixture(protocol);
        Map<String, Object> leaf = Map.of("type", "OBJECT", "properties", Map.of("value", Map.of("type", "STRING", "defaultValue", "x")));
        List<Map<String, Object>> emptyObjects = java.util.Collections.nCopies(200, Map.of());
        Map<String, Object> level = leaf;
        for (String field : List.of("cells", "rows", "batches")) {
            level = Map.of("type", "OBJECT", "properties", Map.of(field,
                    Map.of("type", "ARRAY", "defaultValue", emptyObjects, "items", level)));
        }
        @SuppressWarnings("unchecked")
        Map<String, Object> fields = new LinkedHashMap<>((Map<String, Object>) level.get("properties"));
        fields.put("orderNo", Map.of("type", "STRING", "defaultValue", "COMMON-001"));
        Map<String, Object> body = definition(fixture.service(), fixture.scope(), protocol);
        body.put("requestSchema", Map.of("type", "OBJECT", "properties", fields));
        body.put("expectedRevision", 1);
        admin("PUT", "/admin-api/apis/" + fixture.apiId(), body);
        admin("POST", "/admin-api/publications/apis/" + fixture.apiId() + "/submissions",
                Map.of("expectedDraftRevision", 2, "expectedStateVersion", 1, "submissionKey", UUID.randomUUID().toString(), "comment", "展开预算验收"));
        String token = token(fixture.application(), "101", null);
        assertThat(invoke(fixture.service(), token, "{}").statusCode()).isEqualTo(400);
        data(invoke(fixture.service(), token, "{\"batches\":[],\"orderNo\":\"COMMON-001\"}"), 200);
    }

    @ParameterizedTest
    @EnumSource(ApiProtocol.class)
    void realRedisAppliesApplicationAndApiPoliciesAndIgnoresForwardedIp(ApiProtocol protocol) throws Exception {
        Fixture fixture = fixture(protocol);
        String token = token(fixture.application(), "101", null);
        String applicationId = fixture.application().at("/application/id").asText();
        String applicationPolicy = publishQuotaAndIpRule("APPLICATION", applicationId, null, 2, "ALLOWLIST", List.of("198.51.100.4"));
        var forged = request("POST", "/api/oauth/" + fixture.service() + "/v1/query", Map.of())
                .header("Authorization", "Bearer " + token).header("X-Forwarded-For", "198.51.100.4")
                .header("Forwarded", "for=198.51.100.4");
        assertThat(CLIENT.send(forged.build(), HttpResponse.BodyHandlers.ofString()).statusCode()).isEqualTo(403);
        JsonNode policy = admin("GET", "/admin-api/governance-rules/" + applicationPolicy, null);
        Map<String, Object> config = JSON.convertValue(policy.get("config"), new tools.jackson.core.type.TypeReference<Map<String, Object>>() {});
        config.put("ipAddresses", List.of("127.0.0.1"));
        admin("PUT", "/admin-api/governance-rules/" + applicationPolicy, Map.of("name", "集成验收", "config", config, "expectedDraftRevision", policy.get("draftRevision").asLong()));
        publishGovernanceDraft(applicationPolicy);
        publishQuotaAndIpRule("API", null, fixture.apiId(), 1, "UNRESTRICTED", List.of());
        data(invoke(fixture.service(), token, "{}"), 200);
        var throttled = invoke(fixture.service(), token, "{}");
        assertThat(throttled.statusCode()).isEqualTo(429);
        String requestId = throttled.headers().firstValue("X-Request-Id").orElseThrow();
        JsonNode rows = awaitCall(requestId);
        assertThat(rows.at("/items/0/applicationId").asText()).isEqualTo(applicationId);
        assertThat(rows.at("/items/0/httpStatus").asInt()).isEqualTo(429);
        assertThat(rows.at("/items/0/clientIp").asText()).isEqualTo("127.0.0.1");
        // API拒绝不消耗应用计数；取消API配额后恰好还剩应用的一次调用。
        updateGovernanceRule("API:" + fixture.apiId(), Map.of("dailyQuota", 0, "ipMode", "UNRESTRICTED", "ipAddresses", List.of()));
        data(invoke(fixture.service(), token, "{}"), 200);
        assertThat(invoke(fixture.service(), token, "{}").statusCode()).isEqualTo(429);
    }

    private String publishQuotaAndIpRule(String type, String applicationId, String apiId, int quota, String ipMode, List<String> addresses) throws Exception {
        Map<String, Object> target = new java.util.HashMap<>();
        target.put("type", type); target.put("applicationId", applicationId); target.put("apiId", apiId);
        JsonNode created = admin("POST", "/admin-api/governance-rules", Map.of("name", "集成验收", "config", Map.of(
                "target", target, "enabled", true, "mode", "ENFORCE", "rate", Map.of("algorithm", "NONE", "perSecond", 0, "burst", 0),
                "dailyQuota", quota, "ipMode", ipMode, "ipAddresses", addresses)));
        String id = created.get("id").asText(); publishGovernanceDraft(id); return id;
    }
    private void updateGovernanceRule(String id, Map<String, Object> changes) throws Exception {
        JsonNode draft = admin("GET", "/admin-api/governance-rules/" + id, null);
        Map<String, Object> config = JSON.convertValue(draft.get("config"), new tools.jackson.core.type.TypeReference<Map<String, Object>>() {});
        config.putAll(changes);
        admin("PUT", "/admin-api/governance-rules/" + id, Map.of("name", draft.get("name").asText(),
                "config", config, "expectedDraftRevision", draft.get("draftRevision").asLong()));
        publishGovernanceDraft(id);
    }
    private JsonNode publishGovernanceDraft(String id) throws Exception {
        JsonNode preview = admin("POST", "/admin-api/governance-rules/" + id + "/preview", Map.of());
        return admin("POST", "/admin-api/governance-rules/" + id + "/publish", Map.of("expectedDraftRevision", preview.get("draftRevision").asLong(),
                "expectedStateVersion", preview.get("stateVersion").asLong(), "previewDigest", preview.get("digest").asText()));
    }

    @ParameterizedTest
    @EnumSource(ApiProtocol.class)
    void draftDebugUsesSavedRevisionAndSharedIdentityAndProducesSafeRecords(ApiProtocol protocol) throws Exception {
        Fixture fixture = fixture(protocol);
        String token = token(fixture.application(), "101", null);
        Map<String, Object> draft = definition(fixture.service(), fixture.scope(), protocol);
        draft.put("expectedRevision", 1);
        draft.put("requestSchema", Map.of("type", "OBJECT", "properties", Map.of("orderNo",
                Map.of("type", "STRING", "required", true, "defaultValue", "PRIVATE-002"))));
        admin("PUT", "/admin-api/apis/" + fixture.apiId(), draft);
        data(invoke(fixture.service(), token, "{}"), 200);
        var debugRequest = request("POST", "/admin-api/apis/" + fixture.apiId() + "/debug",
                Map.of("expectedRevision", 2, "input", Map.of()))
                .header("Cookie", sessionCookie).header("X-CSRF-Token", csrf)
                .header("Authorization", "Bearer " + token);
        var response = CLIENT.send(debugRequest.build(), HttpResponse.BodyHandlers.ofString());
        var debug = data(response, 200);
        assertThat(debug.at("/publicResponse/value/data/orderNo").asText()).isEqualTo("PRIVATE-002");
        assertThat(debug.get("durationMillis").asLong()).isGreaterThanOrEqualTo(0);
        assertThat(data(invoke(fixture.service(), token, "{}"), 200).get("orderNo").asText()).isEqualTo("COMMON-001");
        String debugId = response.headers().firstValue("X-Request-Id").orElseThrow();
        JsonNode rows = awaitCall(debugId);
        assertThat(rows.at("/items/0/mode").asText()).isEqualTo("DRAFT_DEBUG");
        assertThat(rows.at("/items/0/draftRevision").asLong()).isEqualTo(2);
        assertThat(rows.at("/items/0/releaseId").isNull()).isTrue();
        assertThat(rows.at("/items/0/operatorEmployeeNo").asText()).isEqualTo("operator-1");
        assertThat(rows.toString()).doesNotContain(token, "PRIVATE-002", "arg0", INTERNAL_CREDENTIAL);
        var stale = request("POST", "/admin-api/apis/" + fixture.apiId() + "/debug", Map.of("expectedRevision", 1, "input", Map.of()))
                .header("Cookie", sessionCookie).header("X-CSRF-Token", csrf).header("Authorization", "Bearer " + token);
        assertThat(CLIENT.send(stale.build(), HttpResponse.BodyHandlers.ofString()).statusCode()).isEqualTo(409);
        admin("POST", "/admin-api/tenant-grants/" + fixture.firstTenantGrant() + "/users", Map.of("employeeNo", "E101"));
        String userToken = token(fixture.application(), "101", "E101");
        var delegated = request("POST", "/admin-api/apis/" + fixture.apiId() + "/debug", Map.of("expectedRevision", 2, "input", Map.of()))
                .header("Cookie", sessionCookie).header("X-CSRF-Token", csrf).header("Authorization", "Bearer " + userToken);
        assertThat(data(CLIENT.send(delegated.build(), HttpResponse.BodyHandlers.ofString()), 200).at("/publicResponse/value/code").asInt()).isEqualTo(40300001);
        publishQuotaAndIpRule("API", null, fixture.apiId(), 0, "DENYLIST", List.of("127.0.0.1"));
        assertThat(CLIENT.send(debugRequest.build(), HttpResponse.BodyHandlers.ofString()).statusCode()).isEqualTo(403);
        updateGovernanceRule("API:" + fixture.apiId(), Map.of("dailyQuota", 0, "ipMode", "UNRESTRICTED", "ipAddresses", List.of()));
        admin("PUT", "/admin-api/applications/" + fixture.application().at("/application/id").asText() + "/scopes",
                Map.of("scopeCodes", List.of()));
        String unscoped = token(fixture.application(), "101", null);
        var withoutScope = request("POST", "/admin-api/apis/" + fixture.apiId() + "/debug", Map.of("expectedRevision", 2, "input", Map.of()))
                .header("Cookie", sessionCookie).header("X-CSRF-Token", csrf).header("Authorization", "Bearer " + unscoped);
        assertThat(CLIENT.send(withoutScope.build(), HttpResponse.BodyHandlers.ofString()).statusCode()).isEqualTo(403);
    }

    @ParameterizedTest
    @EnumSource(ApiProtocol.class)
    void concurrentCallsShareAnAtomicQuota(ApiProtocol protocol) throws Exception {
        Fixture fixture = fixture(protocol);
        String token = token(fixture.application(), "101", null);
        publishQuotaAndIpRule("API", null, fixture.apiId(), 5, "UNRESTRICTED", List.of());
        try (var callers = java.util.concurrent.Executors.newFixedThreadPool(8)) {
            var start = new java.util.concurrent.CountDownLatch(1);
            var futures = new java.util.ArrayList<java.util.concurrent.Future<Integer>>();
            for (int i = 0; i < 20; i++) futures.add(callers.submit(() -> {
                start.await();
                return invoke(fixture.service(), token, "{}").statusCode();
            }));
            start.countDown();
            var statuses = new java.util.ArrayList<Integer>();
            for (var future : futures) statuses.add(future.get(15, java.util.concurrent.TimeUnit.SECONDS));
            assertThat(statuses).containsOnly(200, 429);
            assertThat(statuses.stream().filter(status -> status == 200).count()).isEqualTo(5);
            assertThat(statuses.stream().filter(status -> status == 429).count()).isEqualTo(15);
        }
    }

    @ParameterizedTest
    @EnumSource(ApiProtocol.class)
    void callRecordStorageFailurePreservesBusinessResponsesAndRecovers(ApiProtocol protocol, CapturedOutput output) throws Exception {
        Fixture fixture = fixture(protocol);
        String token = token(fixture.application(), "101", null);
        // 独立H2测试库中仅暂时改名，不删除记录；通过真实网关和日志故障信号验收。
        database.execute("ALTER TABLE platform_call_record RENAME TO unavailable_call_record");
        try {
            var success = invoke(fixture.service(), token, "{}");
            data(success, 200);
            var missing = invoke(fixture.service(), token, "{\"orderNo\":\"missing\"}");
            assertThat(missing.statusCode()).isEqualTo(404);
            String successId = success.headers().firstValue("X-Request-Id").orElseThrow();
            String missingId = missing.headers().firstValue("X-Request-Id").orElseThrow();
            for (int attempt = 0; attempt < 60 && !(output.getAll().contains("requestId=" + successId)
                    && output.getAll().contains("requestId=" + missingId)); attempt++) Thread.sleep(50);
            assertThat(output.getAll()).contains("requestId=" + successId, "requestId=" + missingId);
        } finally {
            database.execute("ALTER TABLE unavailable_call_record RENAME TO platform_call_record");
        }
        var restored = invoke(fixture.service(), token, "{}");
        data(restored, 200);
        assertThat(awaitCall(restored.headers().firstValue("X-Request-Id").orElseThrow())
                .at("/items/0/outcome").asText()).isEqualTo("SUCCESS");
    }

    @ParameterizedTest
    @EnumSource(ApiProtocol.class)
    void publishedTokenBucketAndApplicationApiQuotaReachTheRealProviderOnlyAfterJointAdmission(ApiProtocol protocol) throws Exception {
        Fixture fixture = fixture(protocol);
        String accessToken = token(fixture.application(), "101", null);
        JsonNode apiRelease = publishGovernanceRule(Map.of("type", "API", "apiId", fixture.apiId()), "ENFORCE",
                Map.of("algorithm", "TOKEN_BUCKET", "perSecond", 100, "burst", 2), 0);
        JsonNode combinedRelease = publishGovernanceRule(Map.of("type", "APPLICATION_API",
                        "applicationId", fixture.application().at("/application/id").asText(), "apiId", fixture.apiId()), "ENFORCE",
                Map.of("algorithm", "NONE", "perSecond", 0, "burst", 0), 1);
        // 新桶可立即使用突发额度；组合日配额与令牌桶一次原子准入。
        HttpResponse<String> admitted = invoke(fixture.service(), accessToken, "{}");
        assertThat(data(admitted, 200).get("amount").decimalValue()).isEqualByComparingTo("101.25");
        JsonNode recorded = awaitCall(admitted.headers().firstValue("X-Request-Id").orElseThrow());
        assertThat(recorded.at("/items/0/governance/allowed").asBoolean()).isTrue();
        assertThat(recorded.at("/items/0/governance/hits").size()).isEqualTo(2);
        assertThat(recorded.at("/items/0/governance/hits").toString()).contains(
                apiRelease.get("ruleId").asText(), combinedRelease.get("ruleId").asText(), "APPLICATION_API", "TOKEN_BUCKET");
        HttpResponse<String> exhausted = invoke(fixture.service(), accessToken, "{}");
        JsonNode denied = data(exhausted, 429);
        assertThat(denied.get("reason").asText()).isEqualTo("DAILY_QUOTA");
        assertThat(denied.has("hits")).isFalse();
        assertThat(Long.parseLong(exhausted.headers().firstValue("Retry-After").orElseThrow())).isBetween(1L, 86400L);
        assertThat(awaitCall(exhausted.headers().firstValue("X-Request-Id").orElseThrow())
                .at("/items/0/governance/denialReason").asText()).isEqualTo("DAILY_QUOTA");
    }

    @ParameterizedTest
    @EnumSource(ApiProtocol.class)
    void observedQuotaDoesNotBlockOtherTenantsAndDraftDebugUsesIndependentDailyCounters(ApiProtocol protocol) throws Exception {
        Fixture fixture = fixture(protocol);
        String firstToken = token(fixture.application(), "101", null);
        String secondToken = token(fixture.application(), "202", null);
        Map<String, Object> noRate = Map.of("algorithm", "NONE", "perSecond", 0, "burst", 0);
        JsonNode observed = publishGovernanceRule(Map.of("type", "API", "apiId", fixture.apiId()), "OBSERVE", noRate, 1);
        publishGovernanceRule(Map.of("type", "TENANT_API", "tenantId", "101", "apiId", fixture.apiId()), "ENFORCE", noRate, 1);
        data(invoke(fixture.service(), firstToken, "{}"), 200);
        HttpResponse<String> observedCall = invoke(fixture.service(), secondToken, "{}");
        assertThat(data(observedCall, 200).get("amount").decimalValue()).isEqualByComparingTo("202.50");
        JsonNode observation = awaitCall(observedCall.headers().firstValue("X-Request-Id").orElseThrow());
        assertThat(observation.at("/items/0/governance/allowed").asBoolean()).isTrue();
        assertThat(observation.at("/items/0/governance/denialReason").asText()).isEqualTo("NONE");
        assertThat(observation.at("/items/0/governance/hits").size()).isEqualTo(1);
        assertThat(observation.at("/items/0/governance/hits/0/ruleId").asText()).isEqualTo(observed.get("ruleId").asText());
        assertThat(observation.at("/items/0/governance/hits/0/mode").asText()).isEqualTo("OBSERVE");
        assertThat(observation.at("/items/0/governance/hits/0/reason").asText()).isEqualTo("DAILY_QUOTA");
        HttpResponse<String> formalDenied = invoke(fixture.service(), firstToken, "{}");
        assertThat(data(formalDenied, 429).get("reason").asText()).isEqualTo("DAILY_QUOTA");

        HttpRequest debug = request("POST", "/admin-api/apis/" + fixture.apiId() + "/debug", Map.of("expectedRevision", 1, "input", Map.of()))
                .header("Cookie", sessionCookie).header("X-CSRF-Token", csrf)
                .header("Authorization", "Bearer " + firstToken).build();
        HttpResponse<String> debugResponse = CLIENT.send(debug, HttpResponse.BodyHandlers.ofString());
        assertThat(data(debugResponse, 200).at("/publicResponse/value/data/amount").decimalValue()).isEqualByComparingTo("101.25");
        JsonNode debugRecord = awaitCall(debugResponse.headers().firstValue("X-Request-Id").orElseThrow());
        assertThat(debugRecord.at("/items/0/mode").asText()).isEqualTo("DRAFT_DEBUG");
        assertThat(debugRecord.at("/items/0/governance/allowed").asBoolean()).isTrue();
        assertThat(debugRecord.at("/items/0/governance/hits").size()).isEqualTo(3);
        assertThat(data(CLIENT.send(debug, HttpResponse.BodyHandlers.ofString()), 429).get("reason").asText()).isEqualTo("DAILY_QUOTA");
        assertThat(data(invoke(fixture.service(), firstToken, "{}"), 429).get("reason").asText()).isEqualTo("DAILY_QUOTA");
        assertThat(data(invoke(fixture.service(), secondToken, "{}"), 200).get("tenantId").asText()).isEqualTo("202");
    }

    private JsonNode publishGovernanceRule(Map<String, Object> target, String mode, Map<String, Object> rate, long dailyQuota) throws Exception {
        JsonNode draft = admin("POST", "/admin-api/governance-rules", Map.of("name", "独立集成治理-" + UUID.randomUUID(),
                "config", Map.of("target", target, "enabled", true, "mode", mode, "rate", rate, "dailyQuota", dailyQuota,
                        "ipMode", "UNRESTRICTED", "ipAddresses", List.of())));
        assertThat(draft.get("liveReleaseId").isNull()).isTrue();
        JsonNode release = publishGovernanceDraft(draft.get("id").asText());
        assertThat(release.at("/rule/version").asLong()).isEqualTo(1);
        assertThat(release.at("/rule/target/type").asText()).isEqualTo(target.get("type"));
        return release;
    }

    @Order(Integer.MAX_VALUE)
    @ParameterizedTest
    @EnumSource(ApiProtocol.class)
    void unavailableSharedLimiterFailsClosedWithoutAffectingUnrestrictedRoutes(ApiProtocol protocol) throws Exception {
        Fixture fixture = fixture(protocol);
        String token = token(fixture.application(), "101", null);
        redis.destroy();
        assertThat(redis.waitFor(5, java.util.concurrent.TimeUnit.SECONDS)).isTrue();
        data(invoke(fixture.service(), token, "{}"), 200);
        publishQuotaAndIpRule("API", null, fixture.apiId(), 1, "UNRESTRICTED", List.of());
        assertThat(invoke(fixture.service(), token, "{}").statusCode()).isEqualTo(503);
        startRedis();
        HttpResponse<String> recovered = null;
        for (int attempt = 0; attempt < 20; attempt++) {
            recovered = invoke(fixture.service(), token, "{}");
            if (recovered.statusCode() != 503) break;
            Thread.sleep(100);
        }
        data(recovered, 200);
        assertThat(invoke(fixture.service(), token, "{}").statusCode()).isEqualTo(429);
    }

    private JsonNode awaitCall(String requestId) throws Exception {
        // Servlet finally写日志可能晚于HTTP body到达客户端，按公开查询有限等待。
        for (int attempt = 0; attempt < 20; attempt++) {
            JsonNode records = admin("GET", "/admin-api/observability/calls?requestId=" + requestId, null);
            if (records.get("total").asLong() == 1) return records;
            Thread.sleep(50);
        }
        throw new AssertionError("调用记录未通过公开查询可见");
    }

    @ParameterizedTest
    @EnumSource(ApiProtocol.class)
    void publishedLifecycleControlsBothProtocolsWithoutHidingAuthorizedMigrationDocuments(ApiProtocol protocol) throws Exception {
        Fixture fixture = fixture(protocol);
        String accessToken = token(fixture.application(), "101", null);
        String documentPath = "/api/docs/" + fixture.service() + "/v1/query";
        JsonNode initial = data(CLIENT.send(request("GET", documentPath + "/announcements", null)
                .header("Authorization", "Bearer " + accessToken).build(), HttpResponse.BodyHandlers.ofString()), 200);
        assertThat(initial.at("/lifecycle/status").asText()).isEqualTo("ACTIVE");
        Map<String, Object> body = definition(fixture.service(), fixture.scope(), protocol);
        body.put("expectedRevision", 1);
        Map<String, Object> lifecycle = new LinkedHashMap<>(Map.of("status", "DEPRECATED", "compatibility", "BREAKING",
                "compatibilityNotes", "v2返回字段调整，请先核对", "deprecationNotice", "请迁移至外部v2", "replacementVersion", "v2", "sunsetDate", "2020-01-01"));
        body.put("lifecycle", lifecycle);
        admin("PUT", "/admin-api/apis/" + fixture.apiId(), body);
        admin("POST", "/admin-api/publications/apis/" + fixture.apiId() + "/submissions",
                Map.of("expectedDraftRevision", 2, "expectedStateVersion", 1, "submissionKey", UUID.randomUUID().toString(), "comment", "废弃公告"));
        assertThat(data(invoke(fixture.service(), accessToken, "{}"), 200).get("amount").decimalValue()).isEqualByComparingTo("101.25");
        JsonNode deprecated = data(CLIENT.send(request("GET", documentPath, null).header("Authorization", "Bearer " + accessToken).build(),
                HttpResponse.BodyHandlers.ofString()), 200);
        assertThat(deprecated.at("/document/lifecycle/status").asText()).isEqualTo("DEPRECATED");
        assertThat(deprecated.toString()).doesNotContain(providerOrigin, "interfaceName", "parameterTypes");
        lifecycle.put("status", "RETIRED"); body.put("expectedRevision", 2);
        admin("PUT", "/admin-api/apis/" + fixture.apiId(), body);
        admin("POST", "/admin-api/publications/apis/" + fixture.apiId() + "/submissions",
                Map.of("expectedDraftRevision", 3, "expectedStateVersion", 2, "submissionKey", UUID.randomUUID().toString(), "comment", "正式退出"));
        var retired = invoke(fixture.service(), accessToken, "{}");
        assertThat(retired.statusCode()).isEqualTo(410);
        assertThat(JSON.readTree(retired.body()).get("code").asInt()).isEqualTo(41000001);
        JsonNode announcement = data(CLIENT.send(request("GET", documentPath + "/announcements", null)
                .header("Authorization", "Bearer " + accessToken).build(), HttpResponse.BodyHandlers.ofString()), 200);
        assertThat(announcement.at("/lifecycle/status").asText()).isEqualTo("RETIRED");
        assertThat(announcement.get("version").asText()).isEqualTo("v1");
        assertThat(announcement.at("/lifecycle/replacementVersion").asText()).isEqualTo("v2");
        var debug = request("POST", "/admin-api/apis/" + fixture.apiId() + "/debug", Map.of("expectedRevision", 3, "input", Map.of()))
                .header("Cookie", sessionCookie).header("X-CSRF-Token", csrf).header("Authorization", "Bearer " + accessToken);
        data(CLIENT.send(debug.build(), HttpResponse.BodyHandlers.ofString()), 410);
        admin("PUT", "/admin-api/applications/" + fixture.application().at("/application/id").asText() + "/scopes", Map.of("scopeCodes", List.of()));
        String unauthorized = token(fixture.application(), "101", null);
        assertThat(invoke(fixture.service(), unauthorized, "{}").statusCode()).isEqualTo(403);
        data(CLIENT.send(request("GET", documentPath + "/announcements", null).header("Authorization", "Bearer " + unauthorized).build(),
                HttpResponse.BodyHandlers.ofString()), 403);
    }

    @org.junit.jupiter.api.Test
    @Order(1)
    void debugAndPublishedHttpCallTwoOriginsWithoutDeploymentTargets() throws Exception {
        Fixture fixture = fixture(ApiProtocol.HTTP);
        String accessToken = token(fixture.application(), "101", null);
        assertThat(data(invoke(fixture.service(), accessToken, "{}"), 200).at("/tenantId").asText()).isEqualTo("101");
        com.sun.net.httpserver.HttpServer second = com.sun.net.httpserver.HttpServer.create(new java.net.InetSocketAddress("127.0.0.1", 0), 0);
        String secondOrigin = "http://127.0.0.1:" + second.getAddress().getPort();
        second.createContext("/query", exchange -> {
            try (exchange) {
                io.github.chenyilei2016.openplatform.provider.OpenPlatformIdentity identity = io.github.chenyilei2016.openplatform.testing.ProviderProofTestSupport.verifier()
                        .authenticate(name -> exchange.getRequestHeaders().getFirst(name),
                                io.github.chenyilei2016.openplatform.provider.OpenPlatformTarget.http(URI.create(secondOrigin + exchange.getRequestURI()), exchange.getRequestMethod()));
                byte[] body = JSON.writeValueAsBytes(Map.of("orderNo", "COMMON-001", "tenantId", identity.getTenantId(),
                        "amount", new java.math.BigDecimal("7.25"), "status", "SECOND"));
                exchange.getResponseHeaders().add("Content-Type", "application/json");
                exchange.sendResponseHeaders(200, body.length);
                exchange.getResponseBody().write(body);
            }
        });
        second.start();
        try {
            String service = fixture.service() + "_second";
            Map<String, Object> definition = definition(service, fixture.scope(), ApiProtocol.HTTP);
            definition.put("binding", Map.of("protocol", "HTTP", "timeoutMillis", 2000,
                    "http", Map.of("url", secondOrigin + "/query", "method", "POST")));
            JsonNode api = admin("POST", "/admin-api/apis", definition);
            HttpRequest.Builder debug = request("POST", "/admin-api/apis/" + api.get("id").asText() + "/debug",
                    Map.of("expectedRevision", 1, "input", Map.of()))
                    .header("Cookie", sessionCookie).header("X-CSRF-Token", csrf).header("Authorization", "Bearer " + accessToken);
            assertThat(data(CLIENT.send(debug.build(), HttpResponse.BodyHandlers.ofString()), 200).at("/publicResponse/value/data/status").asText()).isEqualTo("SECOND");
            admin("POST", "/admin-api/publications/apis/" + api.get("id").asText() + "/submissions",
                    Map.of("expectedDraftRevision", 1, "expectedStateVersion", 0, "submissionKey", UUID.randomUUID().toString(), "comment", "两个origin无需部署登记"));
            assertThat(data(invoke(service, accessToken, "{}"), 200).at("/amount").decimalValue()).isEqualByComparingTo("7.25");
        } finally { second.stop(0); }
    }

    /** 真实本机Nacos → 正式HTTP网关 → 独立订单MVC/Provider SDK，不能用SimpleDiscovery替身替代。 */
    @Test
    @Order(2)
    @EnabledIfSystemProperty(named = "task101.nacos.address", matches = "127\\.0\\.0\\.1:[0-9]+")
    void sharedFeignContractWorksByUrlAndRealNacosWithPublishedIdentityAndOfflineRecovery() throws Exception {
        Properties registry = new Properties();
        registry.setProperty("serverAddr", System.getProperty("task101.nacos.address"));
        NamingService naming = NacosFactory.createNamingService(registry);
        String serviceName = "task101-http-" + UUID.randomUUID();
        int providerPort = URI.create(providerOrigin).getPort();
        Fixture urlFixture = null;
        Fixture discoveredFixture = null;
        String urlToken = null;
        String discoveredToken = null;
        try {
            naming.registerInstance(serviceName, NACOS_GROUP, "127.0.0.1", providerPort);
            awaitInstances(serviceName, 1);
            int contexts = hostLoadBalancers.getContextNames().size();
            assertThat(admin("GET", "/admin-api/apis/http-target/instances?serviceName=" + serviceName, null).get("instanceCount").asInt()).isEqualTo(1);
            for (int index = 0; index < 3; index++)
                assertThat(admin("GET", "/admin-api/apis/http-target/instances?serviceName=absent-" + UUID.randomUUID(), null).get("instanceCount").asInt()).isZero();
            assertThat(hostLoadBalancers.getContextNames()).hasSize(contexts);
            for (ApiBinding.HttpTargetMode mode : ApiBinding.HttpTargetMode.values()) {
                Fixture fixture = fixture(ApiProtocol.HTTP);
                admin("POST", "/admin-api/tenant-grants/" + fixture.firstTenantGrant() + "/users", Map.of("employeeNo", "E101"));
                String accessToken = token(fixture.application(), "101", "E101");
                String appToken = token(fixture.application(), "101", null);
                Map<String, Object> draft = feignDefinition(fixture.service(), fixture.scope(), mode, serviceName);
                draft.put("expectedRevision", 1);
                assertThat(admin("POST", "/admin-api/apis/" + fixture.apiId() + "/validate", draft).get("valid").asBoolean()).isTrue();
                JsonNode saved = admin("PUT", "/admin-api/apis/" + fixture.apiId(), draft);
                assertThat(saved.at("/binding/http/targetMode").asText()).isEqualTo(mode.name());
                assertThat(saved.at("/binding/http/sourceMethod").asText()).isEqualTo("lookupByPath");
                JsonNode preflight = feignDebug(fixture, 2, accessToken, true);
                assertThat(preflight.get("outcome").asText()).isEqualTo("SUCCEEDED");
                assertThat(preflight.get("providerDispatch").asText()).isEqualTo("NOT_SENT");
                assertThat(feignDebug(fixture, 2, accessToken, false).at("/publicResponse/value/data/tenantId").asText()).isEqualTo("101");
                // 新目标仅在发布后生效，未发布时仍是既有无需人员的query入口。
                data(invoke(fixture.service(), appToken, "{}"), 200);
                publishApi(fixture.apiId(), 2, 1);
                // 平台草稿未要求人员，仍由Feign接口声明上的SDK保护注解拒绝APP身份。
                assertThat(invoke(fixture.service(), appToken, "{}").statusCode()).isEqualTo(403);
                String traceId = UUID.randomUUID().toString().replace("-", "");
                String traceParent = "00-" + traceId + "-0123456789abcdef-01";
                HttpResponse<String> response = CLIENT.send(request("POST", "/api/oauth/" + fixture.service() + "/v1/query", Map.of())
                        .header("Authorization", "Bearer " + accessToken).header("traceparent", traceParent)
                        .header("tracestate", "vendor=task101").build(), HttpResponse.BodyHandlers.ofString());
                assertThat(data(response, 200).get("amount").decimalValue()).isEqualByComparingTo("101.25");
                assertThat(response.headers().firstValue("X-Request-Id")).contains(traceId);
                org.awaitility.Awaitility.await().atMost(Duration.ofSeconds(5)).untilAsserted(() ->
                        assertThat(Files.readString(providerAccessLog)).contains(traceId + "|" + traceParent + "|vendor=task101|101|1011|200"));
                JsonNode recorded = awaitCall(traceId).at("/items/0");
                assertThat(recorded.get("tenantId").asText()).isEqualTo("101");
                assertThat(recorded.get("employeeNo").asText()).isEqualTo("E101");
                assertThat(invoke(fixture.service(), accessToken, "{\"tenantId\":\"202\"}").statusCode()).isEqualTo(400);
                assertThat(invoke(fixture.service(), accessToken, "{\"employeeId\":\"1012\"}").statusCode()).isEqualTo(400);
                assertThat(invoke(fixture.service(), accessToken, "{\"orderNo\":\"PRIVATE-002\"}").statusCode()).isEqualTo(403);
                HttpResponse<String> missingOrder = invoke(fixture.service(), accessToken, "{\"orderNo\":\"MISSING\"}");
                assertThat(missingOrder.statusCode()).isEqualTo(502);
                assertThat(JSON.readTree(missingOrder.body()).get("code").asInt()).isEqualTo(50200002);

                Map<String, Object> http = new LinkedHashMap<>(JSON.convertValue(saved.at("/binding/http"),
                        new tools.jackson.core.type.TypeReference<Map<String, Object>>() {}));
                http.put("sourceClass", ""); http.put("sourceMethod", "");
                draft.put("binding", Map.of("protocol", "HTTP", "timeoutMillis", 2000, "http", http));
                draft.put("expectedRevision", 2);
                JsonNode cleared = admin("PUT", "/admin-api/apis/" + fixture.apiId(), draft);
                assertThat(cleared.at("/binding/http/sourceClass").asText()).isEmpty();
                assertThat(cleared.at("/binding/http/sourceMethod").asText()).isEmpty();
                assertThat(feignDebug(fixture, 3, accessToken, false).at("/publicResponse/value/data/amount").decimalValue()).isEqualByComparingTo("101.25");
                publishApi(fixture.apiId(), 3, 2);
                data(invoke(fixture.service(), accessToken, "{}"), 200);

                // 仅改草稿目标不改当前发布快照；恢复原始来源、目标和映射后复制仍能调用。
                http.put(mode == ApiBinding.HttpTargetMode.URL ? "url" : "serviceName",
                        mode == ApiBinding.HttpTargetMode.URL ? "http://127.0.0.1:1/internal/orders/{orderNo}/lookup" : "unpublished-" + UUID.randomUUID());
                draft.put("expectedRevision", 3);
                admin("PUT", "/admin-api/apis/" + fixture.apiId(), draft);
                data(invoke(fixture.service(), accessToken, "{}"), 200);
                JsonNode historical = admin("GET", "/admin-api/apis/" + fixture.apiId() + "/revisions/2", null);
                JsonNode restored = admin("POST", "/admin-api/apis/" + fixture.apiId() + "/revisions/2/restore", Map.of("expectedRevision", 4));
                assertThat(restored.get("binding")).isEqualTo(historical.at("/snapshot/binding"));
                assertThat(restored.get("mappings")).isEqualTo(historical.at("/snapshot/mappings"));
                assertThat(restored.get("draftRevision").asLong()).isEqualTo(5);
                JsonNode preview = admin("POST", "/admin-api/api-copies/preview",
                        Map.of("sourceApiId", fixture.apiId(), "sourceKind", "DRAFT", "expectedSourceRevision", 5));
                Map<String, Object> copiedDraft = JSON.convertValue(preview.get("snapshot"), new tools.jackson.core.type.TypeReference<Map<String, Object>>() {});
                copiedDraft.remove("id"); copiedDraft.remove("protocol"); copiedDraft.remove("draftRevision");
                String copiedService = fixture.service() + "_copy";
                copiedDraft.put("service", copiedService);
                JsonNode copied = admin("POST", "/admin-api/api-copies", Map.of("creationKey", UUID.randomUUID().toString(),
                        "sourceApiId", fixture.apiId(), "sourceKind", "DRAFT", "sourceRevision", 5, "definition", copiedDraft));
                assertThat(copied.get("binding")).isEqualTo(restored.get("binding"));
                publishApi(copied.get("id").asText(), 1, 0);
                data(invoke(copiedService, accessToken, "{}"), 200);
                if (mode == ApiBinding.HttpTargetMode.URL) { urlFixture = fixture; urlToken = accessToken; }
                else { discoveredFixture = fixture; discoveredToken = accessToken; }
            }

            assertThat(urlFixture).isNotNull(); assertThat(discoveredFixture).isNotNull();
            String absentService = discoveredFixture.service() + "_absent";
            JsonNode absent = admin("POST", "/admin-api/apis", feignDefinition(absentService, discoveredFixture.scope(),
                    ApiBinding.HttpTargetMode.SERVICE_NAME, "missing-" + UUID.randomUUID()));
            publishApi(absent.get("id").asText(), 1, 0);
            assertUnavailable(invoke(absentService, discoveredToken, "{}"));
            assertPublishedServiceTimeout(discoveredFixture, discoveredToken, naming);
            naming.deregisterInstance(serviceName, NACOS_GROUP, "127.0.0.1", providerPort);
            awaitInstances(serviceName, 0);
            assertUnavailable(invoke(discoveredFixture.service(), discoveredToken, "{}"));
            data(invoke(urlFixture.service(), urlToken, "{}"), 200);
            assertThat(provider.isAlive()).isTrue();
            naming.registerInstance(serviceName, NACOS_GROUP, "127.0.0.1", providerPort);
            awaitInstances(serviceName, 1);
            data(invoke(discoveredFixture.service(), discoveredToken, "{}"), 200);
        } finally {
            try { naming.deregisterInstance(serviceName, NACOS_GROUP, "127.0.0.1", providerPort); }
            finally { naming.shutDown(); }
        }
    }

    private Map<String, Object> feignDefinition(String service, String scope, ApiBinding.HttpTargetMode mode, String serviceName) {
        Map<String, Object> draft = definition(service, scope, ApiProtocol.HTTP);
        Map<String, Object> http = new LinkedHashMap<>(Map.of("method", "POST", "targetMode", mode.name(),
                "sourceClass", "io.github.chenyilei2016.example.order.OrderFeignContract", "sourceMethod", "lookupByPath"));
        if (mode == ApiBinding.HttpTargetMode.URL) http.put("url", providerOrigin + "/internal/orders/{orderNo}/lookup");
        else { http.put("serviceName", serviceName); http.put("path", "/internal/orders/{orderNo}/lookup"); }
        draft.put("binding", Map.of("protocol", "HTTP", "timeoutMillis", 2000, "http", http));
        draft.put("mappings", List.of(
                Map.of("target", "orderNo", "source", "REQUEST", "path", "orderNo", "location", "PATH"),
                Map.of("target", "tenantId", "source", "CONTEXT", "path", "tenantId", "location", "QUERY"),
                Map.of("target", "orderNo", "source", "REQUEST", "path", "orderNo", "location", "BODY"),
                Map.of("target", "tenantId", "source", "CONTEXT", "path", "tenantId", "location", "BODY")));
        draft.put("responseAdapter", Map.of("mode", "ENVELOPE", "successPath", "code", "successValues", List.of(0), "dataPath", "data"));
        return draft;
    }

    /** 独立慢HTTP夹具只验公开超时语义；真实共享Feign MVC契约由主流程验收。 */
    private void assertPublishedServiceTimeout(Fixture fixture, String accessToken, NamingService naming) throws Exception {
        com.sun.net.httpserver.HttpServer slow = com.sun.net.httpserver.HttpServer.create(new java.net.InetSocketAddress("127.0.0.1", 0), 0);
        int slowPort = slow.getAddress().getPort();
        String slowName = "task101-slow-" + UUID.randomUUID();
        slow.createContext("/internal/orders/", exchange -> {
            try (exchange) {
                io.github.chenyilei2016.openplatform.testing.ProviderProofTestSupport.verifier().authenticate(name -> exchange.getRequestHeaders().getFirst(name),
                        io.github.chenyilei2016.openplatform.provider.OpenPlatformTarget.http(URI.create("http://127.0.0.1:" + slowPort + exchange.getRequestURI()), exchange.getRequestMethod()));
                try { Thread.sleep(600); }
                catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); }
                exchange.sendResponseHeaders(200, -1);
            } catch (java.io.IOException closedAfterTimeout) { /* 网关超时后关闭连接，夹具按生命周期退出。 */ }
        });
        slow.start();
        try {
            naming.registerInstance(slowName, NACOS_GROUP, "127.0.0.1", slowPort);
            awaitInstances(slowName, 1);
            String service = fixture.service() + "_slow";
            Map<String, Object> draft = feignDefinition(service, fixture.scope(), ApiBinding.HttpTargetMode.SERVICE_NAME, slowName);
            draft.put("binding", Map.of("protocol", "HTTP", "timeoutMillis", 100, "http", ((Map<?, ?>) draft.get("binding")).get("http")));
            JsonNode api = admin("POST", "/admin-api/apis", draft);
            publishApi(api.get("id").asText(), 1, 0);
            HttpResponse<String> timedOut = invoke(service, accessToken, "{}");
            assertThat(timedOut.statusCode()).isEqualTo(504);
            assertThat(JSON.readTree(timedOut.body()).get("code").asInt()).isEqualTo(50400001);
        } finally {
            try { naming.deregisterInstance(slowName, NACOS_GROUP, "127.0.0.1", slowPort); }
            finally { slow.stop(0); }
        }
    }

    private JsonNode feignDebug(Fixture fixture, long revision, String token, boolean preflight) throws Exception {
        return data(CLIENT.send(request("POST", "/admin-api/apis/" + fixture.apiId() + "/debug" + (preflight ? "/preflight" : ""),
                Map.of("expectedRevision", revision, "input", Map.of())).header("Cookie", sessionCookie)
                .header("X-CSRF-Token", csrf).header("Authorization", "Bearer " + token).build(), HttpResponse.BodyHandlers.ofString()), 200);
    }

    private void publishApi(String apiId, long revision, long stateVersion) throws Exception {
        admin("POST", "/admin-api/publications/apis/" + apiId + "/submissions", Map.of("expectedDraftRevision", revision,
                "expectedStateVersion", stateVersion, "submissionKey", UUID.randomUUID().toString(), "comment", "真实Feign/Nacos验收"));
    }

    private void awaitInstances(String serviceName, int expected) {
        org.awaitility.Awaitility.await().pollInterval(Duration.ofMillis(200)).atMost(Duration.ofSeconds(20)).untilAsserted(() -> {
            JsonNode instances = admin("GET", "/admin-api/apis/http-target/instances?serviceName=" + serviceName, null);
            assertThat(instances.get("serviceName").asText()).isEqualTo(serviceName);
            assertThat(instances.get("instanceCount").asInt()).isEqualTo(expected);
            assertThat(instances.get("checkedAt").asText()).isNotBlank();
        });
    }

    private void assertUnavailable(HttpResponse<String> response) {
        assertThat(response.statusCode()).isEqualTo(503);
        assertThat(JSON.readTree(response.body()).get("code").asInt()).isEqualTo(50300001);
    }

    private Fixture fixture(ApiProtocol protocol) throws Exception {
        String suffix = UUID.randomUUID().toString().replace("-", "").substring(0, 12);
        String scope = "orders_" + suffix;
        admin("POST", "/admin-api/scopes", Map.of("code", scope, "name", "订单权限", "enabled", true, "defaultForNewApplication", true));
        JsonNode app = admin("POST", "/admin-api/applications", Map.of("name", "订单集成", "ownerTenantId", "101"));
        String firstGrant = null;
        for (String tenant : List.of("101", "202")) {
            JsonNode grant = admin("POST", "/admin-api/tenant-grants", Map.of("appKey", app.at("/application/appKey").asText(), "appSecret", app.get("appSecret").asText(), "tenantId", tenant));
            if (tenant.equals("101")) firstGrant = grant.get("id").asText();
        }
        String service = "orders_" + suffix;
        JsonNode api;
        if (protocol == ApiProtocol.DUBBO) {
            // 历史无连接字段草稿作为升级前数据装载；后续编辑、发布和真实调用继续经过HTTP入口。
            Map<String, Object> legacy = definition(service, scope, protocol);
            legacy.put("id", UUID.randomUUID().toString());
            legacy.put("protocol", "DUBBO");
            legacy.put("draftRevision", 1);
            catalog.create(JSON.convertValue(legacy, io.github.chenyilei2016.openplatform.domain.catalog.ApiDefinition.class));
            api = admin("GET", "/admin-api/apis/" + legacy.get("id"), null);
        } else {
            api = admin("POST", "/admin-api/apis", definition(service, scope, protocol));
        }
        admin("POST", "/admin-api/publications/apis/" + api.get("id").asText() + "/submissions",
                Map.of("expectedDraftRevision", 1, "expectedStateVersion", 0, "submissionKey", UUID.randomUUID().toString(), "comment", "真实" + protocol + "集成"));
        return new Fixture(service, api.get("id").asText(), scope, app, firstGrant);
    }

    private Map<String, Object> definition(String service, String scope, ApiProtocol protocol) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("service", service); body.put("version", "v1"); body.put("method", "query");
        body.put("name", "订单查询"); body.put("category", "订单"); body.put("owner", "集成测试"); body.put("scopeCodes", List.of(scope));
        body.put("requestSchema", Map.of("type", "OBJECT", "properties", Map.of("orderNo", Map.of("type", "STRING", "required", true, "defaultValue", "COMMON-001"))));
        body.put("responseSchema", Map.of("type", "OBJECT", "properties", Map.of("orderNo", Map.of("type", "STRING", "required", true),
                "tenantId", Map.of("type", "STRING", "required", true), "amount", Map.of("type", "NUMBER", "required", true), "status", Map.of("type", "STRING", "required", true))));
        body.put("binding", protocol == ApiProtocol.HTTP
                ? Map.of("protocol", "HTTP", "timeoutMillis", 2000,
                        "http", Map.of("url", providerOrigin + "/internal/orders/query", "method", "POST"))
                : Map.of("protocol", "DUBBO", "timeoutMillis", 2000,
                        "dubbo", Map.of("interfaceName", DUBBO_INTERFACE, "method", "query", "version", "1.0.0",
                                "group", "order-example", "parameterTypes", List.of(DUBBO_REQUEST_TYPE), "connectionId", "it-connection", "connectionRevision", 1)));
        body.put("errorDefinitions", List.of());
        String prefix = protocol == ApiProtocol.DUBBO ? "arg0." : "";
        body.put("mappings", List.of(Map.of("target", prefix + "orderNo", "source", "REQUEST", "path", "orderNo"),
                Map.of("target", prefix + "tenantId", "source", "CONTEXT", "path", "tenantId")));
        return body;
    }

    private String token(JsonNode app, String tenant, String employee) throws Exception {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("appKey", app.at("/application/appKey").asText()); body.put("appSecret", app.get("appSecret").asText()); body.put("tenantId", tenant);
        if (employee != null) body.put("employeeNo", employee);
        return data(CLIENT.send(request("POST", "/api/token", body).build(), HttpResponse.BodyHandlers.ofString()), 200).get("accessToken").asText();
    }
    private JsonNode admin(String method, String path, Object body) throws Exception {
        return data(CLIENT.send(request(method, path, body).header("Cookie", sessionCookie).header("X-CSRF-Token", csrf).build(), HttpResponse.BodyHandlers.ofString()), 200);
    }
    private HttpRequest.Builder request(String method, String path, Object body) {
        return HttpRequest.newBuilder(URI.create(origin() + path)).timeout(Duration.ofSeconds(10)).header("Content-Type", "application/json")
                .method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(JSON.writeValueAsString(body)));
    }
    private HttpResponse<String> invoke(String service, String token, String body) throws Exception {
        return CLIENT.send(HttpRequest.newBuilder(URI.create(origin() + "/api/oauth/" + service + "/v1/query"))
                .timeout(Duration.ofSeconds(10)).header("Content-Type", "application/json").header("Authorization", "Bearer " + token)
                .POST(HttpRequest.BodyPublishers.ofString(body)).build(), HttpResponse.BodyHandlers.ofString());
    }
    private JsonNode data(HttpResponse<String> response, int expected) {
        JsonNode envelope = JSON.readTree(response.body());
        assertThat(response.statusCode()).as("HTTP %s %s (%s)", response.request().method(), response.request().uri().getPath(),
                envelope.path("resultMsg").asText()).isEqualTo(expected);
        return envelope.get("data");
    }
    private String origin() { return "http://127.0.0.1:" + port; }

    @ParameterizedTest
    @EnumSource(ApiProtocol.class)
    void responseAdaptationUsesFixedDraftAndPublicationWithRealProvider(ApiProtocol protocol) throws Exception {
        Fixture fixture = fixture(protocol);
        String token = token(fixture.application(), "101", null);
        Map<String, Object> draft = definition(fixture.service(), fixture.scope(), protocol);
        draft.put("expectedRevision", 1);
        draft.put("responseAdapter", Map.of("mode", "ENVELOPE", "successPath", "status", "successValues", List.of("PAID"), "dataPath", "amount"));
        draft.put("responseSchema", Map.of("type", "NUMBER"));
        admin("PUT", "/admin-api/apis/" + fixture.apiId(), draft);
        HttpRequest.Builder debug = request("POST", "/admin-api/apis/" + fixture.apiId() + "/debug", Map.of("expectedRevision", 2, "input", Map.of()))
                .header("Cookie", sessionCookie).header("X-CSRF-Token", csrf).header("Authorization", "Bearer " + token);
        assertThat(data(CLIENT.send(debug.build(), HttpResponse.BodyHandlers.ofString()), 200).at("/publicResponse/value/data").decimalValue()).isEqualByComparingTo("101.25");
        assertThat(data(invoke(fixture.service(), token, "{}"), 200).get("orderNo").asText()).isEqualTo("COMMON-001");
        admin("POST", "/admin-api/publications/apis/" + fixture.apiId() + "/submissions", Map.of("expectedDraftRevision", 2,
                "expectedStateVersion", 1, "submissionKey", UUID.randomUUID().toString(), "comment", "返回适配真实回归"));
        assertThat(data(invoke(fixture.service(), token, "{}"), 200).decimalValue()).isEqualByComparingTo("101.25");
        HttpResponse<String> rejected = invoke(fixture.service(), token, "{\"orderNo\":\"PRIVATE-002\"}");
        assertThat(rejected.statusCode()).isEqualTo(502);
        JsonNode publicFailure = JSON.readTree(rejected.body());
        assertThat(publicFailure.get("code").asInt()).isEqualTo(50200002);
        assertThat(publicFailure.get("data").isNull()).isTrue();
        assertThat(publicFailure.toString()).doesNotContain("$.status", "CREATED", "PRIVATE-002");
    }

    private record Fixture(String service, String apiId, String scope, JsonNode application, String firstTenantGrant) {}
}
