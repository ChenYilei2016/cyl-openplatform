package io.github.chenyilei2016.openplatform.infrastructure.operations.metrics.dal.dataobject;

import io.github.chenyilei2016.openplatform.domain.operations.OperationsTotals;
import lombok.Data;

/** 数据库SUM投影；bucketStart仅用于分桶查询。 */
@Data
public class CallMinuteDO {
    private long bucketStart;
    private long governanceRejected;
    private long observedRequests;
    private long ruleHits;
    private long ipDenied;
    private long tokenBucketRejected;
    private long dailyQuotaRejected;
    private long requests;
    private long successes;
    private long clientErrors;
    private long serverErrors;
    private long authRejected;
    private long rateLimited;
    private long slowCalls;
    private long unattributed;
    private long durationSum;
    private long maxDuration;

    public OperationsTotals totals() {
        return OperationsTotals.of(requests, successes, clientErrors, serverErrors, authRejected,
                rateLimited, slowCalls, unattributed, durationSum, maxDuration, governanceRejected, observedRequests, ruleHits, ipDenied, tokenBucketRejected, dailyQuotaRejected);
    }
}
