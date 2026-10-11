package io.github.chenyilei2016.openplatform.domain.operations;

import java.math.BigDecimal;
import java.math.RoundingMode;

/** 失败子分类允许交叉，不能再次相加；比率保留十进制精度。 */
public record OperationsTotals(long requests, long successes, long clientErrors, long serverErrors,
                               long authRejected, long rateLimited, long slowCalls, long unattributed,
                               long durationSum, long maxDuration, long governanceRejected, long observedRequests, long ruleHits,
                               long ipDenied, long tokenBucketRejected, long dailyQuotaRejected, String successRate, String averageLatencyMillis) {
    public static OperationsTotals of(long requests, long successes, long clientErrors, long serverErrors,
                                      long authRejected, long rateLimited, long slowCalls, long unattributed,
                                      long durationSum, long maxDuration) {
        return of(requests, successes, clientErrors, serverErrors, authRejected, rateLimited, slowCalls,
                unattributed, durationSum, maxDuration, 0, 0, 0, 0, 0, 0);
    }
    public static OperationsTotals of(long requests, long successes, long clientErrors, long serverErrors,
                                      long authRejected, long rateLimited, long slowCalls, long unattributed,
                                      long durationSum, long maxDuration, long governanceRejected, long observedRequests,
                                      long ruleHits, long ipDenied, long tokenBucketRejected, long dailyQuotaRejected) {
        return new OperationsTotals(requests, successes, clientErrors, serverErrors, authRejected,
                rateLimited, slowCalls, unattributed, durationSum, maxDuration, governanceRejected, observedRequests,
                ruleHits, ipDenied, tokenBucketRejected, dailyQuotaRejected,
                requests == 0 ? null : BigDecimal.valueOf(successes).multiply(BigDecimal.valueOf(100))
                        .divide(BigDecimal.valueOf(requests), 2, RoundingMode.HALF_UP).toPlainString(),
                requests == 0 ? null : BigDecimal.valueOf(durationSum)
                        .divide(BigDecimal.valueOf(requests), 2, RoundingMode.HALF_UP).toPlainString());
    }
    public static OperationsTotals empty() { return of(0, 0, 0, 0, 0, 0, 0, 0, 0, 0); }
}
