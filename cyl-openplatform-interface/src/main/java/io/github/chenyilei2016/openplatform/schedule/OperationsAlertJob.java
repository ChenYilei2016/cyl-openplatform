package io.github.chenyilei2016.openplatform.schedule;

import io.github.chenyilei2016.openplatform.application.operations.AlertService;
import io.github.chenyilei2016.openplatform.application.operations.OperationsSettings;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** 平台统一装配应用评估与配置；单轮有界，不追赶或发送外部通知。 */
@Slf4j
@Component
public class OperationsAlertJob {
    private final AlertService service;
    private final OperationsSettings properties;

    public OperationsAlertJob(AlertService service, OperationsSettings properties) {
        this.service = service;
        this.properties = properties;
    }

    @Scheduled(initialDelayString = "PT1M", fixedDelayString = "PT1M")
    public void evaluate() {
        if (!properties.isEvaluationEnabled()) return;
        try {
            service.evaluate();
        } catch (RuntimeException failure) {
            log.error("站内告警评估失败，保留上次状态", failure);
        }
    }
}
