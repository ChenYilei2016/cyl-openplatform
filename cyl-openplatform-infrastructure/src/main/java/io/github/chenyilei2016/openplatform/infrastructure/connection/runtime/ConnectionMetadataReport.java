package io.github.chenyilei2016.openplatform.infrastructure.connection.runtime;

import com.alibaba.nacos.api.NacosFactory;
import com.alibaba.nacos.api.PropertyKeyConst;
import com.alibaba.nacos.api.config.ConfigService;
import com.alibaba.nacos.api.config.listener.Listener;
import io.lettuce.core.ClientOptions;
import io.lettuce.core.KeyValue;
import io.lettuce.core.RedisClient;
import io.lettuce.core.SocketOptions;
import io.lettuce.core.TimeoutOptions;
import io.lettuce.core.RedisURI;
import io.lettuce.core.api.StatefulRedisConnection;
import io.lettuce.core.pubsub.RedisPubSubAdapter;
import io.lettuce.core.pubsub.StatefulRedisPubSubConnection;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArraySet;
import java.util.concurrent.Executor;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import tools.jackson.core.StreamReadConstraints;
import tools.jackson.core.StreamReadFeature;
import tools.jackson.core.json.JsonFactory;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.json.JsonMapper;
import org.apache.dubbo.common.URL;
import org.apache.dubbo.common.utils.JsonUtils;
import org.apache.dubbo.metadata.MappingChangedEvent;
import org.apache.dubbo.metadata.MappingListener;
import org.apache.dubbo.metadata.MetadataInfo;
import org.apache.dubbo.metadata.ServiceNameMapping;
import org.apache.dubbo.metadata.definition.model.ServiceDefinition;
import org.apache.dubbo.metadata.report.MetadataReport;
import org.apache.dubbo.metadata.report.identifier.KeyTypeEnum;
import org.apache.dubbo.metadata.report.identifier.MetadataIdentifier;
import org.apache.dubbo.metadata.report.identifier.ServiceMetadataIdentifier;
import org.apache.dubbo.metadata.report.identifier.SubscriberMetadataIdentifier;
import org.apache.dubbo.metadata.store.nacos.NacosConfigServiceWrapper;

/** 复用官方键约定与成熟客户端的只读SPI；客户端、连接和订阅均归单个连接修订所有。 */
public final class ConnectionMetadataReport implements MetadataReport {
    static final String DEFAULT_REDIS_USER = "default";
    static final String EXECUTOR_ATTRIBUTE = "open-platform.metadata-executor";
    private static final JsonMapper METADATA_JSON = JsonMapper.builder(JsonFactory.builder()
            .streamReadConstraints(StreamReadConstraints.builder().maxDocumentLength(1_048_576)
                    .maxTokenCount(20_000).maxNestingDepth(64).maxStringLength(65_536).maxNumberLength(128).build()).build())
            .enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION)
            .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS).build();
    private static final int MAX_BYTES = 1_048_576;
    private static final int MAX_MAPPINGS = 100;
    private final AtomicBoolean closed = new AtomicBoolean();
    private final Map<String, Set<MappingListener>> listeners = new ConcurrentHashMap<>();
    private final Map<String, Listener> nacosListeners = new ConcurrentHashMap<>();
    private final Set<String> pendingMappingReads = new LinkedHashSet<>();
    private final AtomicBoolean mappingReadScheduled = new AtomicBoolean();
    private volatile ScheduledFuture<?> mappingRetry;
    private final long timeoutMillis;
    private final Executor notificationExecutor;
    private final String group;
    private final String mappingKey;
    private final String mappingChannel;
    private ConfigService nacos;
    private NacosConfigServiceWrapper config;
    private RedisClient redis;
    private StatefulRedisConnection<String, String> redisConnection;
    private StatefulRedisPubSubConnection<String, String> redisSubscription;

    public ConnectionMetadataReport(URL url) {
        this(url, (Executor) url.getOrDefaultApplicationModel().getAttribute(EXECUTOR_ATTRIBUTE));
    }

    /** 独立只读诊断复用同一协议实现，不必创建可业务调用的Dubbo模型。 */
    public ConnectionMetadataReport(URL url, Executor notificationExecutor) {
        this.notificationExecutor = notificationExecutor;
        if (notificationExecutor == null) throw new IllegalStateException("元数据中心缺少受控执行资源");
        timeoutMillis = url.getParameter("timeout", 2000L);
        if (timeoutMillis < 1 || timeoutMillis > 30_000) throw new IllegalArgumentException("元数据超时必须为1至30000毫秒");
        group = url.getParameter("group", "dubbo");
        mappingKey = group + ":" + ServiceNameMapping.DEFAULT_MAPPING_GROUP;
        mappingChannel = mappingKey + ":queues";
        try {
            if ("open-platform-nacos".equals(url.getProtocol())) {
                Properties properties = new Properties();
                properties.setProperty(PropertyKeyConst.SERVER_ADDR, url.getHost() + ":" + url.getPort());
                properties.setProperty(PropertyKeyConst.NAMESPACE, url.getParameter("namespace", ""));
                if (url.getUsername() != null) properties.setProperty(PropertyKeyConst.USERNAME, url.getUsername());
                if (url.getPassword() != null) properties.setProperty(PropertyKeyConst.PASSWORD, url.getPassword());
                nacos = NacosFactory.createConfigService(properties);
                config = new NacosConfigServiceWrapper(nacos);
            } else if ("open-platform-redis".equals(url.getProtocol())) {
                RedisURI.Builder builder = RedisURI.Builder.redis(url.getHost(), url.getPort())
                        .withDatabase(url.getParameter("database", 0)).withTimeout(Duration.ofMillis(timeoutMillis))
                        .withSsl(url.getParameter("ssl", false));
                if (url.getPassword() != null && !url.getPassword().isEmpty()) {
                    // 默认用户沿用单参数AUTH，兼容仅配置密码的Redis及Redis 6之前的服务端。
                    if (url.getUsername() == null || url.getUsername().isEmpty() || DEFAULT_REDIS_USER.equals(url.getUsername()))
                        builder.withPassword(url.getPassword().toCharArray());
                    else builder.withAuthentication(url.getUsername(), url.getPassword().toCharArray());
                }
                redis = RedisClient.create(builder.build());
                redis.setOptions(ClientOptions.builder().requestQueueSize(64)
                        .disconnectedBehavior(ClientOptions.DisconnectedBehavior.REJECT_COMMANDS)
                        .socketOptions(SocketOptions.builder().connectTimeout(Duration.ofMillis(timeoutMillis)).build())
                        .timeoutOptions(TimeoutOptions.enabled(Duration.ofMillis(timeoutMillis))).build());
                redisConnection = redis.connect();
            } else {
                throw new IllegalArgumentException("不支持的受控元数据协议");
            }
        } catch (Exception exception) {
            destroy();
            throw new IllegalStateException("元数据中心初始化失败，请核对中心地址与账号配置");
        }
    }

    /** 消费端保留Dubbo接口兼容，但不再读取后台浏览用的接口方法定义。 */
    @Override public String getServiceDefinition(MetadataIdentifier identifier) { return null; }

    @Override
    public MetadataInfo getAppMetadata(SubscriberMetadataIdentifier identifier, Map<String, String> instanceMetadata) {
        requireOpen();
        try {
            String content = config != null
                    ? config.getConfig(identifier.getApplication(), identifier.getRevision(), timeoutMillis)
                    : redisConnection.sync().get(identifier.getUniqueKey(KeyTypeEnum.UNIQUE_KEY));
            content = bounded(content);
            if (content == null || content.isBlank()) return null;
            METADATA_JSON.readTree(content);
            return JsonUtils.toJavaObject(content, MetadataInfo.class);
        } catch (Exception exception) {
            throw readFailure();
        }
    }

    @Override
    public Set<String> getServiceAppMapping(String serviceInterface, URL ignored) {
        requireOpen();
        try {
            String content = config != null
                    ? config.getConfig(serviceInterface, ServiceNameMapping.DEFAULT_MAPPING_GROUP, timeoutMillis)
                    : redisConnection.sync().hget(mappingKey, serviceInterface);
            return applicationNames(content);
        } catch (Exception exception) {
            throw readFailure();
        }
    }

    @Override
    public synchronized Set<String> getServiceAppMapping(String serviceInterface, MappingListener listener, URL url) {
        requireOpen();
        if (!listeners.containsKey(serviceInterface) && listeners.size() >= MAX_MAPPINGS) {
            throw new IllegalStateException("元数据映射订阅已达上限");
        }
        Set<MappingListener> subscribers = listeners.computeIfAbsent(serviceInterface, key -> new CopyOnWriteArraySet<>());
        if (subscribers.size() >= MAX_MAPPINGS && !subscribers.contains(listener))
            throw new IllegalStateException("单接口映射监听已达上限");
        boolean added = subscribers.add(listener);
        if (config != null && !nacosListeners.containsKey(serviceInterface)) {
            Listener nacosListener = new Listener() {
                @Override public Executor getExecutor() { return notificationExecutor; }
                @Override public void receiveConfigInfo(String content) { notifyMapping(serviceInterface, content); }
            };
            try {
                config.addListener(serviceInterface, ServiceNameMapping.DEFAULT_MAPPING_GROUP, nacosListener);
                nacosListeners.put(serviceInterface, nacosListener);
            } catch (Exception exception) {
                if (added) {
                    subscribers.remove(listener);
                    if (subscribers.isEmpty()) listeners.remove(serviceInterface);
                }
                throw readFailure();
            }
        }
        if (redis != null && redisSubscription == null) {
            try { startRedisSubscription(); }
            catch (RuntimeException failure) {
                if (added) {
                    subscribers.remove(listener);
                    if (subscribers.isEmpty()) listeners.remove(serviceInterface);
                }
                throw readFailure();
            }
        }
        try {
            return getServiceAppMapping(serviceInterface, url);
        } catch (RuntimeException failure) {
            if (added) removeServiceAppMappingListener(serviceInterface, listener);
            throw failure;
        }
    }

    /** 只在确有映射监听时订阅；普通定义读取和一次诊断只使用命令连接。 */
    private void startRedisSubscription() {
        StatefulRedisPubSubConnection<String, String> subscription = redis.connectPubSub();
        try {
            subscription.addListener(new RedisPubSubAdapter<>() {
                @Override public void message(String channel, String serviceInterface) {
                    if (mappingChannel.equals(channel)) queueMappingRead(serviceInterface);
                }
                @Override public void subscribed(String channel, long count) {
                    // Lettuce重连重订阅后补读已订阅接口，不能依赖断线期间丢失的PubSub事件。
                    if (mappingChannel.equals(channel)) listeners.keySet().forEach(ConnectionMetadataReport.this::queueMappingRead);
                }
            });
            subscription.sync().subscribe(mappingChannel);
            redisSubscription = subscription;
        } catch (RuntimeException failure) {
            subscription.close();
            throw failure;
        }
    }

    private void queueMappingRead(String serviceInterface) {
        if (closed.get()) return;
        synchronized (pendingMappingReads) {
            if (!listeners.containsKey(serviceInterface)) return;
            if (pendingMappingReads.size() < MAX_MAPPINGS) pendingMappingReads.add(serviceInterface);
        }
        if (mappingReadScheduled.compareAndSet(false, true)) submitMappingRead();
    }

    private void submitMappingRead() {
        if (closed.get()) { mappingReadScheduled.set(false); return; }
        try { notificationExecutor.execute(this::refreshMapping); }
        catch (RejectedExecutionException overloaded) { retryMappingRead(100); }
    }

    /** 同一占位贯穿退避与重新提交，每个report最多一个重试，不在事件线程读取Redis。 */
    private void retryMappingRead(long delayMillis) {
        synchronized (pendingMappingReads) {
            if (closed.get() || pendingMappingReads.isEmpty()) { mappingReadScheduled.set(false); return; }
        }
        try {
            mappingRetry = redis.getResources().eventExecutorGroup().schedule(this::submitMappingRead, delayMillis, TimeUnit.MILLISECONDS);
            if (closed.get()) mappingRetry.cancel(false);
        } catch (RejectedExecutionException shuttingDown) { mappingReadScheduled.set(false); }
    }

    private void refreshMapping() {
        List<String> serviceInterfaces;
        synchronized (pendingMappingReads) {
            serviceInterfaces = List.copyOf(pendingMappingReads);
            pendingMappingReads.clear();
        }
        boolean readFailed = false;
        try {
            if (!serviceInterfaces.isEmpty() && !closed.get()) {
                List<KeyValue<String, String>> mappings;
                try {
                    mappings = redisConnection.sync().hmget(mappingKey, serviceInterfaces.toArray(String[]::new));
                } catch (RuntimeException unavailable) {
                    readFailed = true;
                    synchronized (pendingMappingReads) {
                        for (String serviceInterface : serviceInterfaces) {
                            if (!closed.get() && listeners.containsKey(serviceInterface) && pendingMappingReads.size() < MAX_MAPPINGS)
                                pendingMappingReads.add(serviceInterface);
                        }
                    }
                    return;
                }
                for (KeyValue<String, String> mapping : mappings) {
                    if (listeners.containsKey(mapping.getKey())) notifyMapping(mapping.getKey(), mapping.getValueOrElse(null));
                }
            }
        } catch (RuntimeException listenerFailure) {
            // 订阅方处理失败不转成网络重试，也不向日志泄漏外部异常正文。
        } finally {
            if (readFailed) {
                // ACL/命令故障可能不触发PubSub重连；保留失败批次，恢复后无新事件也会补读。
                retryMappingRead(1000);
            } else {
                mappingReadScheduled.set(false);
                boolean reschedule;
                synchronized (pendingMappingReads) {
                    reschedule = !closed.get() && !pendingMappingReads.isEmpty() && mappingReadScheduled.compareAndSet(false, true);
                }
                if (reschedule) submitMappingRead();
            }
        }
    }

    @Override
    public synchronized void removeServiceAppMappingListener(String serviceInterface, MappingListener listener) {
        Set<MappingListener> subscribers = listeners.get(serviceInterface);
        if (subscribers == null) return;
        subscribers.remove(listener);
        if (!subscribers.isEmpty()) return;
        listeners.remove(serviceInterface);
        synchronized (pendingMappingReads) { pendingMappingReads.remove(serviceInterface); }
        Listener nacosListener = nacosListeners.remove(serviceInterface);
        if (nacosListener != null) {
            try { config.removeListener(serviceInterface, ServiceNameMapping.DEFAULT_MAPPING_GROUP, nacosListener); }
            catch (Exception ignored) { /* 关闭时仍会释放整个原生客户端。 */ }
        }
        if (redisSubscription != null && listeners.isEmpty()) {
            redisSubscription.close();
            redisSubscription = null;
        }
    }

    private void notifyMapping(String serviceInterface, String content) {
        if (closed.get()) return;
        Set<String> applications;
        try { applications = applicationNames(content); }
        catch (RuntimeException invalidMetadata) { return; }
        MappingChangedEvent event = new MappingChangedEvent(serviceInterface, applications);
        for (MappingListener listener : listeners.getOrDefault(serviceInterface, Set.of())) listener.onEvent(event);
    }

    private static Set<String> applicationNames(String content) {
        Set<String> applications = ServiceNameMapping.getAppNames(bounded(content));
        if (applications.size() > MAX_MAPPINGS || applications.stream().anyMatch(name -> name.length() > 256)) {
            throw new IllegalStateException("接口应用映射超出支持规模");
        }
        return applications;
    }

    private static String bounded(String content) {
        if (content != null && (content.length() > MAX_BYTES || content.getBytes(StandardCharsets.UTF_8).length > MAX_BYTES)) {
            throw new IllegalStateException("元数据正文超过1MiB，请由提供方拆分");
        }
        return content;
    }

    private void requireOpen() { if (closed.get()) throw new IllegalStateException("元数据连接已关闭"); }
    private static IllegalStateException readFailure() { return new IllegalStateException("元数据读取失败，请核对网络、权限与中心配置"); }
    private static UnsupportedOperationException readOnly() { return new UnsupportedOperationException("平台连接元数据SPI只允许读取"); }

    @Override public boolean shouldReportDefinition() { return false; }
    @Override public boolean shouldReportMetadata() { return false; }
    @Override public void storeProviderMetadata(MetadataIdentifier identifier, ServiceDefinition definition) { throw readOnly(); }
    @Override public void storeConsumerMetadata(MetadataIdentifier identifier, Map<String, String> parameters) { throw readOnly(); }
    @Override public void publishAppMetadata(SubscriberMetadataIdentifier identifier, MetadataInfo metadata) { throw readOnly(); }
    @Override public void unPublishAppMetadata(SubscriberMetadataIdentifier identifier, MetadataInfo metadata) { throw readOnly(); }
    @Override public boolean registerServiceAppMapping(String service, String application, URL url) { throw readOnly(); }
    @Override public boolean registerServiceAppMapping(String service, String mappingGroup, String content, Object ticket) { throw readOnly(); }
    @Override public void saveServiceMetadata(ServiceMetadataIdentifier identifier, URL url) { throw readOnly(); }
    @Override public void removeServiceMetadata(ServiceMetadataIdentifier identifier) { throw readOnly(); }
    @Override public void saveSubscribedData(SubscriberMetadataIdentifier identifier, Set<String> urls) { throw readOnly(); }
    @Override public List<String> getExportedURLs(ServiceMetadataIdentifier identifier) { throw readOnly(); }
    @Override public List<String> getSubscribedURLs(SubscriberMetadataIdentifier identifier) { throw readOnly(); }

    @Override
    public synchronized void destroy() {
        if (!closed.compareAndSet(false, true)) return;
        if (config != null) nacosListeners.forEach((service, listener) -> {
            try { config.removeListener(service, ServiceNameMapping.DEFAULT_MAPPING_GROUP, listener); }
            catch (Exception ignored) { /* 下方关闭客户端确保监听器资源最终释放。 */ }
        });
        nacosListeners.clear();
        listeners.clear();
        synchronized (pendingMappingReads) { pendingMappingReads.clear(); }
        ScheduledFuture<?> retry = mappingRetry;
        if (retry != null) retry.cancel(false);
        try {
            if (redisSubscription != null) redisSubscription.close();
        } finally {
            try {
                if (redisConnection != null) redisConnection.close();
            } finally {
                try {
                    if (redis != null) redis.shutdown();
                } finally {
                    if (nacos != null) {
                        try { nacos.shutDown(); }
                        catch (Exception ignored) { /* 无外部资源信息进入平台日志。 */ }
                    }
                }
            }
        }
    }
}
