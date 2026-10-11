package io.github.chenyilei2016.openplatform.infrastructure.administration.dal.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import io.github.chenyilei2016.openplatform.infrastructure.administration.dal.dataobject.AdministratorDO;

import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface AdministratorMapper extends BaseMapper<AdministratorDO> {
    @Insert(
            """
<script>
INSERT INTO platform_administrator
    (id, tenant_id, user_id, employee_id, employee_no, display_name, enabled, super_administrator, revision)
VALUES <foreach collection="rows" item="row" separator=",">
    (#{row.id}, #{row.tenantId}, #{row.userId}, #{row.employeeId}, #{row.employeeNo},
     #{row.displayName}, #{row.enabled}, #{row.superAdministrator}, #{row.revision})
</foreach>
</script>
""")
    void insertAll(@Param("rows") List<AdministratorDO> rows);
}
