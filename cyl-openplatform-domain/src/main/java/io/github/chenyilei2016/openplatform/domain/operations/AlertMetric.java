package io.github.chenyilei2016.openplatform.domain.operations;

import java.math.BigDecimal;
import java.math.RoundingMode;

public enum AlertMetric {
    FAILURE_RATE {
        public boolean enabled(OperationsAlertPolicy policy) { return policy.failureEnabled(); }
        public BigDecimal numerator(OperationsTotals totals) {
            return BigDecimal.valueOf(totals.requests()).subtract(BigDecimal.valueOf(totals.successes())).multiply(BigDecimal.valueOf(100));
        }
        public BigDecimal threshold(OperationsAlertPolicy policy) { return policy.failureRateThreshold(); }
    },
    AVERAGE_LATENCY {
        public boolean enabled(OperationsAlertPolicy policy) { return policy.latencyEnabled(); }
        public BigDecimal numerator(OperationsTotals totals) { return BigDecimal.valueOf(totals.durationSum()); }
        public BigDecimal threshold(OperationsAlertPolicy policy) { return BigDecimal.valueOf(policy.averageLatencyThresholdMillis()); }
    };
    public abstract boolean enabled(OperationsAlertPolicy policy);
    public abstract BigDecimal numerator(OperationsTotals totals);
    public abstract BigDecimal threshold(OperationsAlertPolicy policy);
    public AlertStatus status(OperationsAlertPolicy policy, OperationsTotals totals) {
        if (!enabled(policy)) return AlertStatus.DISABLED;
        if (totals.requests() < policy.minRequests()) return AlertStatus.NO_DATA;
        return numerator(totals).compareTo(threshold(policy).multiply(BigDecimal.valueOf(totals.requests()))) >= 0
                ? AlertStatus.FIRING : AlertStatus.NORMAL;
    }
    public String value(OperationsTotals totals) {
        return totals.requests() == 0 ? null : numerator(totals).divide(BigDecimal.valueOf(totals.requests()), 2, RoundingMode.HALF_UP).toPlainString();
    }
}
