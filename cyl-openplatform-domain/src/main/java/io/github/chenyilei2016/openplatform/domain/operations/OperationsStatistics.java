package io.github.chenyilei2016.openplatform.domain.operations;

import io.github.chenyilei2016.openplatform.domain.observability.CallMode;
import java.time.Instant;
import java.util.List;

/** 仅已成功持久化的调用，升级前历史未回填；时间采用UTC，不作为计费账单。 */
public record OperationsStatistics(Instant from, Instant to, CallMode mode, StatisticsBucket bucket,
                                   int retentionDays, OperationsTotals summary, List<BucketPoint> points,
                                   StatisticsDimension dimension, StatisticsSort sort, int top,
                                   Instant identityCoverageStart, List<StatisticsRank> rankings) {}
