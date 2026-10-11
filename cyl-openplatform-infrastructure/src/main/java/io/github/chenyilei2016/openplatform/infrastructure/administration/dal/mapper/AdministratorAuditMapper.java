package io.github.chenyilei2016.openplatform.infrastructure.administration.dal.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import io.github.chenyilei2016.openplatform.infrastructure.administration.dal.dataobject.AdministratorAuditDO;

import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface AdministratorAuditMapper extends BaseMapper<AdministratorAuditDO> {
    @Insert(
            """
<script>
INSERT INTO platform_administrator_audit
    (id, administrator_id, operator_tenant_id, operator_employee_no, action, reason,
     before_json, after_json, request_id, occurred_at)
VALUES <foreach collection="rows" item="row" separator=",">
    (#{row.id}, #{row.administratorId}, #{row.operatorTenantId}, #{row.operatorEmployeeNo},
     #{row.action}, #{row.reason}, #{row.beforeJson}, #{row.afterJson}, #{row.requestId}, #{row.occurredAt})
</foreach>
</script>
""")
    void insertAll(@Param("rows") List<AdministratorAuditDO> rows);
}
