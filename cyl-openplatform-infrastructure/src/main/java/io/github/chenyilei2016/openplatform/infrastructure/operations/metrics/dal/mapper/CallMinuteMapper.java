package io.github.chenyilei2016.openplatform.infrastructure.operations.metrics.dal.mapper;

import io.github.chenyilei2016.openplatform.domain.observability.CallMode;
import io.github.chenyilei2016.openplatform.domain.observability.CallRecord;
import io.github.chenyilei2016.openplatform.infrastructure.operations.metrics.dal.dataobject.CallMinuteDO;
import io.github.chenyilei2016.openplatform.infrastructure.operations.metrics.dal.dataobject.StatisticsRankDO;
import io.github.chenyilei2016.openplatform.domain.operations.OperationsQuery;
import java.util.List;
import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Options;
import org.apache.ibatis.annotations.Param;

/** 联合主键原子累加和SQL聚合；不为BaseMapper引入虚构单列ID。 */
@Mapper
public interface CallMinuteMapper {
    void increment(@Param("record") CallRecord record, @Param("minute") long minute);
    void incrementRules(@Param("record") CallRecord record, @Param("minute") long minute);

    @Options(timeout = 3)
    CallMinuteDO summary(@Param("from") long from, @Param("to") long to, @Param("mode") CallMode mode,
                         @Param("apiId") String apiId, @Param("applicationId") String applicationId);

    @Options(timeout = 3)
    List<CallMinuteDO> points(@Param("from") long from, @Param("to") long to, @Param("mode") CallMode mode,
                             @Param("apiId") String apiId, @Param("applicationId") String applicationId,
                             @Param("minutes") int minutes);

    @Options(timeout = 3)
    CallMinuteDO analysisSummary(@Param("q") OperationsQuery query, @Param("from") long from, @Param("to") long to);

    @Options(timeout = 3)
    List<CallMinuteDO> analysisPoints(@Param("q") OperationsQuery query, @Param("from") long from, @Param("to") long to);

    @Options(timeout = 3)
    List<StatisticsRankDO> rankings(@Param("q") OperationsQuery query, @Param("from") long from, @Param("to") long to);

    @org.apache.ibatis.annotations.Select("SELECT MIN(bucket_start) FROM platform_call_minute WHERE tenant_key != ''")
    Long identityCoverageStart();

    @Options(timeout = 3)
    List<io.github.chenyilei2016.openplatform.infrastructure.operations.metrics.dal.dataobject.RuleOverviewDO> ruleOverview(
            @Param("from") long from, @Param("to") long to, @Param("mode") CallMode mode, @Param("ids") List<String> ids);

    @org.apache.ibatis.annotations.Select({"<script>SELECT DISTINCT tenant_key FROM platform_call_minute WHERE tenant_key!=''",
            "<if test='id != null'>AND tenant_key=#{id}</if><if test='pattern != null'>AND (tenant_key LIKE #{pattern} ESCAPE '!' OR EXISTS(SELECT 1 FROM access_employee_profile p WHERE p.tenant_id=tenant_key AND p.tenant_name LIKE #{pattern} ESCAPE '!'))</if>",
            "ORDER BY tenant_key LIMIT #{limit} OFFSET #{offset}</script>"})
    List<String> tenantIds(@Param("pattern") String pattern, @Param("id") String id, @Param("offset") long offset, @Param("limit") int limit);

    @org.apache.ibatis.annotations.Select({"<script>SELECT COUNT(DISTINCT tenant_key) FROM platform_call_minute WHERE tenant_key!=''",
            "<if test='id != null'>AND tenant_key=#{id}</if><if test='pattern != null'>AND (tenant_key LIKE #{pattern} ESCAPE '!' OR EXISTS(SELECT 1 FROM access_employee_profile p WHERE p.tenant_id=tenant_key AND p.tenant_name LIKE #{pattern} ESCAPE '!'))</if></script>"})
    long tenantCount(@Param("pattern") String pattern, @Param("id") String id);

    @Delete("DELETE FROM platform_call_minute WHERE bucket_start < #{before} LIMIT #{batchSize}")
    int deleteExpired(@Param("before") long before, @Param("batchSize") int batchSize);

    @Delete("DELETE FROM platform_rule_minute WHERE bucket_start < #{before} LIMIT #{batchSize}")
    int deleteExpiredRules(@Param("before") long before, @Param("batchSize") int batchSize);
}
