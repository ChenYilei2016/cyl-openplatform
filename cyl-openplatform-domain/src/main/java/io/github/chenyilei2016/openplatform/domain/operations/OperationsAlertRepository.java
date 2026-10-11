package io.github.chenyilei2016.openplatform.domain.operations;

import java.time.Instant;
import java.util.List;
import io.github.chenyilei2016.openplatform.domain.common.PageResult;
public interface OperationsAlertRepository {
    OperationsAlertPolicy policy(boolean lock);
    void savePolicy(OperationsAlertPolicy policy);
    Instant currentTime();
    List<AlertState> states();
    void saveEvaluation(List<AlertState> states, List<AlertEvent> events);
    PageResult<AlertEvent> events(int page, int pageSize);
    int deleteExpired(Instant before, int batchSize);
}
