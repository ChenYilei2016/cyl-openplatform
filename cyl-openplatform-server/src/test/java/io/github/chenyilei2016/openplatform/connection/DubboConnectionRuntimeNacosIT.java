package io.github.chenyilei2016.openplatform.connection;

import io.github.chenyilei2016.openplatform.domain.catalog.ApiBinding;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiProtocol;
import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.github.chenyilei2016.openplatform.domain.runtime.InvocationContext;
import io.github.chenyilei2016.openplatform.domain.connection.DubboConnectionRepository;
import io.github.chenyilei2016.openplatform.domain.connection.DubboConnectionUsageRepository;
import io.github.chenyilei2016.openplatform.domain.environmentrelease.ReleaseEnvironment;
import io.github.chenyilei2016.openplatform.infrastructure.properties.connection.DubboConnectionProperties;
import io.github.chenyilei2016.openplatform.infrastructure.connection.runtime.ManagedDubboConnectionRuntime;
import io.github.chenyilei2016.openplatform.infrastructure.connection.runtime.DubboConnectionRuntimeConfiguration;
import io.github.chenyilei2016.openplatform.infrastructure.properties.gateway.GatewayDubboProperties;
import io.github.chenyilei2016.openplatform.infrastructure.runtime.GenericDubboApiInvoker;

import io.github.chenyilei2016.openplatform.application.identity.AccountAuthentication;
import io.github.chenyilei2016.openplatform.testing.TestAccount;
import jakarta.servlet.http.Cookie;
import java.nio.charset.StandardCharsets;
import java.net.ServerSocket;
import java.net.InetAddress;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.TimeUnit;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.apache.dubbo.config.ApplicationConfig;
import org.apache.dubbo.config.ProtocolConfig;
import org.apache.dubbo.config.RegistryConfig;
import org.apache.dubbo.config.ServiceConfig;
import org.apache.dubbo.config.bootstrap.DubboBootstrap;
import org.apache.dubbo.rpc.model.ApplicationModel;
import org.apache.dubbo.rpc.model.FrameworkModel;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfSystemProperty;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.webmvc.test.autoconfigure.MockMvcPrint;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.util.DigestUtils;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.when;
import static org.awaitility.Awaitility.await;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** 仅使用显式本机测试Nacos和真实TCP提供方，不读取公司注册中心或替换运行时组件。 */
@io.github.chenyilei2016.openplatform.testing.TestAdministrators
@SpringBootTest(properties = {

        "open-platform.environment-release.environment-id=runtime-test",
        "open-platform.dubbo-connections.credentials.redis-password-only.password=local-redis-regression",
        "test.admin.operators[0].tenant-id=runtime-tenant",
        "test.admin.operators[0].employee-no=runtime-manager",
        "test.admin.operators[0].permissions[0]=MANAGE_CONNECTIONS",
        "test.admin.operators[0].permissions[1]=MANAGE_APIS",

        "logging.level.org.apache.dubbo=INFO"
})
@AutoConfigureMockMvc(print = MockMvcPrint.NONE)
@EnabledIfSystemProperty(named = "task32.nacos.address", matches = "nacos://127\\.0\\.0\\.1:[0-9]+")
class DubboConnectionRuntimeNacosIT {
    private static final String PATH = "/admin-api/dubbo-connections";
    private static final InvocationContext CALLER = new InvocationContext("test-application", "test-ak", "runtime-tenant",
            null, null, null, List.of());
    @Autowired MockMvc mvc;
    @Autowired GenericDubboApiInvoker invoker;
    @Autowired io.github.chenyilei2016.openplatform.domain.connection.DubboConnectionRuntime runtime;
    @Autowired DubboConnectionRepository repository;
    @Autowired DubboConnectionUsageRepository usages;
    @Autowired io.github.chenyilei2016.openplatform.domain.access.EmployeeProfileRepository profiles;
    @Autowired DubboConnectionProperties connectionProperties;
    @Autowired GatewayDubboProperties gatewayProperties;
    @Autowired ReleaseEnvironment environment;
    @MockitoBean AccountAuthentication login;
    private final JsonMapper json = JsonMapper.builder().build();

    @BeforeEach
    void login() {
        TestAccount user = new TestAccount();
        user.setId(101L); user.setTenantId("runtime-tenant"); user.setEmployeeNoStr("runtime-manager");
        when(login.current("runtime-session")).thenAnswer(invocation -> user.toAccount());
    }

    @Test
    @EnabledIfSystemProperty(named = "task64.redis.password.port", matches = "[0-9]+")
    void passwordOnlyRedisMetadataWorksThroughSavedConnectionAndRealRpc() throws Exception {
        int port = Integer.parseInt(System.getProperty("task64.redis.password.port"));
        io.lettuce.core.RedisClient redis = io.lettuce.core.RedisClient.create(io.lettuce.core.RedisURI.Builder.redis("127.0.0.1", port)
                .withDatabase(10).withPassword("local-redis-regression".toCharArray()).build());
        String group = "task64-password-" + UUID.randomUUID();
        String id = null;
        try (Provider provider = provider(group, "", "password-only");
             io.lettuce.core.api.StatefulRedisConnection<String, String> metadata = redis.connect()) {
            org.apache.dubbo.metadata.report.identifier.MetadataIdentifier identifier = new org.apache.dubbo.metadata.report.identifier.MetadataIdentifier(
                    ProbeService.class.getName(), null, null, "provider", "task32-provider-password-only");
            String key = identifier.getUniqueKey(org.apache.dubbo.metadata.report.identifier.KeyTypeEnum.UNIQUE_KEY);
            ObjectNode definition = json.createObjectNode().put("canonicalName", ProbeService.class.getCanonicalName());
            definition.putArray("methods").addObject().put("name", "identify").put("returnType", "java.lang.String").putArray("parameterTypes");
            metadata.sync().setex(key, 300, definition.toString());
            ObjectNode request = connection(group);
            ((ObjectNode) request.get("config")).putObject("metadata").put("type", "REDIS")
                    .put("address", "redis://127.0.0.1:" + port).put("group", "dubbo").put("database", 10).put("credentialRef", "redis-password-only");
            id = send(post(PATH).content(request.toString())).at("/connection/id").asText();
            JsonNode checked = send(post(PATH + "/" + id + "/diagnostics").content(diagnosticRequest()));
            assertThat(checked.at("/checks/1/status").asText()).isEqualTo("PASSED");
            assertThat(checked.at("/checks/5/status").asText()).isEqualTo("NOT_CHECKED");
            assertThat(provider.calls().get()).isZero();
            activate(id, 1, 1);
            awaitValue(invoker, id, 1, "", "password-only");
        } finally {
            try { disable(id); } finally { redis.shutdown(); }
        }
    }

    @Test
    void registryAuthenticationRejectionAndNetworkFailureHaveDifferentDiagnostics() throws Exception {
        com.sun.net.httpserver.HttpServer center = com.sun.net.httpserver.HttpServer.create(new java.net.InetSocketAddress("127.0.0.1", 0), 0);
        center.createContext("/nacos/v1/ns/catalog/services", exchange -> {
            exchange.sendResponseHeaders(403, -1);
            exchange.close();
        });
        center.start();
        String id = null;
        try {
            ObjectNode request = connection("authentication-regression");
            ((ObjectNode) request.at("/config/registry")).put("address", "nacos://127.0.0.1:" + center.getAddress().getPort());
            id = send(post(PATH).content(request.toString())).at("/connection/id").asText();
            JsonNode rejected = send(post(PATH + "/" + id + "/diagnostics").content("{\"revision\":1}"));
            assertThat(rejected.at("/checks/1/status").asText()).isEqualTo("FAILED");
            assertThat(rejected.at("/checks/1/summary").asText()).contains("账号", "权限");
            center.stop(0);
            JsonNode offline = send(post(PATH + "/" + id + "/diagnostics").content("{\"revision\":1}"));
            assertThat(offline.at("/checks/1/status").asText()).isEqualTo("UNAVAILABLE");
            assertThat(offline.at("/checks/1/summary").asText()).contains("网络").doesNotContain("拒绝目录访问");
        } finally { center.stop(0); disable(id); }
    }

    @Test
    void savedDraftDiagnosticsReadRealRegistryWithoutMakingDraftCallable() throws Exception {
        String group = "task32-" + UUID.randomUUID().toString().substring(0, 8);
        try (Provider provider = provider(group, "", "draft-provider")) {
            JsonNode created = send(post(PATH).content(connection(group).toString()));
            String id = created.at("/connection/id").asText();
            mvc.perform(auth(post(PATH + "/" + id + "/diagnostics").content("{\"revision\":999}")))
                    .andExpect(status().isNotFound());
            mvc.perform(auth(get(PATH + "/" + id + "/methods").param("revision", "1")
                    .param("interfaceName", "example.UnlistedService"))).andExpect(status().isForbidden());
            JsonNode diagnostic = send(post(PATH + "/" + id + "/diagnostics").content(diagnosticRequest()));
            assertThat(diagnostic.at("/checks/0/status").asText()).isEqualTo("PASSED");
            assertThat(diagnostic.at("/checks/1/status").asText()).isEqualTo("PASSED");
            assertThat(diagnostic.at("/checks/2/status").asText()).isEqualTo("NOT_CHECKED");
            assertThat(provider.calls().get()).isZero();
            assertThat(send(get(PATH + "/" + id)).at("/connection/activeRevision").isNull()).isTrue();
            assertThatThrownBy(() -> invoke(invoker, id, 1, "")).isInstanceOfSatisfying(PlatformException.class,
                    failure -> assertThat(failure.getErrorCode()).isEqualTo(ErrorCode.CONFLICT));
        }
    }

    @Test
    void identicalServicesStayInTheirConnectionAndEmptyVersionIsNotAWildcard() throws Exception {
        String firstGroup = "task32-a-" + UUID.randomUUID().toString().substring(0, 8);
        String secondGroup = "task32-b-" + UUID.randomUUID().toString().substring(0, 8);
        String firstId = null;
        String secondId = null;
        try (Provider first = provider(firstGroup, "", "first-unversioned");
             Provider versioned = provider(firstGroup, "v1", "first-versioned");
             Provider second = provider(secondGroup, "", "second-unversioned")) {
            ObjectNode firstRequest = connection(firstGroup);
            firstId = send(post(PATH).content(firstRequest.toString())).at("/connection/id").asText();
            secondId = send(post(PATH).content(connection(secondGroup).toString())).at("/connection/id").asText();
            activate(firstId, 1, 1);
            activate(secondId, 1, 1);
            awaitValue(invoker, firstId, 1, "", "first-unversioned");
            awaitValue(invoker, firstId, 1, "v1", "first-versioned");
            awaitValue(invoker, secondId, 1, "", "second-unversioned");
            String selectedFirst = firstId;
            String selectedSecond = secondId;
            assertThatThrownBy(() -> invoke(invoker, selectedSecond, 1, "v1"))
                    .isInstanceOfSatisfying(PlatformException.class, failure -> assertThat(failure.getErrorCode()).isEqualTo(ErrorCode.DOWNSTREAM_FAILED));
            send(put(PATH + "/" + firstId + "/status").content("{\"expectedStateVersion\":2,\"enabled\":false}"));
            assertThatThrownBy(() -> invoke(invoker, selectedFirst, 1, ""))
                    .isInstanceOfSatisfying(PlatformException.class, failure -> assertThat(failure.getErrorCode()).isEqualTo(ErrorCode.DOWNSTREAM_FAILED));
            assertThat(invoke(invoker, secondId, 1, "")).isEqualTo("second-unversioned");
        } finally {
            disable(firstId);
            disable(secondId);
        }
    }

    @Test
    void anUnpublishedDraftLoadsItsFixedRevisionAfterRuntimeRestartAndActivationChanges() throws Exception {
        String oldGroup = "task32-old-" + UUID.randomUUID().toString().substring(0, 8);
        String nextGroup = "task32-next-" + UUID.randomUUID().toString().substring(0, 8);
        String id = null;
        try (Provider oldProvider = provider(oldGroup, "", "old-revision");
             Provider newProvider = provider(nextGroup, "", "new-revision")) {
            id = send(post(PATH).content(connection(oldGroup).toString())).at("/connection/id").asText();
            activate(id, 1, 1);
            JsonNode draft = send(post("/admin-api/apis").content(apiDraft(id).toString()));
            ObjectNode next = connection(nextGroup).put("expectedStateVersion", 2);
            send(put(PATH + "/" + id + "/draft").content(next.toString()));
            activate(id, 2, 3);
            assertThat(send(get("/admin-api/apis/" + draft.get("id").asText())).at("/binding/dubbo/connectionRevision").asLong()).isEqualTo(1);
            DubboConnectionRuntimeConfiguration configuration = new DubboConnectionRuntimeConfiguration();
            ThreadPoolTaskExecutor loader = configuration.dubboConnectionLoader();
            ThreadPoolTaskExecutor metadata = configuration.dubboMetadataExecutor();
            ThreadPoolTaskExecutor diagnostics = configuration.dubboConnectionDiagnostics();
            ThreadPoolTaskScheduler scheduler = configuration.dubboConnectionScheduler();
            loader.initialize(); metadata.initialize(); diagnostics.initialize(); scheduler.initialize();
            ManagedDubboConnectionRuntime restarted = new ManagedDubboConnectionRuntime(repository, usages, connectionProperties,
                    gatewayProperties, environment, json, loader, metadata, diagnostics, scheduler);
            GenericDubboApiInvoker restartedInvoker = new GenericDubboApiInvoker(gatewayProperties, json, restarted, io.github.chenyilei2016.openplatform.testing.ProviderProofTestSupport.gateway());
            try {
                // 不显式warmup旧修订：从实际草稿引用按需恢复，固定目标不能漂移。
                restarted.afterSingletonsInstantiated();
                awaitValue(restartedInvoker, id, 1, "", "old-revision");
                awaitValue(restartedInvoker, id, 2, "", "new-revision");
                restarted.destroy();
                String selected = id;
                assertThatThrownBy(() -> invoke(restartedInvoker, selected, 1, ""))
                        .isInstanceOfSatisfying(PlatformException.class, failure -> assertThat(failure.getErrorCode()).isEqualTo(ErrorCode.DEPENDENCY_UNAVAILABLE));
            } finally {
                restartedInvoker.destroy();
                restarted.destroy();
                scheduler.destroy(); loader.destroy(); diagnostics.destroy(); metadata.destroy();
            }
        } finally {
            disable(id);
        }
    }

    @Test
    void applicationDiscoveryUsesNativeLocalProviderMetadata() throws Exception {
        verifyApplicationDiscovery("LOCAL", false);
    }

    @Test
    void applicationDiscoveryUsesNativeRemoteProviderMetadata() throws Exception {
        verifyApplicationDiscovery("REMOTE", false);
    }

    @Test
    void rollingApplicationVersionsRemainCallableThroughSavedConnection() throws Exception {
        verifyApplicationDiscovery("LOCAL", true);
    }

    private void verifyApplicationDiscovery(String metadataMode, boolean rolling) throws Exception {
        String namespace = UUID.randomUUID().toString();
        String app = "task32-" + metadataMode.toLowerCase(java.util.Locale.ROOT) + "-" + namespace.substring(0, 8);
        URI console = URI.create(System.getProperty("task32.nacos.address").replace("nacos://", "http://") + "/nacos/v1/console/namespaces");
        try (HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build()) {
            HttpResponse<String> created = client.send(HttpRequest.newBuilder(console).timeout(Duration.ofSeconds(5))
                    .header("Content-Type", "application/x-www-form-urlencoded")
                    .POST(HttpRequest.BodyPublishers.ofString("customNamespaceId=" + namespace + "&namespaceName=" + app + "&namespaceDesc=isolated-runtime-test"))
                    .build(), HttpResponse.BodyHandlers.ofString());
            assertThat(created.statusCode()).isEqualTo(200);
            assertThat(created.body()).isEqualTo("true");
        }
        Path directory = Files.createTempDirectory("task32-application-provider-");
        Path ready = directory.resolve("ready");
        Process provider = applicationProvider(directory, namespace, app, metadataMode, "", ready);
        Path nextReady = directory.resolve("next-ready");
        Process nextProvider = null;
        String id = null;
        try {
            if (rolling) nextProvider = applicationProvider(directory, namespace, app, metadataMode, "v2", nextReady);
            await().atMost(Duration.ofSeconds(40)).untilAsserted(() -> {
                assertThat(provider.isAlive()).as("provider log: %s", directory.resolve("provider.log")).isTrue();
                assertThat(ready).exists();
                if (rolling) assertThat(nextReady).exists();
            });
            ObjectNode request = connection(app);
            ObjectNode config = (ObjectNode) request.get("config");
            ((ObjectNode) config.get("registry")).put("namespace", namespace);
            config.put("discoveryMode", "APPLICATION").put("providerMetadataMode", metadataMode);
            config.putObject("metadata").put("type", "NACOS").put("address", System.getProperty("task32.nacos.address"))
                    .put("namespace", namespace).put("group", app);
            id = send(post(PATH).content(request.toString())).at("/connection/id").asText();
            activate(id, 1, 1);
            try {
                awaitValue(invoker, id, 1, "", app);
                if (rolling) awaitValue(invoker, id, 1, "v2", app);
            } catch (org.awaitility.core.ConditionTimeoutException failure) {
                JsonNode observed = send(post(PATH + "/" + id + "/diagnostics").content(diagnosticRequest()));
                throw new AssertionError("Application discovery failed; provider log=" + directory.resolve("provider.log") + "; diagnostics=" + observed, failure);
            }
            JsonNode diagnostic = send(post(PATH + "/" + id + "/diagnostics").content(diagnosticRequest()));
            assertThat(diagnostic.at("/checks/1/status").asText()).isEqualTo("PASSED");
            assertThat(diagnostic.at("/checks/2/status").asText()).isEqualTo("NOT_CHECKED");
            assertThat(diagnostic.at("/checks/4/status").asText()).isEqualTo("NOT_CHECKED");
            if (rolling) {
                stopProvider(nextProvider); nextProvider = null;
                awaitValue(invoker, id, 1, "", app);
            }
            if (metadataMode.equals("LOCAL")) {
                String draftId = send(post(PATH).content(request.toString())).at("/connection/id").asText();
                JsonNode draftDiagnostic = send(post(PATH + "/" + draftId + "/diagnostics").content(diagnosticRequest()));
                assertThat(draftDiagnostic.at("/checks/4/status").asText()).isEqualTo("NOT_CHECKED");
                assertThat(send(get(PATH + "/" + draftId)).at("/connection/activeRevision").isNull()).isTrue();
                assertThatThrownBy(() -> invoke(invoker, draftId, 1, ""))
                        .isInstanceOfSatisfying(PlatformException.class, failure -> assertThat(failure.getErrorCode()).isEqualTo(ErrorCode.CONFLICT));
            }
        } finally {
            try {
                disable(id);
            } finally {
                try { stopProvider(nextProvider); }
                finally { stopProvider(provider); }
            }
        }
    }

    private void stopProvider(Process provider) throws InterruptedException {
        if (provider == null) return;
        try { provider.getOutputStream().close(); }
        catch (IOException ignored) { /* 提供方可能已自行退出，仍须核对进程结束。 */ }
        if (!provider.waitFor(10, TimeUnit.SECONDS)) {
            provider.destroyForcibly();
            assertThat(provider.waitFor(5, TimeUnit.SECONDS)).as("测试提供方必须退出").isTrue();
        }
    }

    private Process applicationProvider(Path directory, String namespace, String app, String metadataMode, String version, Path ready) throws IOException {
        return new ProcessBuilder(Path.of(System.getProperty("java.home"), "bin", "java").toString(),
                "-Dfile.encoding=UTF-8", "-DsocksProxyHost=", "-cp",
                System.getProperty("surefire.test.class.path", System.getProperty("java.class.path")),
                DubboConnectionTestProvider.class.getName(), System.getProperty("task32.nacos.address"), namespace,
                app, app, app, metadataMode, ready.toString(), version)
                .redirectErrorStream(true).redirectOutput(directory.resolve("provider" + version + ".log").toFile()).start();
    }

    private ObjectNode apiDraft(String connectionId) throws Exception {
        String category = "运行测试-" + UUID.randomUUID().toString().substring(0, 8);
        send(post("/admin-api/api-categories").content(json.createObjectNode().put("name", category).toString()));
        // 此项只验固定连接冷启动；H2展示档案是测试资料，不替代平台人员认证。
        Instant now = Instant.now();
        profiles.remember(new io.github.chenyilei2016.openplatform.domain.access.EmployeeProfile(null, "runtime-tenant", "测试租户",
                "runtime-person", "101", "runtime-manager", "测试维护者", now), now);
        String owner = profiles.find("runtime-tenant", "runtime-person").orElseThrow().id();
        ObjectNode request = json.createObjectNode().put("service", "runtime_" + UUID.randomUUID().toString().substring(0, 8))
                .put("version", "1").put("method", "identify").put("name", "旧修订草稿").put("category", category).put("owner", owner);
        request.putArray("scopeCodes"); request.putArray("errorDefinitions"); request.putArray("mappings");
        request.putObject("requestSchema").put("type", "OBJECT");
        request.putObject("responseSchema").put("type", "STRING");
        ObjectNode binding = request.putObject("binding").put("protocol", "DUBBO").put("timeoutMillis", 2000);
        ObjectNode dubbo = binding.putObject("dubbo").put("interfaceName", ProbeService.class.getName())
                .put("method", "identify").put("version", "").put("group", "")
                .put("connectionId", connectionId).put("connectionRevision", 1);
        dubbo.putArray("parameterTypes");
        return request;
    }

    private void activate(String id, long revision, long stateVersion) throws Exception {
        send(post(PATH + "/" + id + "/activate").content(json.createObjectNode()
                .put("revision", revision).put("expectedStateVersion", stateVersion).toString()));
    }

    private void disable(String id) throws Exception {
        if (id == null) return;
        JsonNode connection = send(get(PATH + "/" + id)).get("connection");
        if (connection.get("enabled").asBoolean()) send(put(PATH + "/" + id + "/status").content(json.createObjectNode()
                .put("expectedStateVersion", connection.get("stateVersion").asLong()).put("enabled", false).toString()));
    }

    private void awaitValue(GenericDubboApiInvoker client, String id, long revision, String version, String expected) {
        await().atMost(Duration.ofSeconds(25)).pollInterval(Duration.ofMillis(200)).ignoreException(PlatformException.class)
                .untilAsserted(() -> assertThat(invoke(client, id, revision, version)).isEqualTo(expected));
    }

    public interface ProbeService { String identify(); }

    private Provider provider(String registryGroup, String version, String identity) throws IOException {
        FrameworkModel framework = new FrameworkModel();
        ApplicationModel model = framework.newApplication();
        DubboBootstrap bootstrap = DubboBootstrap.getInstance(model);
        try {
            ApplicationConfig application = new ApplicationConfig(model, "task32-provider-" + identity);
            application.setQosEnable(false);
            RegistryConfig registry = new RegistryConfig(model, System.getProperty("task32.nacos.address"));
            registry.setGroup(registryGroup);
            registry.setRegisterMode("interface");
            registry.setUseAsConfigCenter(false);
            registry.setUseAsMetadataCenter(false);
            registry.setParameters(Map.of("namespace", "", "nacos.retry", "1", "nacos.retry-wait", "100"));
            int port;
            try (ServerSocket available = new ServerSocket(0, 1, InetAddress.ofLiteral("::1"))) { port = available.getLocalPort(); }
            ProtocolConfig protocol = new ProtocolConfig(model, "dubbo", port);
            protocol.setHost("::1"); protocol.setSerialization("hessian2"); protocol.setThreads(2);
            ServiceConfig<ProbeService> service = new ServiceConfig<>(model.getDefaultModule());
            java.util.concurrent.atomic.AtomicInteger calls = new java.util.concurrent.atomic.AtomicInteger();
            service.setInterface(ProbeService.class); service.setRef(() -> { calls.incrementAndGet(); return identity; });
            if (!version.isEmpty()) service.setVersion(version);
            bootstrap.application(application).registry(registry).protocol(protocol).service(service).start();
            if (!InetAddress.ofLiteral(service.getExportedUrls().getFirst().getParameter("bind.ip")).isLoopbackAddress()) {
                throw new IllegalStateException("测试提供方必须绑定回环地址");
            }
            return new Provider(bootstrap, framework, calls);
        } catch (RuntimeException failure) {
            try { bootstrap.destroy(); } finally { framework.destroy(); }
            throw failure;
        }
    }

    private ObjectNode connection(String group) {
        ObjectNode config = json.createObjectNode();
        config.putObject("registry").put("address", System.getProperty("task32.nacos.address")).put("namespace", "").put("group", group);
        config.putObject("metadata").put("type", "NONE");
        config.put("discoveryMode", "INTERFACE").put("providerMetadataMode", "LOCAL");
        ObjectNode request = json.createObjectNode().put("name", group).put("description", "本机真实隔离验证");
        request.set("config", config);
        return request;
    }

    private Object invoke(GenericDubboApiInvoker client, String id, long revision, String version) {
        ApiBinding binding = new ApiBinding(ApiProtocol.DUBBO, 2000, null,
                new ApiBinding.Dubbo(ProbeService.class.getName(), "identify", version, "", List.of(), id, revision, null));
        return client.invoke(binding, Map.of(), CALLER, "task32-runtime-request");
    }

    private String diagnosticRequest() {
        ObjectNode body = json.createObjectNode().put("revision", 1);
        return body.toString();
    }

    private MockHttpServletRequestBuilder auth(MockHttpServletRequestBuilder request) {
        String cookie = "runtime-session";
        return request.session(io.github.chenyilei2016.openplatform.testing.TestSessions.session(cookie)).header("X-CSRF-Token",
                DigestUtils.md5DigestAsHex(cookie.getBytes(StandardCharsets.UTF_8))).contentType("application/json");
    }

    private JsonNode send(MockHttpServletRequestBuilder request) throws Exception {
        String body = mvc.perform(auth(request)).andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        return json.readTree(body).get("data");
    }

    private record Provider(DubboBootstrap bootstrap, FrameworkModel framework, java.util.concurrent.atomic.AtomicInteger calls) implements AutoCloseable {
        @Override public void close() { try { bootstrap.destroy(); } finally { framework.destroy(); } }
    }
}
