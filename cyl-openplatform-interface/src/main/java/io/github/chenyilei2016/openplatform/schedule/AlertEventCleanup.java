package io.github.chenyilei2016.openplatform.schedule;

import io.github.chenyilei2016.openplatform.domain.operations.OperationsAlertRepository;
import io.github.chenyilei2016.openplatform.application.operations.OperationsSettings;
import java.time.temporal.ChronoUnit;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Slf4j
@Component
@ConditionalOnProperty(name = "open-platform.operations.cleanup-enabled", havingValue = "true", matchIfMissing = true)
@RequiredArgsConstructor
public class AlertEventCleanup {
    private final OperationsAlertRepository alerts;
    private final OperationsSettings properties;

    @Scheduled(initialDelayString = "PT1M", fixedDelayString = "PT1M")
    public void cleanExpired() {
        try {
            alerts.deleteExpired(alerts.currentTime().minus(properties.getRetentionDays(), ChronoUnit.DAYS), 1000);
        } catch (RuntimeException failure) {
            log.error("告警事件定期清理失败", failure);
        }
    }
}
