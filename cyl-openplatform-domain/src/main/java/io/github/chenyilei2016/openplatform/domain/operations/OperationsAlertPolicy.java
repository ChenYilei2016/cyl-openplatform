package io.github.chenyilei2016.openplatform.domain.operations;

import java.math.BigDecimal;
import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;

public record OperationsAlertPolicy(long version, int windowMinutes, long minRequests,
        boolean failureEnabled, BigDecimal failureRateThreshold,
        boolean latencyEnabled, long averageLatencyThresholdMillis) {
    public OperationsAlertPolicy {
        if (version < 0 || version > 9007199254740991L || (windowMinutes != 5 && windowMinutes != 15 && windowMinutes != 60)
                || minRequests < 1 || minRequests > 1000000 || failureRateThreshold == null
                || failureRateThreshold.signum() < 0 || failureRateThreshold.compareTo(BigDecimal.valueOf(100)) > 0
                || failureRateThreshold.stripTrailingZeros().scale() > 2
                || averageLatencyThresholdMillis < 1 || averageLatencyThresholdMillis > 300000) {
            throw new PlatformException(ErrorCode.INVALID_REQUEST, "告警策略字段或数值范围不合法");
        }
    }
}
