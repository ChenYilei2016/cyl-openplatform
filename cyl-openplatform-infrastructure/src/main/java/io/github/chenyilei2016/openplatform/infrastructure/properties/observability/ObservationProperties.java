package io.github.chenyilei2016.openplatform.infrastructure.properties.observability;

import io.github.chenyilei2016.openplatform.application.observability.ObservationSettings;

import lombok.Getter;
import org.springframework.boot.context.properties.ConfigurationProperties;

@Getter
@ConfigurationProperties("open-platform.observability")
public class ObservationProperties implements ObservationSettings {
    @lombok.Setter
    private boolean responseLogEnabled = true;
    private int responseLogMaxBytes = 2048;
    public void setResponseLogMaxBytes(int bytes) {
        if (bytes < 256 || bytes > 16384) throw new IllegalArgumentException("响应日志摘要需在256至16384字节内");
        responseLogMaxBytes = bytes;
    }

    private int retentionDays = 30;
    private int cleanupBatchSize = 1000;

    public void setRetentionDays(int retentionDays) {
        if (retentionDays < 1 || retentionDays > 3650) throw new IllegalArgumentException("调用记录保留期需在1至3650天内");
        this.retentionDays = retentionDays;
    }

    public void setCleanupBatchSize(int cleanupBatchSize) {
        if (cleanupBatchSize < 1 || cleanupBatchSize > 1000) throw new IllegalArgumentException("调用记录单轮清理需在1至1000条内");
        this.cleanupBatchSize = cleanupBatchSize;
    }
}
