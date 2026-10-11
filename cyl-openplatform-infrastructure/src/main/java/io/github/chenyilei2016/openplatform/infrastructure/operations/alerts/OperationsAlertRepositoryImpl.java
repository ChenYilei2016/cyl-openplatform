package io.github.chenyilei2016.openplatform.infrastructure.operations.alerts;

import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.github.chenyilei2016.openplatform.domain.common.PageResult;
import io.github.chenyilei2016.openplatform.domain.operations.*;
import io.github.chenyilei2016.openplatform.infrastructure.operations.alerts.dal.dataobject.AlertPolicyDO;
import io.github.chenyilei2016.openplatform.infrastructure.operations.alerts.dal.mapper.OperationsAlertMapper;
import java.time.Instant;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

@Repository
@RequiredArgsConstructor
public class OperationsAlertRepositoryImpl implements OperationsAlertRepository {
    private final OperationsAlertMapper mapper;
    public OperationsAlertPolicy policy(boolean lock) {
        var row = lock ? mapper.lockPolicy() : mapper.selectById("platform");
        if (row == null) throw new PlatformException(ErrorCode.DEPENDENCY_UNAVAILABLE, "告警策略未初始化，请执行数据库迁移");
        return new OperationsAlertPolicy(row.getVersion(), row.getWindowMinutes(), row.getMinRequests(), row.getFailureEnabled(),
                row.getFailureRateThreshold(), row.getLatencyEnabled(), row.getAverageLatencyThresholdMillis());
    }
    public void savePolicy(OperationsAlertPolicy policy) {
        var row = new AlertPolicyDO(); row.setId("platform"); row.setVersion(policy.version());
        row.setWindowMinutes(policy.windowMinutes()); row.setMinRequests(policy.minRequests());
        row.setFailureEnabled(policy.failureEnabled()); row.setFailureRateThreshold(policy.failureRateThreshold());
        row.setLatencyEnabled(policy.latencyEnabled()); row.setAverageLatencyThresholdMillis(policy.averageLatencyThresholdMillis());
        mapper.updateById(row);
    }
    public Instant currentTime() { return Instant.ofEpochSecond(mapper.currentEpochSecond()); }
    public List<AlertState> states() { return mapper.states(); }
    public void saveEvaluation(List<AlertState> states, List<AlertEvent> events) {
        mapper.saveStates(states);
        if (!events.isEmpty()) mapper.insertEvents(events);
    }
    public PageResult<AlertEvent> events(int page, int pageSize) {
        return new PageResult<>(mapper.events((long) (page - 1) * pageSize, pageSize), mapper.eventCount(), page, pageSize);
    }
    @Transactional
    public int deleteExpired(Instant before, int batchSize) {
        var ids = mapper.expiredIds(before, batchSize);
        if (!ids.isEmpty()) mapper.deleteEvents(ids);
        return ids.size();
    }
}
