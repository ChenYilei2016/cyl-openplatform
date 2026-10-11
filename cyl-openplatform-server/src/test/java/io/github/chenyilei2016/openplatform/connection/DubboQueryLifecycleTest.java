package io.github.chenyilei2016.openplatform.connection;

import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.github.chenyilei2016.openplatform.domain.connection.*;
import io.github.chenyilei2016.openplatform.domain.environmentrelease.ReleaseEnvironment;
import io.github.chenyilei2016.openplatform.infrastructure.connection.runtime.ManagedDubboConnectionRuntime;
import io.github.chenyilei2016.openplatform.infrastructure.properties.connection.DubboConnectionProperties;
import io.github.chenyilei2016.openplatform.infrastructure.runtime.GatewayDubboSettings;
import java.time.Duration;
import java.time.Instant;
import java.util.Optional;
import java.util.Map;
import java.util.Set;
import java.util.List;
import java.util.ArrayList;
import java.util.Collections;
import java.util.concurrent.Callable;
import java.util.concurrent.CompletableFuture;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;
import tools.jackson.databind.json.JsonMapper;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** 隔离外部SDK启动与查询执行器，验证公开查询的Future所有权；不替代真实Nacos联调。 */
class DubboQueryLifecycleTest {
    private final ThreadPoolTaskExecutor loader = mock(ThreadPoolTaskExecutor.class);
    private final ThreadPoolTaskExecutor diagnostics = mock(ThreadPoolTaskExecutor.class);
    private final DubboConnectionRepository repository = mock(DubboConnectionRepository.class);
    private final GatewayDubboSettings settings = mock(GatewayDubboSettings.class);
    private final ThreadPoolTaskScheduler scheduler = mock(ThreadPoolTaskScheduler.class);
    private final ManagedDubboConnectionRuntime runtime;

    DubboQueryLifecycleTest() {
        ReleaseEnvironment environment = mock(ReleaseEnvironment.class);
        when(environment.environmentId()).thenReturn("test");
        when(settings.getTotalTimeout()).thenReturn(Duration.ofMillis(50));
        when(settings.getConnectTimeout()).thenReturn(Duration.ofMillis(50));
        DubboConnectionConfig config = new DubboConnectionConfig(new DubboConnectionConfig.Registry("nacos://127.0.0.1:1", "", "test", null),
                new DubboConnectionConfig.Metadata(DubboConnectionConfig.MetadataType.NONE, null, null, null, null, null),
                DubboConnectionConfig.DiscoveryMode.INTERFACE, DubboConnectionConfig.ProviderMetadataMode.LOCAL);
        when(repository.find("connection")).thenReturn(Optional.of(new DubboConnection("connection", "测试连接", "test", "", 1, 1L, true, 1, Instant.now())));
        when(repository.findRevision("connection", 1)).thenReturn(Optional.of(new DubboConnectionRevision("connection", 1, config, Instant.now())));
        runtime = new ManagedDubboConnectionRuntime(repository, mock(DubboConnectionUsageRepository.class), new DubboConnectionProperties(),
                settings, environment, JsonMapper.builder().build(), loader, mock(ThreadPoolTaskExecutor.class), diagnostics, scheduler);
    }

    @AfterEach
    void close() {
        Thread.interrupted();
        runtime.destroy();
    }

    @Test
    void registryCheckDoesNotLoadBusinessRuntimeOrRequireMetadataCredentials() throws Exception {
        HttpServer center = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        java.util.concurrent.atomic.AtomicInteger requests = new java.util.concurrent.atomic.AtomicInteger();
        center.createContext("/nacos/v1/ns/catalog/services", exchange -> {
            requests.incrementAndGet();
            assertThat(exchange.getRequestURI().getRawQuery()).contains("pageSize=1", "namespaceId=registry-only", "groupName=test");
            byte[] response = "{\"count\":0,\"serviceList\":[]}".getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, response.length);
            exchange.getResponseBody().write(response); exchange.close();
        });
        center.start();
        try {
            when(settings.getTotalTimeout()).thenReturn(Duration.ofSeconds(3));
            when(settings.getConnectTimeout()).thenReturn(Duration.ofSeconds(1));
            DubboConnectionConfig config = new DubboConnectionConfig(
                    new DubboConnectionConfig.Registry("nacos://127.0.0.1:" + center.getAddress().getPort(), "registry-only", "test", null),
                    new DubboConnectionConfig.Metadata(DubboConnectionConfig.MetadataType.NACOS, "nacos://127.0.0.1:1", "metadata-only", "metadata", null, "missing-metadata"),
                    DubboConnectionConfig.DiscoveryMode.APPLICATION, DubboConnectionConfig.ProviderMetadataMode.REMOTE);
            when(repository.findRevision("connection", 1)).thenReturn(Optional.of(new DubboConnectionRevision("connection", 1, config, Instant.now())));
            doAnswer(call -> CompletableFuture.completedFuture(call.getArgument(0, Callable.class).call()))
                    .when(diagnostics).submit(any(Callable.class));
            DubboConnectionRuntime.DiagnosticResult result = runtime.diagnose("connection", 1);
            assertThat(result.checks()).anySatisfy(check -> {
                assertThat(check.stage()).isEqualTo(DubboConnectionRuntime.Stage.REGISTRY);
                assertThat(check.status()).isEqualTo(DubboConnectionRuntime.CheckStatus.PASSED);
            });
            assertThat(requests.get()).isEqualTo(1);
            verifyNoInteractions(loader);
        } finally { center.stop(0); }
    }

    @Test
    void registryRejectionDistinguishesKnownAuthenticationAndPermissionReasonsWithoutExposingRemoteBody() throws Exception {
        HttpServer center = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        java.util.concurrent.atomic.AtomicReference<String> responseBody = new java.util.concurrent.atomic.AtomicReference<>();
        center.createContext("/nacos/v1/ns/catalog/services", exchange -> {
            byte[] response = responseBody.get().getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(403, response.length);
            exchange.getResponseBody().write(response); exchange.close();
        });
        center.start();
        try {
            when(settings.getTotalTimeout()).thenReturn(Duration.ofSeconds(3));
            DubboConnectionConfig config = new DubboConnectionConfig(
                    new DubboConnectionConfig.Registry("nacos://127.0.0.1:" + center.getAddress().getPort(), "", "test", null),
                    new DubboConnectionConfig.Metadata(DubboConnectionConfig.MetadataType.NONE, null, null, null, null, null),
                    DubboConnectionConfig.DiscoveryMode.INTERFACE, DubboConnectionConfig.ProviderMetadataMode.LOCAL);
            when(repository.findRevision("connection", 1)).thenReturn(Optional.of(new DubboConnectionRevision("connection", 1, config, Instant.now())));
            doAnswer(call -> CompletableFuture.completedFuture(call.getArgument(0, Callable.class).call())).when(diagnostics).submit(any(Callable.class));
            String[][] cases = {{"{\"message\":\"unknown user!\"}", "认证失败"}, {"user not found!", "认证失败"},
                    {"authorization failed!", "读取权限被拒绝"}, {"unrecognized remote secret", "认证或读取权限被拒绝"}};
            for (String[] scenario : cases) {
                responseBody.set(scenario[0]);
                DubboConnectionRuntime.Check registry = runtime.diagnose("connection", 1).checks().stream()
                        .filter(check -> check.stage() == DubboConnectionRuntime.Stage.REGISTRY).findFirst().orElseThrow();
                assertThat(registry.status()).isEqualTo(DubboConnectionRuntime.CheckStatus.FAILED);
                assertThat(registry.summary()).contains(scenario[1]).doesNotContain(scenario[0]);
            }
            verifyNoInteractions(loader);
        } finally { center.stop(0); }
    }

    @Test
    void refreshOnlyRetiresTheClientSnapshotThatItActuallyQueried() throws Exception {
        HttpServer center = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        List<Integer> newcomerPorts = Collections.synchronizedList(new ArrayList<>());
        center.createContext("/nacos/v1/ns/catalog/services", exchange -> {
            if (exchange.getRequestURI().getRawQuery().contains("groupName=newcomer")) newcomerPorts.add(exchange.getRemoteAddress().getPort());
            byte[] response = "{\"count\":0,\"serviceList\":[]}".getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, response.length); exchange.getResponseBody().write(response); exchange.close();
        });
        center.start();
        try {
            when(settings.getTotalTimeout()).thenReturn(Duration.ofSeconds(3));
            for (String id : List.of("connection", "newcomer")) {
                DubboConnectionConfig config = new DubboConnectionConfig(
                        new DubboConnectionConfig.Registry("nacos://127.0.0.1:" + center.getAddress().getPort(), "", id, null),
                        new DubboConnectionConfig.Metadata(DubboConnectionConfig.MetadataType.NONE, null, null, null, null, null),
                        DubboConnectionConfig.DiscoveryMode.INTERFACE, DubboConnectionConfig.ProviderMetadataMode.LOCAL);
                when(repository.find(id)).thenReturn(Optional.of(new DubboConnection(id, "测试连接", "test", "", 1, 1L, true, 1, Instant.now())));
                when(repository.findRevision(id, 1)).thenReturn(Optional.of(new DubboConnectionRevision(id, 1, config, Instant.now())));
            }
            doAnswer(call -> CompletableFuture.completedFuture(call.getArgument(0, Callable.class).call())).when(diagnostics).submit(any(Callable.class));
            runtime.diagnose("connection", 1);
            when(repository.findAll(anySet())).thenAnswer(call -> {
                assertThat(call.getArgument(0, Set.class)).containsExactly("connection");
                runtime.diagnose("newcomer", 1);
                return Map.of("connection", repository.find("connection").orElseThrow());
            });
            runtime.afterSingletonsInstantiated();
            ArgumentCaptor<Runnable> refresh = ArgumentCaptor.forClass(Runnable.class);
            verify(scheduler).scheduleWithFixedDelay(refresh.capture(), any(Duration.class));
            refresh.getValue().run();
            assertThat(runtime.diagnose("newcomer", 1).checks()).anySatisfy(check -> {
                assertThat(check.stage()).isEqualTo(DubboConnectionRuntime.Stage.REGISTRY);
                assertThat(check.status()).isEqualTo(DubboConnectionRuntime.CheckStatus.PASSED);
            });
            assertThat(newcomerPorts).hasSize(2);
            assertThat(newcomerPorts.get(1)).as("新客户端应保留并复用同一HTTP连接").isEqualTo(newcomerPorts.get(0));
            verifyNoInteractions(loader);
        } finally { center.stop(0); }
    }

    @Test
    void registryTimeoutCancelsItsOwnQueryWithoutStartingBusinessRuntime() {
        CompletableFuture<Object> query = pendingQuery();
        assertThat(runtime.diagnose("connection", 1).checks()).anySatisfy(check -> {
            assertThat(check.stage()).isEqualTo(DubboConnectionRuntime.Stage.REGISTRY);
            assertThat(check.status()).isEqualTo(DubboConnectionRuntime.CheckStatus.UNAVAILABLE);
            assertThat(check.summary()).contains("超时");
        });
        assertThat(query.isCancelled()).isTrue();
        verifyNoInteractions(loader);
    }

    @Test
    void registryInterruptionCancelsItsOwnQueryAndPreservesInterrupt() {
        CompletableFuture<Object> query = pendingQuery();
        Thread.currentThread().interrupt();
        runtime.diagnose("connection", 1);
        assertThat(Thread.currentThread().isInterrupted()).isTrue();
        assertThat(query.isCancelled()).isTrue();
        verifyNoInteractions(loader);
    }

    @Test
    void aTimedOutWaiterDoesNotDiscardSharedBusinessRevisionLoading() {
        DubboServiceIdentity service = new DubboServiceIdentity("example.OrderService", "", "", null);
        for (int attempt = 0; attempt < 2; attempt++)
            assertThatThrownBy(() -> runtime.acquire("connection", 1, service)).isInstanceOf(PlatformException.class);
        verify(loader, times(1)).execute(any(Runnable.class));
        verifyNoInteractions(diagnostics);
    }

    @Test
    void businessCapacityDoesNotPreventIndependentRegistryCheck() {
        for (int revision = 1; revision <= 16; revision++) runtime.warmup("other", revision);
        assertThatCode(() -> runtime.warmup("connection", 1)).doesNotThrowAnyException();
        pendingQuery();
        runtime.diagnose("connection", 1);
        verify(loader, times(16)).execute(any(Runnable.class));
        verify(diagnostics).submit(any(Callable.class));
    }

    @SuppressWarnings("unchecked")
    private CompletableFuture<Object> pendingQuery() {
        CompletableFuture<Object> query = new CompletableFuture<>();
        doReturn(query).when(diagnostics).submit(any(Callable.class));
        return query;
    }

}
