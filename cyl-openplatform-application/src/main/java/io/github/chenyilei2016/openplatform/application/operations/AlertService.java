package io.github.chenyilei2016.openplatform.application.operations;

import io.github.chenyilei2016.openplatform.domain.common.ObjectIdType;
import io.github.chenyilei2016.openplatform.application.access.AccessAuditService;
import io.github.chenyilei2016.openplatform.domain.access.AccessOperator;
import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.github.chenyilei2016.openplatform.domain.common.PageResult;
import io.github.chenyilei2016.openplatform.domain.observability.CallMode;
import io.github.chenyilei2016.openplatform.domain.operations.*;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class AlertService {
    private final OperationsAlertRepository alerts;
    private final OperationsMetricsRepository metrics;
    private final AccessAuditService audits;

    public OperationsAlertPolicy policy() { return alerts.policy(false); }

    public OperationsAlertPolicy update(OperationsAlertPolicy replacement, long expectedVersion, AccessOperator operator) {
        return audits.change("UPDATE_OPERATIONS_ALERT_POLICY", null, null, "platform", operator, () -> {
            var current = alerts.policy(true);
            if (current.version() != expectedVersion) throw new PlatformException(ErrorCode.CONFLICT, "告警策略已变更，请重新读取后再保存");
            alerts.savePolicy(replacement);
            return replacement;
        });
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public AlertOverview overview() {
        var policy = alerts.policy(false);
        var states = alerts.states();
        Instant before = alerts.currentTime().minus(3, ChronoUnit.MINUTES);
        boolean stale = states.size() != AlertMetric.values().length || states.stream()
                .anyMatch(state -> state.policyVersion() != policy.version() || state.evaluatedAt().isBefore(before));
        return new AlertOverview(policy, states, stale);
    }

    @Transactional(timeout = 10)
    public AlertOverview evaluate() {
        var policy = alerts.policy(true);
        Instant now = alerts.currentTime();
        Instant end = now.minus(1, ChronoUnit.MINUTES).truncatedTo(ChronoUnit.MINUTES);
        var previous = alerts.states();
        if (previous.size() == AlertMetric.values().length && previous.stream()
                .allMatch(state -> state.policyVersion() == policy.version() && !state.windowEnd().isBefore(end))) {
            return new AlertOverview(policy, previous, false);
        }
        Instant start = end.minus(policy.windowMinutes(), ChronoUnit.MINUTES);
        var totals = policy.failureEnabled() || policy.latencyEnabled()
                ? metrics.summary(start, end, CallMode.PRODUCTION, null, null) : OperationsTotals.empty();
        var states = new ArrayList<AlertState>(2);
        var events = new ArrayList<AlertEvent>(2);
        for (var metric : AlertMetric.values()) {
            var status = metric.status(policy, totals);
            var old = previous.stream().filter(state -> state.metric() == metric).findFirst().orElse(null);
            var state = new AlertState(metric, status, metric.value(totals), totals.requests(), start, end, policy.version(), now);
            states.add(state);
            if (old == null || old.status() != status) {
                events.add(new AlertEvent(ObjectIdType.ALERT_EVENT.nextId(), metric, old == null ? null : old.status(), status,
                        state.value(), state.sampleCount(), start, end, policy.version(), now));
            }
        }
        alerts.saveEvaluation(states, events);
        return new AlertOverview(policy, states, false);
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public PageResult<AlertEvent> events(int page, int pageSize) {
        if (page < 1 || pageSize < 1 || pageSize > 100 || (long) (page - 1) * pageSize > 100000)
            throw new PlatformException(ErrorCode.INVALID_REQUEST, "告警事件分页超出查询边界");
        return alerts.events(page, pageSize);
    }
}
