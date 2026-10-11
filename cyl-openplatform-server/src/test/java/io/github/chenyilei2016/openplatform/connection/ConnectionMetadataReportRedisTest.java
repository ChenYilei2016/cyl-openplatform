package io.github.chenyilei2016.openplatform.connection;

import io.github.chenyilei2016.openplatform.infrastructure.connection.runtime.ConnectionMetadataReport;
import io.lettuce.core.AclSetuserArgs;
import io.lettuce.core.RedisClient;
import io.lettuce.core.protocol.CommandType;
import io.lettuce.core.RedisURI;
import io.lettuce.core.api.StatefulRedisConnection;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.BooleanSupplier;
import java.util.function.Consumer;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.apache.dubbo.common.URL;
import org.apache.dubbo.metadata.MappingChangedEvent;
import org.apache.dubbo.metadata.MappingListener;
import org.apache.dubbo.metadata.MetadataInfo;
import org.apache.dubbo.metadata.ServiceNameMapping;
import org.apache.dubbo.metadata.definition.model.ServiceDefinition;
import org.apache.dubbo.metadata.report.MetadataReport;
import org.apache.dubbo.metadata.report.MetadataReportFactory;
import org.apache.dubbo.metadata.report.identifier.KeyTypeEnum;
import org.apache.dubbo.metadata.report.identifier.MetadataIdentifier;
import org.apache.dubbo.metadata.report.identifier.SubscriberMetadataIdentifier;
import org.apache.dubbo.rpc.model.ApplicationModel;
import org.apache.dubbo.rpc.model.FrameworkModel;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfSystemProperty;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** 仅访问root本轮启动的回环Redis；未指定端口时不读取任何公司配置或默认Redis。 */
@EnabledIfSystemProperty(named = "task32.redis.port", matches = "[0-9]+")
class ConnectionMetadataReportRedisTest {
    private static final String SERVICE = "com.example.OrderService";
    private final List<MetadataReport> reports = new ArrayList<>();
    private final List<MetadataReportFactory> factories = new ArrayList<>();
    private final List<ApplicationModel> models = new ArrayList<>();
    private final List<StatefulRedisConnection<String, String>> clients = new ArrayList<>();
    private final List<String> users = new ArrayList<>();
    private final CountDownLatch releaseWorker = new CountDownLatch(1);
    private final ThreadPoolExecutor notifications = new ThreadPoolExecutor(1, 1, 0, TimeUnit.MILLISECONDS,
            new ArrayBlockingQueue<>(1), new ThreadPoolExecutor.AbortPolicy());
    private RedisClient redis;
    private StatefulRedisConnection<String, String> admin;
    private int port;
    private String group;

    @BeforeEach
    void connectToDedicatedLoopbackRedis() {
        port = Integer.parseInt(System.getProperty("task32.redis.port"));
        assertThat(port).isBetween(1, 65535);
        redis = RedisClient.create(RedisURI.Builder.redis("127.0.0.1", port).withTimeout(Duration.ofSeconds(2)).build());
        admin = redis.connect();
        group = "task32-" + UUID.randomUUID();
        assertThat(admin.sync().ping()).isEqualTo("PONG");
    }

    @AfterEach
    void closeOwnedClientsAndExecutors() throws Exception {
        releaseWorker.countDown();
        try {
            for (MetadataReport report : reports) report.destroy();
            for (MetadataReportFactory factory : factories) factory.destroy();
            for (ApplicationModel model : models) model.destroy();
            if (admin != null && !users.isEmpty()) admin.sync().aclDeluser(users.toArray(String[]::new));
        } finally {
            notifications.shutdownNow();
            notifications.awaitTermination(5, TimeUnit.SECONDS);
            for (StatefulRedisConnection<String, String> connection : clients) connection.close();
            if (admin != null) admin.close();
            if (redis != null) redis.shutdown();
        }
    }

    @Test
    void applicationScopedFactoriesKeepSameAddressDifferentDatabasesIsolatedAndCloseIndependently() throws Exception {
        StatefulRedisConnection<String, String> firstDb = client(11);
        StatefulRedisConnection<String, String> secondDb = client(12);
        MetadataIdentifier definition = new MetadataIdentifier(SERVICE, "v1", "orders", "provider", group);
        SubscriberMetadataIdentifier runtime = new SubscriberMetadataIdentifier(group, "revision-1");
        firstDb.sync().set(definition.getUniqueKey(KeyTypeEnum.UNIQUE_KEY), "definition-db-11");
        secondDb.sync().set(definition.getUniqueKey(KeyTypeEnum.UNIQUE_KEY), "definition-db-12");
        firstDb.sync().hset(mappingKey(), SERVICE, "provider-db-11");
        secondDb.sync().hset(mappingKey(), SERVICE, "provider-db-12");
        firstDb.sync().set(runtime.getUniqueKey(KeyTypeEnum.UNIQUE_KEY), "{\"app\":\"provider-db-11\",\"revision\":\"revision-1\",\"services\":{}}");
        secondDb.sync().set(runtime.getUniqueKey(KeyTypeEnum.UNIQUE_KEY), "{\"app\":\"provider-db-12\",\"revision\":\"revision-1\",\"services\":{}}");
        long baseline = clientCount();
        ApplicationModel firstModel = model();
        ApplicationModel secondModel = model();
        MetadataReportFactory firstFactory = firstModel.getExtensionLoader(MetadataReportFactory.class).getExtension("open-platform-redis");
        MetadataReportFactory secondFactory = secondModel.getExtensionLoader(MetadataReportFactory.class).getExtension("open-platform-redis");
        factories.add(firstFactory); factories.add(secondFactory);
        assertThat(firstFactory).isNotSameAs(secondFactory);
        MetadataReport first = firstFactory.getMetadataReport(url(11).setScopeModel(firstModel));
        MetadataReport second = secondFactory.getMetadataReport(url(12).setScopeModel(secondModel));
        assertThat(first).isNotSameAs(second);
        assertThat(first.getServiceDefinition(definition)).isEqualTo("definition-db-11");
        assertThat(second.getServiceDefinition(definition)).isEqualTo("definition-db-12");
        assertThat(first.getAppMetadata(runtime, java.util.Map.of()).getApp()).isEqualTo("provider-db-11");
        assertThat(second.getAppMetadata(runtime, java.util.Map.of()).getApp()).isEqualTo("provider-db-12");
        AtomicReference<Set<String>> firstEvent = new AtomicReference<>();
        AtomicReference<Set<String>> secondEvent = new AtomicReference<>();
        first.getServiceAppMapping(SERVICE, listener(firstEvent::set), null);
        second.getServiceAppMapping(SERVICE, listener(secondEvent::set), null);
        firstDb.sync().hset(mappingKey(), SERVICE, "new-db-11");
        // Redis PubSub跨DB广播；每个report仍只能从自己的DB读取，不使用消息正文作为映射值。
        firstDb.sync().publish(mappingChannel(), SERVICE);
        await(() -> Set.of("new-db-11").equals(firstEvent.get()) && Set.of("provider-db-12").equals(secondEvent.get()));
        firstFactory.destroy();
        assertThatThrownBy(() -> first.getServiceAppMapping(SERVICE, null)).isInstanceOf(IllegalStateException.class);
        assertThat(second.getServiceDefinition(definition)).isEqualTo("definition-db-12");
        secondFactory.destroy();
        await(() -> clientCount() == baseline);
    }

    @Test
    void pubSubStormDoesNotReadBeforeBoundedExecutorCapacityAndEventuallyDeliversLatestMapping() throws Exception {
        CountDownLatch workerHeld = new CountDownLatch(1);
        notifications.execute(() -> {
            workerHeld.countDown();
            try { releaseWorker.await(10, TimeUnit.SECONDS); }
            catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); }
        });
        assertThat(workerHeld.await(2, TimeUnit.SECONDS)).isTrue();
        notifications.execute(() -> { /* 占满唯一队列，验证拒绝后仍合并重试。 */ });
        StatefulRedisConnection<String, String> writer = client(11);
        writer.sync().hset(mappingKey(), SERVICE, "before");
        ConnectionMetadataReport report = report(11);
        AtomicReference<Set<String>> received = new AtomicReference<>();
        report.getServiceAppMapping(SERVICE, listener(received::set), null);
        long readsBefore = mappingReadCount();
        writer.sync().hset(mappingKey(), SERVICE, "latest");
        for (int event = 0; event < 1000; event++) writer.sync().publish(mappingChannel(), SERVICE);
        // 容量仍为零，等待真实PubSub客户端处理事件；此时不应有HGET/HMGET发出。
        Thread.sleep(300);
        assertThat(mappingReadCount() - readsBefore).as("背压必须位于Redis读取前").isZero();
        releaseWorker.countDown();
        await(() -> Set.of("latest").equals(received.get()));
        assertThat(mappingReadCount() - readsBefore).as("同一接口事件合并，不能逐事件读Redis").isLessThanOrEqualTo(3);
    }

    @Test
    void listenerRemovalAndDestroyStopRefreshesAndReleaseAllNativeConnections() throws Exception {
        StatefulRedisConnection<String, String> writer = client(11);
        long baseline = clientCount();
        ConnectionMetadataReport report = report(11);
        AtomicInteger callbacks = new AtomicInteger();
        MappingListener listener = listener(applications -> callbacks.incrementAndGet());
        writer.sync().hset(mappingKey(), SERVICE, "provider");
        report.getServiceAppMapping(SERVICE, listener, null);
        await(() -> callbacks.get() > 0);
        report.removeServiceAppMappingListener(SERVICE, listener);
        int afterRemoval = callbacks.get();
        for (int event = 0; event < 20; event++) writer.sync().publish(mappingChannel(), SERVICE);
        Thread.sleep(150);
        assertThat(callbacks.get()).isEqualTo(afterRemoval);
        report.destroy();
        report.destroy();
        await(() -> clientCount() == baseline);
        assertThatThrownBy(() -> report.getServiceAppMapping(SERVICE, null)).isInstanceOf(IllegalStateException.class).hasMessage("元数据连接已关闭");
    }

    @Test
    void realAclFailuresRemainSanitizedAndEveryMutationApiIsRejected() {
        String username = "task32-" + UUID.randomUUID();
        String password = "test-only-private-password";
        users.add(username);
        admin.sync().aclSetuser(username, new AclSetuserArgs().on().addPassword(password).allKeys().allChannels()
                .allCommands().removeCommand(CommandType.HGET).removeCommand(CommandType.HMGET));
        URL aclUrl = url(11).setUsername(username).setPassword(password);
        ConnectionMetadataReport report = new ConnectionMetadataReport(aclUrl, notifications);
        reports.add(report);
        assertThatThrownBy(() -> report.getServiceAppMapping(SERVICE, null)).isInstanceOf(IllegalStateException.class)
                .hasMessage("元数据读取失败，请核对网络、权限与中心配置").hasNoCause();
        long clientsBeforeFailure = clientCount();
        assertThatThrownBy(() -> new ConnectionMetadataReport(aclUrl.setPassword("wrong-private-password"), notifications))
                .isInstanceOf(IllegalStateException.class).hasMessage("元数据中心初始化失败，请核对中心地址与账号配置").hasNoCause();
        assertThat(clientCount()).isEqualTo(clientsBeforeFailure);
        MetadataIdentifier definition = new MetadataIdentifier(SERVICE, "v1", "orders", "provider", group);
        SubscriberMetadataIdentifier metadata = new SubscriberMetadataIdentifier(group, "revision-1");
        List<Runnable> forbiddenWrites = List.of(
                () -> report.storeProviderMetadata(definition, new ServiceDefinition()),
                () -> report.storeConsumerMetadata(definition, java.util.Map.of("key", "value")),
                () -> report.publishAppMetadata(metadata, new MetadataInfo(group)),
                () -> report.unPublishAppMetadata(metadata, new MetadataInfo(group)),
                () -> report.registerServiceAppMapping(SERVICE, group, url(11)),
                () -> report.registerServiceAppMapping(SERVICE, "mapping", "content", null),
                () -> report.saveServiceMetadata(null, url(11)),
                () -> report.removeServiceMetadata(null),
                () -> report.saveSubscribedData(metadata, Set.of("dubbo://127.0.0.1:20880")));
        for (Runnable mutation : forbiddenWrites) assertThatThrownBy(mutation::run).isInstanceOf(UnsupportedOperationException.class);
    }

    @Test
    void failedInitialMappingReadRollsBackTheListenerAndItsSubscription() throws Exception {
        String username = "task32-" + UUID.randomUUID();
        users.add(username);
        admin.sync().aclSetuser(username, new AclSetuserArgs().on().addPassword("test-registration-password")
                .allKeys().allChannels().allCommands().removeCommand(CommandType.HGET).removeCommand(CommandType.HMGET));
        ConnectionMetadataReport report = new ConnectionMetadataReport(url(11).setUsername(username)
                .setPassword("test-registration-password"), notifications);
        reports.add(report);
        long clientsBeforeRegistration = clientCount();
        AtomicInteger callbacks = new AtomicInteger();
        MappingListener listener = listener(applications -> callbacks.incrementAndGet());
        assertThatThrownBy(() -> report.getServiceAppMapping(SERVICE, listener, null))
                .isInstanceOf(IllegalStateException.class).hasMessage("元数据读取失败，请核对网络、权限与中心配置");
        await(() -> clientCount() == clientsBeforeRegistration);
        admin.sync().aclSetuser(username, new AclSetuserArgs().addCommand(CommandType.HGET).addCommand(CommandType.HMGET));
        StatefulRedisConnection<String, String> writer = client(11);
        writer.sync().hset(mappingKey(), SERVICE, "after-acl-recovery");
        writer.sync().publish(mappingChannel(), SERVICE);
        Thread.sleep(150);
        assertThat(callbacks.get()).as("失败注册的监听不能在ACL恢复后继续收到事件").isZero();
        assertThat(report.getServiceAppMapping(SERVICE, null)).containsExactly("after-acl-recovery");
    }

    @Test
    void aFailedMappingRefreshRetriesAfterAclRecoveryWithoutAnotherEvent() throws Exception {
        String username = "task32-" + UUID.randomUUID();
        users.add(username);
        admin.sync().aclSetuser(username, new AclSetuserArgs().on().addPassword("test-retry-password")
                .allKeys().allChannels().allCommands());
        StatefulRedisConnection<String, String> writer = client(11);
        writer.sync().hset(mappingKey(), SERVICE, "before-failure");
        ConnectionMetadataReport report = new ConnectionMetadataReport(url(11).setUsername(username)
                .setPassword("test-retry-password"), notifications);
        reports.add(report);
        AtomicReference<Set<String>> received = new AtomicReference<>();
        report.getServiceAppMapping(SERVICE, listener(received::set), null);
        await(() -> Set.of("before-failure").equals(received.get()));
        admin.sync().aclSetuser(username, new AclSetuserArgs().removeCommand(CommandType.HMGET));
        long failuresBefore = permissionFailureCount();
        writer.sync().hset(mappingKey(), SERVICE, "after-recovery");
        writer.sync().publish(mappingChannel(), SERVICE);
        await(() -> permissionFailureCount() > failuresBefore);
        admin.sync().aclSetuser(username, new AclSetuserArgs().addCommand(CommandType.HMGET));
        // 没有断开PubSub，也不再发布事件；失败批次必须自行受控补读。
        await(() -> Set.of("after-recovery").equals(received.get()));
    }

    private StatefulRedisConnection<String, String> client(int database) {
        StatefulRedisConnection<String, String> connection = redis.connect();
        connection.sync().select(database);
        clients.add(connection);
        return connection;
    }

    private ApplicationModel model() {
        ApplicationModel model = FrameworkModel.defaultModel().newApplication();
        model.setAttribute("open-platform.metadata-executor", notifications);
        models.add(model);
        return model;
    }

    private ConnectionMetadataReport report(int database) {
        ConnectionMetadataReport report = new ConnectionMetadataReport(url(database), notifications);
        reports.add(report);
        return report;
    }

    private URL url(int database) {
        return URL.valueOf("open-platform-redis://127.0.0.1:" + port).addParameter("database", database)
                .addParameter("group", group).addParameter("timeout", 1000);
    }

    private String mappingKey() { return group + ":" + ServiceNameMapping.DEFAULT_MAPPING_GROUP; }
    private String mappingChannel() { return mappingKey() + ":queues"; }
    private long clientCount() { return admin.sync().clientList().lines().count(); }

    private long mappingReadCount() {
        String stats = admin.sync().info("commandstats");
        Matcher counts = Pattern.compile("(?m)^cmdstat_hm?get:calls=([0-9]+),").matcher(stats);
        long total = 0;
        while (counts.find()) total += Long.parseLong(counts.group(1));
        return total;
    }

    private long permissionFailureCount() {
        Matcher count = Pattern.compile("(?m)^errorstat_NOPERM:count=([0-9]+)").matcher(admin.sync().info("errorstats"));
        return count.find() ? Long.parseLong(count.group(1)) : 0;
    }

    private static MappingListener listener(Consumer<Set<String>> callback) {
        return new MappingListener() {
            @Override public void onEvent(MappingChangedEvent event) { callback.accept(event.getApps()); }
            @Override public void stop() { }
        };
    }

    private static void await(BooleanSupplier condition) throws InterruptedException {
        long deadline = System.nanoTime() + Duration.ofSeconds(5).toNanos();
        while (!condition.getAsBoolean() && System.nanoTime() < deadline) Thread.sleep(25);
        assertThat(condition.getAsBoolean()).isTrue();
    }
}
