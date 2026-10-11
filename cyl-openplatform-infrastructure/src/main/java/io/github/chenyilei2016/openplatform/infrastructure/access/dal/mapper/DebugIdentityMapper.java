package io.github.chenyilei2016.openplatform.infrastructure.access.dal.mapper;

import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import io.github.chenyilei2016.openplatform.infrastructure.access.dal.dataobject.CallableGrantDO;
import java.util.Collection;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

@Mapper
public interface DebugIdentityMapper {
    /** 启用凭据 × 有效租户授权，凭据拥有任一给定权限组；按凭据名称、AK、租户或备注包含搜索。 */
    @Select("""
            <script>
            SELECT a.id AS application_id, a.name AS application_name, a.app_key,
                   g.id AS tenant_grant_id, g.tenant_id, g.note
            FROM access_tenant_grant g
            JOIN access_application a ON a.id=g.application_id
            WHERE g.status='ACTIVE' AND a.status='ENABLED'
              AND EXISTS (SELECT 1 FROM access_application_scope s WHERE s.application_id=a.id AND s.scope_code IN
                <foreach collection="scopeCodes" item="code" open="(" separator="," close=")">#{code}</foreach>)
              AND (a.name LIKE #{pattern} ESCAPE '!' OR a.app_key LIKE #{pattern} ESCAPE '!'
                   OR g.tenant_id LIKE #{pattern} ESCAPE '!' OR g.note LIKE #{pattern} ESCAPE '!')
            ORDER BY a.name, a.id, g.tenant_id, g.id
            </script>
            """)
    IPage<CallableGrantDO> selectCallable(Page<CallableGrantDO> page, @Param("scopeCodes") Collection<String> scopeCodes,
                                          @Param("pattern") String pattern);
}
