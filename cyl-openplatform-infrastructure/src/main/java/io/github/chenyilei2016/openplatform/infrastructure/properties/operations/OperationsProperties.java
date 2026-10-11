package io.github.chenyilei2016.openplatform.infrastructure.properties.operations;

import io.github.chenyilei2016.openplatform.application.operations.OperationsSettings;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;

@Getter
@ConfigurationProperties("open-platform.operations")
public class OperationsProperties implements OperationsSettings {
    private int retentionDays = 90;
    private final Alerts alerts = new Alerts();
    public void setRetentionDays(int retentionDays) {
        if (retentionDays < 1 || retentionDays > 365) throw new IllegalArgumentException("运营数据保留期需在1至365天内");
        this.retentionDays = retentionDays;
    }
    @Override
    public boolean isEvaluationEnabled() {
        return alerts.isEvaluationEnabled();
    }

    @Getter @Setter
    public static class Alerts { private boolean evaluationEnabled = true; }
}
