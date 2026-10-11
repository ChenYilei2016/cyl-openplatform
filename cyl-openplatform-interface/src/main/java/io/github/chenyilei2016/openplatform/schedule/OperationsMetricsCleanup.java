package io.github.chenyilei2016.openplatform.schedule;

import io.github.chenyilei2016.openplatform.domain.operations.OperationsMetricsRepository;
import io.github.chenyilei2016.openplatform.application.operations.OperationsSettings;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** 每节点每分钟单轮最多1000行，积压在后续轮次清理。 */
@Slf4j
@Component
@RequiredArgsConstructor
@ConditionalOnProperty(name = "open-platform.operations.cleanup-enabled", havingValue = "true", matchIfMissing = true)
public class OperationsMetricsCleanup {
    private final OperationsMetricsRepository metrics;
    private final OperationsSettings properties;

    @Scheduled(initialDelayString = "PT1M", fixedDelayString = "PT1M")
    public void cleanExpired() {
        try {
            metrics.deleteExpired(Instant.now().minus(properties.getRetentionDays(), ChronoUnit.DAYS), 1000);
        } catch (RuntimeException failure) {
            log.error("运营聚合定期清理失败", failure);
        }
    }
}
