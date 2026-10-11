package io.github.chenyilei2016.openplatform.domain.observability;

import io.github.chenyilei2016.openplatform.domain.common.PageResult;
import java.time.Instant;
import java.util.Collection;
import java.util.Map;

public interface CallRecordRepository {
    void append(CallRecord record);
    PageResult<CallRecord> page(ObservationQuery query);
    int deleteExpired(Instant before, int batchSize);
    /** 批量读取凭据最近一次正式调用时间（最多100个，一次查询）；保留期内无记录的凭据不出现在结果中。 */
    Map<String, Instant> latestProductionCalls(Collection<String> applicationIds);
}
