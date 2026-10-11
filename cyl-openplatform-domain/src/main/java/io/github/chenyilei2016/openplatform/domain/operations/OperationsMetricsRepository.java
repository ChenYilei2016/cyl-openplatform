package io.github.chenyilei2016.openplatform.domain.operations;

import io.github.chenyilei2016.openplatform.domain.observability.CallMode;
import java.time.Instant;
import java.util.List;

public interface OperationsMetricsRepository {
    OperationsTotals summary(Instant from, Instant to, CallMode mode, String apiId, String applicationId);
    List<BucketPoint> points(OperationsQuery query);
    OperationsTotals analysisSummary(OperationsQuery query);
    List<StatisticsRank> rankings(OperationsQuery query);
    Instant identityCoverageStart();
    List<RuleOverview> ruleOverview(OperationsQuery query, List<String> ruleIds);
    io.github.chenyilei2016.openplatform.domain.common.PageResult<String> tenants(io.github.chenyilei2016.openplatform.domain.access.AccessPageQuery query, String id);
    int deleteExpired(Instant before, int batchSize);
}
