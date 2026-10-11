package io.github.chenyilei2016.openplatform.infrastructure.observability.dal.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import io.github.chenyilei2016.openplatform.infrastructure.observability.dal.dataobject.ApplicationLatestCallDO;
import io.github.chenyilei2016.openplatform.infrastructure.observability.dal.dataobject.CallRecordDO;
import java.time.Instant;
import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

@Mapper
public interface CallRecordMapper extends BaseMapper<CallRecordDO> {
    @org.apache.ibatis.annotations.Insert({"<script>INSERT INTO platform_call_rule_record(record_id,rule_id,rule_version,rule_mode,reason) VALUES",
            "<foreach collection='hits' item='hit' separator=','>(#{recordId},#{hit.ruleId},#{hit.version},#{hit.mode},#{hit.reason})</foreach></script>"})
    void insertRuleFacts(@Param("recordId") String recordId, @Param("hits") List<io.github.chenyilei2016.openplatform.domain.governance.GovernanceDecision.Hit> hits);

    @org.apache.ibatis.annotations.Delete({"<script>DELETE FROM platform_call_rule_record WHERE record_id IN",
            "<foreach collection='ids' item='id' open='(' close=')' separator=','>#{id}</foreach></script>"})
    void deleteRuleFacts(@Param("ids") List<String> ids);

    @Select("SELECT id FROM platform_call_record WHERE occurred_at < #{before} ORDER BY occurred_at, id LIMIT #{batchSize}")
    List<String> expiredIds(@Param("before") Instant before, @Param("batchSize") int batchSize);

    /** 一次查询取当前页各凭据最近一次正式调用；每个凭据沿 idx_call_application 倒序取一条，不扫描全部明细。 */
    @Select({"<script>SELECT application_id, occurred_at AS last_called_at FROM (",
            "<foreach collection='ids' item='id' separator=' UNION ALL '>",
            "(SELECT c.application_id, c.occurred_at FROM platform_call_record c",
            "WHERE c.application_id=#{id} AND c.mode='PRODUCTION' ORDER BY c.occurred_at DESC, c.id DESC LIMIT 1)",
            "</foreach>) latest</script>"})
    List<ApplicationLatestCallDO> selectLatestProductionCalls(@Param("ids") List<String> ids);
}
