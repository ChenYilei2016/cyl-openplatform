package io.github.chenyilei2016.openplatform.application.operations;

import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.github.chenyilei2016.openplatform.domain.operations.*;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.time.Instant;
import io.github.chenyilei2016.openplatform.domain.access.EmployeeProfileRepository;
import java.util.concurrent.Semaphore;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

/** 有界查询在同一只读RR快照中取总量及分桶，最多补零1440项。 */
@Service
public class OperationsStatisticsService {
    private final OperationsMetricsRepository metrics;
    private final EmployeeProfileRepository profiles;
    private final int retentionDays;
    private final TransactionTemplate snapshot;
    private final Semaphore queries = new Semaphore(4);

    public OperationsStatisticsService(OperationsMetricsRepository metrics, PlatformTransactionManager transactions,
                                       OperationsSettings settings, EmployeeProfileRepository profiles) {
        this.metrics = metrics;
        this.profiles = profiles;
        this.retentionDays = settings.getRetentionDays();
        snapshot = new TransactionTemplate(transactions);
        snapshot.setReadOnly(true);
        snapshot.setIsolationLevel(TransactionDefinition.ISOLATION_REPEATABLE_READ);
        snapshot.setTimeout(3);
    }

    public List<RuleOverview> ruleOverview(OperationsQuery query, List<String> ruleIds) {
        if (ruleIds == null || ruleIds.isEmpty() || ruleIds.size() > 100 || ruleIds.stream().anyMatch(id -> id == null || !id.matches("[A-Za-z0-9:_-]{1,240}")))
            throw new PlatformException(ErrorCode.INVALID_REQUEST,"规则概况每次需1至100个有效规则ID");
        if (!queries.tryAcquire()) throw new PlatformException(ErrorCode.RATE_LIMITED,"统计查询繁忙，请稍后重试");
        try { return snapshot.execute(status -> metrics.ruleOverview(query,ruleIds.stream().distinct().toList())); }
        finally { queries.release(); }
    }

    public OperationsStatistics statistics(OperationsQuery query) {
        if (!queries.tryAcquire()) throw new PlatformException(ErrorCode.RATE_LIMITED, "统计查询繁忙，请稍后重试");
        try {
            return snapshot.execute(status -> {
                OperationsTotals totals = query.tenantId() == null && query.employeeId() == null && query.identityKind() == null && query.ruleId() == null
                        ? metrics.summary(query.from(), query.to(), query.mode(), query.apiId(), query.applicationId()) : metrics.analysisSummary(query);
                Map<Instant, OperationsTotals> populated = metrics.points(query).stream()
                        .collect(Collectors.toMap(BucketPoint::bucketStart, BucketPoint::totals));
                List<BucketPoint> points = new ArrayList<BucketPoint>();
                long last = query.bucket().index(query.to().minusNanos(1));
                for (long index = query.bucket().index(query.from()); index <= last; index++) {
                    Instant time = query.bucket().start(index);
                    points.add(new BucketPoint(time, populated.getOrDefault(time, OperationsTotals.empty())));
                }
                List<StatisticsRank> ranking = metrics.rankings(query);
                Map<String,String> tenants = profiles.tenantNames(ranking.stream().map(StatisticsRank::tenantId)
                        .filter(id -> id != null && !id.isBlank()).distinct().toList());
                ranking = ranking.stream().map(row -> new StatisticsRank(row.tenantId(), row.employeeId(), row.identityKind(), row.apiId(),
                        row.name(), row.employeeNo(), row.tenantName() == null ? tenants.get(row.tenantId()) : row.tenantName(), row.totals())).toList();
                return new OperationsStatistics(query.from(), query.to(), query.mode(), query.bucket(),
                        retentionDays, totals, points, query.dimension(), query.sort(), query.top(), metrics.identityCoverageStart(), ranking);
            });
        } finally {
            queries.release();
        }
    }
}
