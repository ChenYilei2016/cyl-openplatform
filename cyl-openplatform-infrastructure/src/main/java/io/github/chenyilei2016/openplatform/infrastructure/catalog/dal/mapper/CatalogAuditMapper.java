package io.github.chenyilei2016.openplatform.infrastructure.catalog.dal.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import io.github.chenyilei2016.openplatform.infrastructure.catalog.dal.dataobject.CatalogAuditDO;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Insert;
import java.util.List;

@Mapper
public interface CatalogAuditMapper extends BaseMapper<CatalogAuditDO> {
    @Insert("""
            <script>
            INSERT INTO catalog_audit
            (environment_id,id,api_id,draft_revision,action,operator_tenant_id,operator_employee_no,request_id,occurred_at) VALUES
            <foreach collection="audits" item="audit" separator=",">
            (#{audit.environmentId},#{audit.id},#{audit.apiId},#{audit.draftRevision},#{audit.action},#{audit.operatorTenantId},
             #{audit.operatorEmployeeNo},#{audit.requestId},#{audit.occurredAt})
            </foreach>
            </script>
            """)
    int insertAll(@Param("audits") List<CatalogAuditDO> audits);
}
