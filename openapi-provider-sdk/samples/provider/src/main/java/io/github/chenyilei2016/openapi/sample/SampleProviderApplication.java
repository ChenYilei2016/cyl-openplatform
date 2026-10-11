package io.github.chenyilei2016.openapi.sample;

import io.github.chenyilei2016.openplatform.provider.*;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Bean;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

import java.util.concurrent.CompletableFuture;

/** 两种Boot组合编译同一份业务样例；生产应用仍由宿主自己的BOM决定版本。 */
@SpringBootApplication
public class SampleProviderApplication {
    public static void main(String[] args) throws Exception {
        if (args.length == 1 && args[0].startsWith("--sdk-client=")) {
            Class.forName("io.github.chenyilei2016.openapi.sample.SampleDubboClient").getMethod("verify", int.class)
                    .invoke(null, Integer.parseInt(args[0].substring("--sdk-client=".length())));
            return;
        }
        // Dubbo2.7的ProtocolConfig.host不接受IPv6字面量；原生绑定属性在两代均支持。
        System.setProperty("DUBBO_IP_TO_BIND", "::1");
        SpringApplication.run(SampleProviderApplication.class, args);
    }

    @Bean
    public ThreadPoolTaskExecutor providerExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(2);
        executor.setMaxPoolSize(2);
        executor.setQueueCapacity(16);
        executor.setThreadNamePrefix("openapi-sample-");
        executor.setWaitForTasksToCompleteOnShutdown(true);
        executor.setAwaitTerminationSeconds(5);
        return executor;
    }

    @Bean
    public SampleOperations sampleOperations(ThreadPoolTaskExecutor executor) {
        return new SampleOperations() {
            @Override
            public String identity(String input) {
                return OpenPlatformContext.requireIdentity().getTenantId();
            }

            @Override
            public String employee() {
                return OpenPlatformContext.requireIdentity().requireEmployee().getEmployeeNo();
            }

            @Override
            public CompletableFuture<String> asynchronous(String input) {
                OpenPlatformContext.Snapshot snapshot = OpenPlatformContext.snapshot();
                return CompletableFuture.supplyAsync(
                        () -> {
                            try (OpenPlatformContext.Scope ignored = snapshot.open()) {
                                return OpenPlatformContext.requireIdentity().getTenantId();
                            }
                        },
                        executor);
            }

            @Override
            public String internal() {
                return OpenPlatformContext.current().isPresent() ? "present" : "empty";
            }
        };
    }

}
