package io.github.chenyilei2016.openplatform.infrastructure.connection.runtime;

import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.github.chenyilei2016.openplatform.domain.connection.DubboConnection;
import io.github.chenyilei2016.openplatform.domain.connection.DubboServiceIdentity;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutionException;
import io.github.chenyilei2016.openplatform.domain.connection.DubboConnectionConfig;
import io.github.chenyilei2016.openplatform.domain.connection.DubboConnectionRepository;
import io.github.chenyilei2016.openplatform.domain.connection.DubboConnectionRepository.RevisionKey;
import io.github.chenyilei2016.openplatform.domain.connection.DubboConnectionRevision;
import io.github.chenyilei2016.openplatform.domain.connection.DubboConnectionRuntime;
import io.github.chenyilei2016.openplatform.domain.connection.DubboConnectionUsageRepository;
import io.github.chenyilei2016.openplatform.domain.environmentrelease.ReleaseEnvironment;
import io.github.chenyilei2016.openplatform.infrastructure.connection.DubboConnectionSettings;
import io.github.chenyilei2016.openplatform.infrastructure.runtime.GatewayDubboSettings;
import java.util.LinkedHashMap;
import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Future;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.locks.ReentrantReadWriteLock;
import lombok.extern.slf4j.Slf4j;
import org.apache.dubbo.config.ApplicationConfig;
import org.apache.dubbo.config.ConsumerConfig;
import org.apache.dubbo.config.MetadataReportConfig;
import org.apache.dubbo.config.ReferenceConfig;
import org.apache.dubbo.config.RegistryConfig;
import org.apache.dubbo.config.bootstrap.DubboBootstrap;
import org.apache.dubbo.rpc.RpcContext;
import org.apache.dubbo.rpc.model.ApplicationModel;
import org.apache.dubbo.rpc.model.FrameworkModel;
import org.apache.dubbo.rpc.service.GenericService;
import org.springframework.beans.factory.DisposableBean;
import org.springframework.beans.factory.SmartInitializingSingleton;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.core.task.TaskRejectedException;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;
import org.springframework.stereotype.Component;
import tools.jackson.databind.json.JsonMapper;

/** 固定连接修订复用目录客户端；精确服务引用按需有界加载，调用复核整体启停事实。 */
@Slf4j
@Component
public final class ManagedDubboConnectionRuntime implements DubboConnectionRuntime, SmartInitializingSingleton, DisposableBean {
    private static final int MAX_REVISIONS = 16;
    private static final int MAX_REFERENCES = 100;
    private static final Duration IDLE_RETENTION = Duration.ofMinutes(5);
    private final DubboConnectionRepository repository;
    private final DubboConnectionUsageRepository usages;
    private final DubboConnectionSettings connectionProperties;
    private final GatewayDubboSettings gatewayProperties;
    private final ReleaseEnvironment environment;
    private final JsonMapper json;
    private final ThreadPoolTaskExecutor loader;
    private final ThreadPoolTaskExecutor metadataExecutor;
    private final ThreadPoolTaskExecutor diagnosticExecutor;
    private final ThreadPoolTaskScheduler scheduler;
    private final Map<RevisionKey, LoadedRevision> loaded = new ConcurrentHashMap<>();
    private final Map<RevisionKey, RegistryRevision> registryChecks = new ConcurrentHashMap<>();
    private final Map<RevisionKey, DiagnosticResult> recentChecks = new LinkedHashMap<>();
    private final Map<RevisionKey, CompletableFuture<LoadedRevision>> pending = new HashMap<>();
    private final Object reservations = new Object();
    private final AtomicBoolean closed = new AtomicBoolean();
    private int reservedReferences;
    private ScheduledFuture<?> refresh;

    public ManagedDubboConnectionRuntime(DubboConnectionRepository repository, DubboConnectionUsageRepository usages,
            DubboConnectionSettings connectionProperties, GatewayDubboSettings gatewayProperties,
            ReleaseEnvironment environment, JsonMapper json,
            @Qualifier("dubboConnectionLoader") ThreadPoolTaskExecutor loader,
            @Qualifier("dubboMetadataExecutor") ThreadPoolTaskExecutor metadataExecutor,
            @Qualifier("dubboConnectionDiagnostics") ThreadPoolTaskExecutor diagnosticExecutor,
            @Qualifier("dubboConnectionScheduler") ThreadPoolTaskScheduler scheduler) {
        this.repository = repository;
        this.usages = usages;
        this.connectionProperties = connectionProperties;
        this.gatewayProperties = gatewayProperties;
        this.environment = environment;
        this.json = json;
        this.loader = loader;
        this.metadataExecutor = metadataExecutor;
        this.diagnosticExecutor = diagnosticExecutor;
        this.scheduler = scheduler;
    }

    @Override
    public void afterSingletonsInstantiated() {
        refresh = scheduler.scheduleWithFixedDelay(this::refreshConnections, Duration.ofSeconds(5));
    }

    /** 激活事务已提交，预热仅为尽力加速；不能用资源暂不可用改写激活结果。 */
    @Override
    public void warmup(String connectionId, long revision) {
        try {
            enqueue(new RevisionKey(connectionId, revision), null, null);
        } catch (PlatformException unavailable) {
            log.warn("Dubbo连接预热暂未入队 connectionId={} revision={} code={}",
                    connectionId, revision, unavailable.getErrorCode());
        }
    }

    private CompletableFuture<LoadedRevision> enqueue(RevisionKey key, DubboConnection connection, DubboConnectionRevision revision) {
        synchronized (reservations) {
            if (closed.get()) throw unavailable("连接运行资源已关闭");
            LoadedRevision existing = loaded.get(key);
            if (existing != null) return CompletableFuture.completedFuture(existing);
            CompletableFuture<LoadedRevision> loading = pending.get(key);
            if (loading != null) return loading;
            if (loaded.size() + pending.size() >= MAX_REVISIONS)
                throw unavailable("本实例已达到16个连接修订上限，请等待空闲修订释放后重试");
            CompletableFuture<LoadedRevision> result = new CompletableFuture<>();
            pending.put(key, result);
            try { loader.execute(() -> prepare(key, connection, revision, result)); }
            catch (TaskRejectedException overloaded) {
                pending.remove(key);
                result.completeExceptionally(unavailable("连接加载资源繁忙，请稍后重试"));
            }
            return result;
        }
    }

    private LoadedRevision ready(DubboConnectionRevision saved) {
        return awaitSharedLoad(enqueue(new RevisionKey(saved.connectionId(), saved.revision()), null, saved));
    }

    private <T> T awaitSharedLoad(CompletableFuture<T> result) {
        try { return result.get(gatewayProperties.getTotalTimeout().toMillis(), TimeUnit.MILLISECONDS); }
        catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw unavailable("连接操作已中断，请重试");
        } catch (ExecutionException failed) {
            if (failed.getCause() instanceof PlatformException known) throw known;
            throw unavailable("连接加载失败，请检查注册中心及认证配置");
        } catch (java.util.concurrent.TimeoutException timeout) {
            // 一个等待者超时不取消共享加载，后续请求可复用结果。
            throw unavailable("连接加载超时，请检查网络后重试");
        }
    }

    /** 查询任务只属于当前请求；放弃等待时取消，不影响可被后续请求复用的共享加载。 */
    private <T> T awaitQuery(Future<T> result) throws InterruptedException, ExecutionException, java.util.concurrent.TimeoutException {
        try {
            return result.get(gatewayProperties.getTotalTimeout().toMillis(), TimeUnit.MILLISECONDS);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw interrupted;
        } finally {
            if (!result.isDone()) result.cancel(true);
        }
    }

    private static PlatformException unavailable(String message) {
        return new PlatformException(ErrorCode.DEPENDENCY_UNAVAILABLE, message);
    }

    private void refreshConnections() {
        if (closed.get() || loaded.isEmpty() && registryChecks.isEmpty()) return;
        try {
            Map<RevisionKey, LoadedRevision> loadedSnapshot = Map.copyOf(loaded);
            Map<RevisionKey, RegistryRevision> registrySnapshot = Map.copyOf(registryChecks);
            Set<String> ids = loadedSnapshot.keySet().stream().map(RevisionKey::connectionId).collect(java.util.stream.Collectors.toSet());
            registrySnapshot.keySet().forEach(key -> ids.add(key.connectionId()));
            Map<String, DubboConnection> connections = repository.findAll(ids);
            for (Map.Entry<RevisionKey, LoadedRevision> entry : loadedSnapshot.entrySet()) {
                pruneReferences(entry.getValue());
                DubboConnection connection = connections.get(entry.getKey().connectionId());
                if (connection == null || !connection.enabled() || entry.getValue().lastUsed.plus(IDLE_RETENTION).isBefore(Instant.now()))
                    retire(entry.getKey(), entry.getValue());
            }
            for (Map.Entry<RevisionKey, RegistryRevision> entry : registrySnapshot.entrySet()) {
                DubboConnection connection = connections.get(entry.getKey().connectionId());
                if (connection == null || !connection.enabled() || entry.getValue().lastUsed.plus(IDLE_RETENTION).isBefore(Instant.now()))
                    if (registryChecks.remove(entry.getKey(), entry.getValue())) entry.getValue().close();
            }
        } catch (RuntimeException unavailable) {
            // 数据库暂不可用时保留资源；实际调用仍复核启停事实。
            log.warn("Dubbo连接资源回收检查未完成");
        }
    }

    private void prepare(RevisionKey key, DubboConnection knownConnection, DubboConnectionRevision knownRevision,
                         CompletableFuture<LoadedRevision> result) {
        LoadedRevision prepared = null;
        try {
            DubboConnection connection = knownConnection == null ? connection(key.connectionId()) : knownConnection;
            if (!connection.enabled()) throw unavailable("连接整体已停用，未启动网络资源");
            DubboConnectionRevision revision = knownRevision == null ? repository.findRevision(key.connectionId(), key.revision())
                    .orElseThrow(() -> new PlatformException(ErrorCode.NOT_FOUND, "连接修订不存在")) : knownRevision;
            connectionProperties.validateConfiguration(revision.config());
            prepared = createRevision(revision);
            synchronized (reservations) {
                if (closed.get()) throw unavailable("运行时已关闭");
                loaded.put(key, prepared);
                result.complete(prepared);
                prepared = null;
            }
        } catch (Exception failure) {
            result.completeExceptionally(failure);
        } finally {
            try { if (prepared != null) prepared.close(); }
            finally { synchronized (reservations) { pending.remove(key); } }
        }
    }

    private LoadedRevision createRevision(DubboConnectionRevision revision) {
        DubboConnectionConfig config = revision.config();
        // Dubbo传输及执行器缓存有FRAMEWORK级共享；按连接修订隔离框架，避免销毁一项伤及其他连接，不按API创建模型。
        ApplicationModel model = new FrameworkModel().newApplication();
        DubboBootstrap bootstrap = DubboBootstrap.getInstance(model);
        Map<DubboServiceIdentity, ReferenceSlot> references = new ConcurrentHashMap<>();
        LoadedRevision result = new LoadedRevision(revision, model, bootstrap, references);
        try {
            model.setAttribute(ConnectionMetadataReport.EXECUTOR_ATTRIBUTE, metadataExecutor);
            ApplicationConfig application = new ApplicationConfig(model, "open-platform-connection-" + revision.connectionId() + "-" + revision.revision());
            application.setQosEnable(false);
            application.setNeedRefresh(false);
            RegistryConfig registry = new RegistryConfig(model);
            registry.setId("connection-registry");
            registry.setAddress(config.registry().address());
            registry.setGroup(config.registry().group());
            DubboConnectionSettings.Credential registryCredential = connectionProperties.resolveCredential(config.registry().credentialRef());
            registry.setUsername(registryCredential.username());
            registry.setPassword(registryCredential.password());
            registry.setParameters(Map.of("namespace", config.registry().namespace(), "nacos.retry", "1", "nacos.retry-wait", "100"));
            registry.setRegister(false);
            registry.setSubscribe(true);
            registry.setUseAsConfigCenter(false);
            registry.setUseAsMetadataCenter(false);
            registry.setNeedRefresh(false);
            bootstrap.application(application).registry(registry);
            if (config.metadata().type() != DubboConnectionConfig.MetadataType.NONE) {
                DubboConnectionConfig.Metadata metadata = config.metadata();
                MetadataReportConfig report = new MetadataReportConfig(model);
                report.setId("connection-registry");
                report.setRegistry("connection-registry");
                String metadataProtocol = metadata.type() == DubboConnectionConfig.MetadataType.NACOS ? "open-platform-nacos" : "open-platform-redis";
                report.setAddress(metadataProtocol + metadata.address().substring(metadata.address().indexOf("://")));
                report.setProtocol(metadataProtocol);
                report.setGroup(metadata.group());
                report.setTimeout(Math.toIntExact(gatewayProperties.getConnectTimeout().toMillis()));
                // 3.3.6把两个report配置都false视为整个中心无效，会连消费映射读取也跳过。
                // 保留原生中心初始化，实际写入由只读SPI的shouldReport*=false及拒写方法共同禁止。
                report.setCycleReport(false);
                report.setNeedRefresh(false);
                DubboConnectionSettings.Credential credential = connectionProperties.resolveCredential(metadata.credentialRef());
                // Dubbo URL不接受只有密码的authority；Redis未指定账号时就是标准default用户。
                String metadataUsername = credential.username();
                if (metadata.type() == DubboConnectionConfig.MetadataType.REDIS
                        && (metadataUsername == null || metadataUsername.isBlank()))
                    metadataUsername = ConnectionMetadataReport.DEFAULT_REDIS_USER;
                report.setUsername(metadataUsername);
                report.setPassword(credential.password());
                Map<String, String> parameters = new HashMap<>();
                if (metadata.namespace() != null) parameters.put("namespace", metadata.namespace());
                if (metadata.database() != null) parameters.put("database", metadata.database().toString());
                parameters.put("ssl", Boolean.toString(metadata.address().startsWith("rediss://")));
                report.setParameters(parameters);
                bootstrap.metadataReport(report);
            }
            ConsumerConfig consumer = new ConsumerConfig(model.getDefaultModule());
            consumer.setCheck(false);
            consumer.setRetries(0);
            consumer.setNeedRefresh(false);
            bootstrap.consumer(consumer);
            result.registry = registry;
            result.consumer = consumer;
            bootstrap.start();
            return result;
        } catch (Exception failure) {
            result.close();
            throw failure;
        }
    }

    /** API绑定是调用目标的唯一来源；只读注册中心检查不会创建业务引用。 */
    public ReferenceLease acquire(String connectionId, long revision, DubboServiceIdentity service) {
        DubboConnection connection = connection(connectionId);
        if (!connection.enabled()) throw new PlatformException(ErrorCode.DOWNSTREAM_FAILED, "提供方连接已整体停用");
        if (!java.util.Objects.equals(connection.activeRevision(), revision)
                && !usages.isReferenced(connectionId, revision))
            throw new PlatformException(ErrorCode.CONFLICT, "该连接修订尚未激活或未被API引用");
        LoadedRevision runtime = loaded.get(new RevisionKey(connectionId, revision));
        if (runtime == null) runtime = ready(repository.findRevision(connectionId, revision)
                .orElseThrow(() -> new PlatformException(ErrorCode.NOT_FOUND, "连接修订不存在")));
        LoadedRevision selectedRuntime = runtime;
        ReferenceSlot slot;
        synchronized (reservations) {
            if (runtime.closed.get()) throw unavailable("连接资源已关闭，请重试");
            slot = runtime.references.get(service);
            if (slot == null) {
                if (reservedReferences >= MAX_REFERENCES)
                    throw new PlatformException(ErrorCode.RATE_LIMITED, "本实例服务引用已达100项，请等待空闲引用释放后重试");
                slot = new ReferenceSlot();
                runtime.references.put(service, slot);
                reservedReferences++;
                ReferenceSlot loading = slot;
                try { loader.execute(() -> loadReference(selectedRuntime, service, loading)); }
                catch (TaskRejectedException overloaded) { discardReference(runtime, service, loading); loading.result.completeExceptionally(unavailable("引用加载繁忙，请重试")); }
            }
        }
        PreparedReference reference = awaitSharedLoad(slot.result);
        runtime.lifecycle.readLock().lock();
        boolean leased = false;
        try {
            if (runtime.closed.get() || runtime.references.get(service) != slot || !connection(connectionId).enabled())
                throw new PlatformException(ErrorCode.DOWNSTREAM_FAILED, "连接已停用或引用已回收，请重试");
            runtime.lastUsed = slot.lastUsed = Instant.now();
            leased = true;
            return new ReferenceLease(reference, runtime.lifecycle);
        } finally { if (!leased) runtime.lifecycle.readLock().unlock(); }
    }

    private void loadReference(LoadedRevision runtime, DubboServiceIdentity service, ReferenceSlot slot) {
        runtime.lifecycle.readLock().lock();
        ReferenceConfig<GenericService> reference = null;
        try {
            if (runtime.closed.get()) throw unavailable("连接资源已关闭");
            reference = reference(runtime, service);
            GenericService proxy = reference.get();
            if (!service.version().equals(normalize(reference.getVersion())) || !service.group().equals(normalize(reference.getGroup())))
                throw new IllegalStateException("引用身份被非连接配置覆盖");
            slot.result.complete(new PreparedReference(reference, proxy));
            reference = null;
        } catch (Exception failure) {
            slot.result.completeExceptionally(new PlatformException(ErrorCode.DEPENDENCY_UNAVAILABLE, "服务引用建立失败，请检查所选接口、版本、组和注册中心", failure));
            discardReference(runtime, service, slot);
        } finally {
            try { if (reference != null) reference.destroy(); }
            finally { runtime.lifecycle.readLock().unlock(); }
        }
    }

    private ReferenceConfig<GenericService> reference(LoadedRevision runtime, DubboServiceIdentity service) {
        DubboConnectionConfig config = runtime.revision.config();
        ReferenceConfig<GenericService> reference = new ReferenceConfig<>(runtime.model.getDefaultModule());
        reference.setInterface(service.interfaceName());
        if (!service.version().isEmpty()) reference.setVersion(service.version());
        if (!service.group().isEmpty()) reference.setGroup(service.group());
        reference.setRegistry(runtime.registry);
        reference.setConsumer(runtime.consumer);
        reference.setGeneric("true");
        reference.setRetries(0);
        reference.setCheck(false);
        reference.setLazy(false);
        reference.setInjvm(false);
        reference.setTimeout(Math.toIntExact(gatewayProperties.getTotalTimeout().toMillis()));
        Map<String, String> parameters = new HashMap<>();
        parameters.put("serialization", "hessian2");
        parameters.put("payload", Integer.toString(gatewayProperties.getMaxPayloadBytes()));
        parameters.put("connect.timeout", Long.toString(Math.min(gatewayProperties.getConnectTimeout().toMillis(), gatewayProperties.getTotalTimeout().toMillis())));
        parameters.put("send.reconnect", "false");
        parameters.put("migration.step", config.discoveryMode() == DubboConnectionConfig.DiscoveryMode.INTERFACE ? "FORCE_INTERFACE" : "FORCE_APPLICATION");
        if (service.providerApplication() != null) parameters.put("provided-by", service.providerApplication());
        reference.setParameters(parameters);
        return reference;
    }

    private void discardReference(LoadedRevision runtime, DubboServiceIdentity service, ReferenceSlot slot) {
        synchronized (reservations) {
            if (runtime.references.remove(service, slot)) reservedReferences--;
        }
    }

    private void pruneReferences(LoadedRevision runtime) {
        if (!runtime.lifecycle.writeLock().tryLock()) return;
        try {
            Instant cutoff = Instant.now().minus(IDLE_RETENTION);
            runtime.references.forEach((service, slot) -> {
                if (slot.result.isDone() && !slot.result.isCompletedExceptionally() && slot.lastUsed.isBefore(cutoff)) {
                    slot.result.join().reference().destroy();
                    discardReference(runtime, service, slot);
                }
            });
        } finally { runtime.lifecycle.writeLock().unlock(); }
    }

    @Override
    public DiagnosticResult diagnose(String connectionId, long revision) {
        DubboConnectionRevision saved = savedRevision(connectionId, revision);
        DiagnosticResult result = diagnoseRegistry(saved);
        synchronized (reservations) {
            // ponytail: 仅保留本实例最近64份检查，跨实例历史需求再持久化；缺记录表示未知。
            RevisionKey key = new RevisionKey(connectionId, revision);
            recentChecks.remove(key);
            recentChecks.put(key, result);
            if (recentChecks.size() > 64) recentChecks.remove(recentChecks.keySet().iterator().next());
        }
        return result;
    }

    @Override
    public Map<String, DiagnosticResult> recentChecks(Set<String> connectionIds) {
        Map<String, DiagnosticResult> result = new HashMap<>();
        synchronized (reservations) {
            recentChecks.values().forEach(check -> {
                if (connectionIds.contains(check.connectionId())) result.put(check.connectionId(), check);
            });
        }
        return Map.copyOf(result);
    }

    private DiagnosticResult diagnoseRegistry(DubboConnectionRevision saved) {
        try {
            saved.config().registry().validate();
            connectionProperties.resolveCredential(saved.config().registry().credentialRef());
            if (!connection(saved.connectionId()).enabled())
                return registryResult(saved, CheckStatus.FAILED, "连接已整体停用，未发起网络检查", CheckStatus.NOT_CHECKED, "未检查注册中心");
        } catch (PlatformException invalid) {
            return registryResult(saved, CheckStatus.FAILED, invalid.getMessage(), CheckStatus.NOT_CHECKED, "注册中心配置或账号引用需要修正");
        }
        try {
            return awaitQuery(diagnosticExecutor.submit(() -> {
                RegistryRevision selected = registryRevision(saved);
                selected.lifecycle.readLock().lock();
                try {
                    if (selected.closed.get() || !connection(saved.connectionId()).enabled()) throw unavailable("连接已停用或检查资源已关闭");
                    selected.lastUsed = Instant.now();
                    NacosRegistryClient.Access access = selected.client.check();
                    return registryResult(saved, CheckStatus.PASSED, "已保存注册中心配置及账号引用有效", access.status(), access.summary());
                } finally { selected.lifecycle.readLock().unlock(); }
            }));
        } catch (TaskRejectedException overloaded) {
            return registryResult(saved, CheckStatus.PASSED, "已保存注册中心配置已核验", CheckStatus.UNAVAILABLE, "检查资源繁忙，请稍后重试");
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            return registryResult(saved, CheckStatus.PASSED, "已保存注册中心配置已核验", CheckStatus.UNAVAILABLE, "检查已中断，请重新检查");
        } catch (java.util.concurrent.TimeoutException timeout) {
            return registryResult(saved, CheckStatus.PASSED, "已保存注册中心配置已核验", CheckStatus.UNAVAILABLE, "注册中心检查超时，请稍后重试");
        } catch (ExecutionException failed) {
            return registryResult(saved, CheckStatus.PASSED, "已保存注册中心配置已核验", CheckStatus.UNAVAILABLE,
                    failed.getCause() instanceof PlatformException known ? known.getMessage() : "注册中心检查未完成，请稍后重试");
        } catch (PlatformException unavailable) {
            return registryResult(saved, CheckStatus.PASSED, "已保存注册中心配置已核验", CheckStatus.UNAVAILABLE, unavailable.getMessage());
        }
    }

    private RegistryRevision registryRevision(DubboConnectionRevision saved) {
        RevisionKey key = new RevisionKey(saved.connectionId(), saved.revision());
        DubboConnectionSettings.Credential credential = connectionProperties.resolveCredential(saved.config().registry().credentialRef());
        synchronized (reservations) {
            if (closed.get()) throw unavailable("连接运行资源已关闭");
            RegistryRevision existing = registryChecks.get(key);
            if (existing != null && existing.credential.equals(credential)) return existing;
            if (existing != null) { registryChecks.remove(key); existing.close(); }
            if (registryChecks.size() >= MAX_REVISIONS) throw unavailable("本实例已达到16个注册中心检查修订上限，请等待空闲资源释放后重试");
            RegistryRevision prepared = new RegistryRevision(new NacosRegistryClient(saved.config().registry(), credential,
                    gatewayProperties.getConnectTimeout(), json), credential);
            registryChecks.put(key, prepared);
            return prepared;
        }
    }

    private static DiagnosticResult registryResult(DubboConnectionRevision saved, CheckStatus configStatus, String configSummary,
                                                   CheckStatus registryStatus, String registrySummary) {
        return new DiagnosticResult(saved.connectionId(), saved.revision(), Instant.now(), List.of(
                new Check(Stage.CONFIG, configStatus, configSummary), new Check(Stage.REGISTRY, registryStatus, registrySummary),
                new Check(Stage.INSTANCES, CheckStatus.NOT_CHECKED, "业务实例不在本次检查范围"),
                new Check(Stage.MAPPING, CheckStatus.NOT_CHECKED, "接口应用映射不在本次检查范围"),
                new Check(Stage.RUNTIME_METADATA, CheckStatus.NOT_CHECKED, "运行元数据不在本次检查范围"),
                new Check(Stage.DEFINITION, CheckStatus.NOT_CHECKED, "业务接口及方法不在本次检查范围")));
    }

    private DubboConnectionRevision savedRevision(String id, long revision) {
        connection(id);
        if (revision < 1) throw new PlatformException(ErrorCode.INVALID_REQUEST, "连接修订必须为正整数");
        return repository.findRevision(id, revision).orElseThrow(() -> new PlatformException(ErrorCode.NOT_FOUND, "连接修订不存在"));
    }

    private DubboConnection connection(String id) {
        DubboConnection connection = repository.find(id).orElseThrow(() -> new PlatformException(ErrorCode.NOT_FOUND, "连接不存在"));
        if (!environment.environmentId().equals(connection.environmentId())) throw new PlatformException(ErrorCode.FORBIDDEN, "连接不属于当前环境");
        return connection;
    }

    private static String normalize(String value) { return value == null ? "" : value.strip(); }

    private void retire(RevisionKey key, LoadedRevision runtime) {
        if (!loaded.remove(key, runtime)) return;
        try {
            runtime.close();
        } finally {
            synchronized (reservations) { reservedReferences -= runtime.references.size(); runtime.references.clear(); }
        }
    }

    @Override
    public void destroy() {
        synchronized (reservations) { if (!closed.compareAndSet(false, true)) return; }
        if (refresh != null) refresh.cancel(false);
        registryChecks.values().forEach(RegistryRevision::close);
        registryChecks.clear();
        RuntimeException cleanupFailure = null;
        for (Map.Entry<RevisionKey, LoadedRevision> entry : loaded.entrySet()) {
            try {
                retire(entry.getKey(), entry.getValue());
            } catch (RuntimeException failure) {
                if (cleanupFailure == null) cleanupFailure = failure;
                else cleanupFailure.addSuppressed(failure);
            }
        }
        if (cleanupFailure != null) throw cleanupFailure;
    }

    private static final class ReferenceSlot {
        private final CompletableFuture<PreparedReference> result = new CompletableFuture<>();
        private volatile Instant lastUsed = Instant.now();
    }
    private static final class RegistryRevision implements AutoCloseable {
        private final NacosRegistryClient client;
        private final DubboConnectionSettings.Credential credential;
        private final ReentrantReadWriteLock lifecycle = new ReentrantReadWriteLock();
        private final AtomicBoolean closed = new AtomicBoolean();
        private volatile Instant lastUsed = Instant.now();
        private RegistryRevision(NacosRegistryClient client, DubboConnectionSettings.Credential credential) {
            this.client = client; this.credential = credential;
        }
        @Override public void close() {
            lifecycle.writeLock().lock();
            try { if (closed.compareAndSet(false, true)) client.close(); }
            finally { lifecycle.writeLock().unlock(); }
        }
    }
    private record PreparedReference(ReferenceConfig<GenericService> reference, GenericService service) {}

    public static final class ReferenceLease implements AutoCloseable {
        private final PreparedReference reference;
        private final ReentrantReadWriteLock lifecycle;
        private ReferenceLease(PreparedReference reference, ReentrantReadWriteLock lifecycle) { this.reference = reference; this.lifecycle = lifecycle; }
        public GenericService service() { return reference.service(); }
        @Override public void close() { lifecycle.readLock().unlock(); }
    }

    private static final class LoadedRevision implements AutoCloseable {
        private final DubboConnectionRevision revision;
        private final ApplicationModel model;
        private final DubboBootstrap bootstrap;
        private final Map<DubboServiceIdentity, ReferenceSlot> references;
        private RegistryConfig registry;
        private ConsumerConfig consumer;
        private final ReentrantReadWriteLock lifecycle = new ReentrantReadWriteLock();
        private final AtomicBoolean closed = new AtomicBoolean();
        private volatile Instant lastUsed = Instant.now();
        private LoadedRevision(DubboConnectionRevision revision, ApplicationModel model, DubboBootstrap bootstrap, Map<DubboServiceIdentity, ReferenceSlot> references) {
            this.revision = revision; this.model = model; this.bootstrap = bootstrap; this.references = references;
        }
        @Override public void close() {
            lifecycle.writeLock().lock();
            try {
                if (!closed.compareAndSet(false, true)) return;
                try {
                    references.values().forEach(slot -> {
                        if (slot.result.isDone() && !slot.result.isCompletedExceptionally()) slot.result.join().reference().destroy();
                        else slot.result.completeExceptionally(unavailable("连接资源已关闭"));
                    });
                }
                finally {
                    try { bootstrap.destroy(); }
                    finally { model.getFrameworkModel().destroy(); }
                }
            } finally { lifecycle.writeLock().unlock(); }
        }
    }
}
