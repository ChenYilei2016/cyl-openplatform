package io.github.chenyilei2016.openplatform.application.observability;

public interface ObservationSettings {
    int getRetentionDays();
    boolean isResponseLogEnabled();
    int getResponseLogMaxBytes();
    int getCleanupBatchSize();
}
