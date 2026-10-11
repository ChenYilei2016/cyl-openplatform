package io.github.chenyilei2016.openplatform.schedule;

import io.github.chenyilei2016.openplatform.domain.observability.CallRecordRepository;
import io.github.chenyilei2016.openplatform.application.observability.ObservationSettings;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** Spring管理单轮有界清理；不通过循环追赶积压。 */
@Slf4j
@Component
@ConditionalOnProperty(name = "open-platform.observability.cleanup-enabled", havingValue = "true", matchIfMissing = true)
@RequiredArgsConstructor
public class CallRecordCleanup {
    private final CallRecordRepository records;
    private final ObservationSettings properties;

    @Scheduled(initialDelayString = "PT1M", fixedDelayString = "PT1M")
    public void cleanExpired() {
        try {
            records.deleteExpired(Instant.now().minus(properties.getRetentionDays(), ChronoUnit.DAYS), properties.getCleanupBatchSize());
        } catch (RuntimeException failure) {
            log.error("调用记录定期清理失败", failure);
        }
    }
}
