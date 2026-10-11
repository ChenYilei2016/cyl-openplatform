package io.github.chenyilei2016.openplatform.infrastructure.connection.runtime;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;

/** 连接准备与元数据通知使用独立有界资源，不占用业务请求线程建连。 */
@Configuration(proxyBeanMethods = false)
public class DubboConnectionRuntimeConfiguration {
    @Bean
    public ThreadPoolTaskExecutor dubboConnectionLoader() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setThreadNamePrefix("dubbo-connection-loader-");
        executor.setCorePoolSize(2);
        executor.setMaxPoolSize(2);
        executor.setQueueCapacity(16);
        executor.setAwaitTerminationSeconds(5);
        executor.setWaitForTasksToCompleteOnShutdown(false);
        executor.setStrictEarlyShutdown(true);
        return executor;
    }

    @Bean
    public ThreadPoolTaskExecutor dubboMetadataExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setThreadNamePrefix("dubbo-connection-metadata-");
        executor.setCorePoolSize(4);
        executor.setMaxPoolSize(4);
        executor.setQueueCapacity(16);
        executor.setAwaitTerminationSeconds(5);
        executor.setWaitForTasksToCompleteOnShutdown(false);
        executor.setStrictEarlyShutdown(true);
        return executor;
    }

    @Bean
    public ThreadPoolTaskExecutor dubboConnectionDiagnostics() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setThreadNamePrefix("dubbo-connection-diagnostics-");
        executor.setCorePoolSize(2);
        executor.setMaxPoolSize(2);
        executor.setQueueCapacity(0);
        executor.setAwaitTerminationSeconds(5);
        executor.setWaitForTasksToCompleteOnShutdown(false);
        executor.setStrictEarlyShutdown(true);
        return executor;
    }

    @Bean
    public ThreadPoolTaskScheduler dubboConnectionScheduler() {
        ThreadPoolTaskScheduler scheduler = new ThreadPoolTaskScheduler();
        scheduler.setThreadNamePrefix("dubbo-connection-refresh-");
        scheduler.setPoolSize(1);
        scheduler.setRemoveOnCancelPolicy(true);
        scheduler.setAwaitTerminationSeconds(5);
        scheduler.setWaitForTasksToCompleteOnShutdown(false);
        scheduler.setContinueExistingPeriodicTasksAfterShutdownPolicy(false);
        scheduler.setExecuteExistingDelayedTasksAfterShutdownPolicy(false);
        return scheduler;
    }
}
