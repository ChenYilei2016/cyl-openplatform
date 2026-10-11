package io.github.chenyilei2016.openplatform.infrastructure.operations.metrics.dal.impl;

import io.github.chenyilei2016.openplatform.domain.observability.CallMode;
import io.github.chenyilei2016.openplatform.domain.operations.*;
import io.github.chenyilei2016.openplatform.infrastructure.operations.metrics.dal.mapper.CallMinuteMapper;
import java.time.Instant;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Repository;

@Repository
@RequiredArgsConstructor
public class OperationsMetricsRepositoryImpl implements OperationsMetricsRepository {
    private final CallMinuteMapper mapper;

    @Override
    public OperationsTotals summary(Instant from, Instant to, CallMode mode, String apiId, String applicationId) {
        return mapper.summary(Math.floorDiv(from.getEpochSecond(), 60), Math.floorDiv(to.getEpochSecond(), 60),
                mode, apiId, applicationId).totals();
    }

    @Override
    public List<BucketPoint> points(OperationsQuery query) {
        return mapper.analysisPoints(query, Math.floorDiv(query.from().getEpochSecond(), 60), Math.floorDiv(query.to().getEpochSecond(), 60))
                .stream().map(row -> new BucketPoint(Instant.ofEpochSecond(row.getBucketStart() * 60), row.totals())).toList();
    }

    @Override
    public OperationsTotals analysisSummary(OperationsQuery query) {
        return mapper.analysisSummary(query, Math.floorDiv(query.from().getEpochSecond(), 60), Math.floorDiv(query.to().getEpochSecond(), 60)).totals();
    }

    @Override
    public List<StatisticsRank> rankings(OperationsQuery query) {
        return mapper.rankings(query, Math.floorDiv(query.from().getEpochSecond(), 60), Math.floorDiv(query.to().getEpochSecond(), 60))
                .stream().map(io.github.chenyilei2016.openplatform.infrastructure.operations.metrics.dal.dataobject.StatisticsRankDO::rank).toList();
    }

    @Override
    public List<RuleOverview> ruleOverview(OperationsQuery query, List<String> ruleIds) {
        return mapper.ruleOverview(Math.floorDiv(query.from().getEpochSecond(),60),Math.floorDiv(query.to().getEpochSecond(),60),query.mode(),ruleIds)
                .stream().map(row -> new RuleOverview(row.getRuleId(),row.getRuleVersion(),row.totals())).toList();
    }

    @Override
    public Instant identityCoverageStart() {
        Long minute = mapper.identityCoverageStart();
        return minute == null ? null : Instant.ofEpochSecond(minute * 60);
    }

    @Override
    public io.github.chenyilei2016.openplatform.domain.common.PageResult<String> tenants(io.github.chenyilei2016.openplatform.domain.access.AccessPageQuery query, String id) {
        String pattern = query.query() == null || query.query().isEmpty() ? null : io.github.chenyilei2016.openplatform.infrastructure.common.SqlPatterns.contains(query.query());
        return new io.github.chenyilei2016.openplatform.domain.common.PageResult<>(mapper.tenantIds(pattern, id, (long)(query.page()-1)*query.pageSize(), query.pageSize()),
                mapper.tenantCount(pattern,id), query.page(),query.pageSize());
    }

    @Override
    public int deleteExpired(Instant before, int batchSize) {
        if (batchSize < 1 || batchSize > 1000) throw new IllegalArgumentException("聚合单轮清理需在1至1000条内");
        long minute = Math.floorDiv(before.getEpochSecond(), 60);
        int deleted = mapper.deleteExpired(minute, batchSize);
        return deleted == batchSize ? deleted : deleted + mapper.deleteExpiredRules(minute, batchSize - deleted);
    }
}
