package io.github.chenyilei2016.openplatform.infrastructure.operations.alerts.dal.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import io.github.chenyilei2016.openplatform.infrastructure.operations.alerts.dal.dataobject.AlertPolicyDO;
import io.github.chenyilei2016.openplatform.domain.operations.AlertState;
import io.github.chenyilei2016.openplatform.domain.operations.AlertEvent;
import java.time.Instant;
import java.util.List;
import org.apache.ibatis.annotations.*;

@Mapper
public interface OperationsAlertMapper extends BaseMapper<AlertPolicyDO> {
    @Select("SELECT * FROM platform_alert_policy WHERE id='platform' FOR UPDATE")
    AlertPolicyDO lockPolicy();
    @Select("SELECT UNIX_TIMESTAMP()")
    long currentEpochSecond();
    @Select("SELECT metric,status,metric_value AS `value`,sample_count,window_start,window_end,policy_version,evaluated_at FROM platform_alert_state ORDER BY CASE WHEN metric='FAILURE_RATE' THEN 0 ELSE 1 END")
    List<AlertState> states();
    void saveStates(@Param("states") List<AlertState> states);
    void insertEvents(@Param("events") List<AlertEvent> events);
    @Select("SELECT COUNT(*) FROM platform_alert_event")
    long eventCount();
    @Select("SELECT id,metric,previous_status,status,metric_value AS `value`,sample_count,window_start,window_end,policy_version,occurred_at FROM platform_alert_event ORDER BY occurred_at DESC,id DESC LIMIT #{size} OFFSET #{offset}")
    List<AlertEvent> events(@Param("offset") long offset, @Param("size") int size);
    @Select("SELECT id FROM platform_alert_event WHERE occurred_at < #{before} ORDER BY occurred_at,id LIMIT #{size}")
    List<String> expiredIds(@Param("before") Instant before, @Param("size") int size);
    void deleteEvents(@Param("ids") List<String> ids);
}
