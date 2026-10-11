package io.github.chenyilei2016.openplatform.infrastructure.access.dal.mapper;

import java.util.List;
import java.util.Collection;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import io.github.chenyilei2016.openplatform.infrastructure.access.dal.dataobject.EmployeeProfileDO;

import org.apache.ibatis.annotations.*;

import java.time.Instant;

@Mapper
public interface EmployeeProfileMapper extends BaseMapper<EmployeeProfileDO> {
    @Select("""
            <script>
            SELECT tenant_id, tenant_name FROM (
              SELECT tenant_id, tenant_name,
                ROW_NUMBER() OVER(PARTITION BY tenant_id ORDER BY last_seen_at DESC, id DESC) AS rn
              FROM access_employee_profile WHERE tenant_name IS NOT NULL AND tenant_name &lt;&gt; ''
                AND tenant_id IN
                <foreach collection="ids" item="id" open="(" separator="," close=")">#{id}</foreach>
            ) names WHERE rn=1
            </script>
            """)
    List<EmployeeProfileDO> tenantNames(@Param("ids") Collection<String> ids);

    /** last_seen_at首先计算，后续字段仍以新旧核验时间判断；工号不作为唯一人员身份。 */
    @Insert(
            """
INSERT INTO access_employee_profile(id,tenant_id,tenant_name,employee_id,user_id,employee_no,display_name,last_seen_at)
VALUES(#{p.id},#{p.tenantId},#{p.tenantName},#{p.employeeId},#{p.userId},#{p.employeeNo},#{p.displayName},#{p.lastSeenAt})
ON DUPLICATE KEY UPDATE
  last_seen_at=CASE WHEN #{p.lastSeenAt}>=last_seen_at AND (user_id<>#{p.userId}
    OR (#{p.tenantName} IS NOT NULL AND (tenant_name IS NULL OR tenant_name<>#{p.tenantName}))
    OR employee_no<>#{p.employeeNo} OR display_name<>#{p.displayName}
    OR last_seen_at<=#{refreshBefore}) THEN #{p.lastSeenAt} ELSE last_seen_at END,
  tenant_name=CASE WHEN #{p.lastSeenAt}>=last_seen_at THEN COALESCE(#{p.tenantName},tenant_name) ELSE tenant_name END,
  user_id=CASE WHEN #{p.lastSeenAt}>=last_seen_at THEN #{p.userId} ELSE user_id END,
  employee_no=CASE WHEN #{p.lastSeenAt}>=last_seen_at THEN #{p.employeeNo} ELSE employee_no END,
  display_name=CASE WHEN #{p.lastSeenAt}>=last_seen_at THEN #{p.displayName} ELSE display_name END
""")
    void remember(
            @Param("p") EmployeeProfileDO profile, @Param("refreshBefore") Instant refreshBefore);
}
