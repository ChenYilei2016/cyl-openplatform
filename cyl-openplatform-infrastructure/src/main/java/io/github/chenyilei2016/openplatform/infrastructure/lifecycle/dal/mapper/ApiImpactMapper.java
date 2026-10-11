package io.github.chenyilei2016.openplatform.infrastructure.lifecycle.dal.mapper;

import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import io.github.chenyilei2016.openplatform.infrastructure.access.dal.dataobject.ApplicationDO;
import io.github.chenyilei2016.openplatform.infrastructure.access.dal.dataobject.ApplicationScopeDO;
import io.github.chenyilei2016.openplatform.infrastructure.lifecycle.dal.dataobject.TenantGrantCountDO;
import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

/** EXISTS避免多权限组重复应用；匹配组和租户数量仅批量读取当前页。 */
@Mapper
public interface ApiImpactMapper {
    @Select("""
            <script>
            SELECT a.id,a.name,a.owner_tenant_id,a.status FROM access_application a
            WHERE a.name LIKE #{pattern} ESCAPE '!'
            AND EXISTS (SELECT 1 FROM access_application_scope s WHERE s.application_id=a.id
                AND s.scope_code IN
                <foreach collection="codes" item="code" open="(" separator="," close=")">#{code}</foreach>)
            ORDER BY a.id
            </script>
            """)
    IPage<ApplicationDO> selectApplications(Page<ApplicationDO> page, @Param("codes") List<String> codes,
                                            @Param("pattern") String pattern);

    @Select("""
            <script>
            SELECT application_id,scope_code FROM access_application_scope WHERE application_id IN
            <foreach collection="ids" item="id" open="(" separator="," close=")">#{id}</foreach>
            AND scope_code IN
            <foreach collection="codes" item="code" open="(" separator="," close=")">#{code}</foreach>
            ORDER BY application_id,scope_code
            </script>
            """)
    List<ApplicationScopeDO> selectMatchedScopes(@Param("ids") List<String> ids, @Param("codes") List<String> codes);

    @Select("""
            <script>
            SELECT application_id,COUNT(*) AS active_tenant_grant_count FROM access_tenant_grant
            WHERE status='ACTIVE' AND application_id IN
            <foreach collection="ids" item="id" open="(" separator="," close=")">#{id}</foreach>
            GROUP BY application_id
            </script>
            """)
    List<TenantGrantCountDO> countActiveGrants(@Param("ids") List<String> ids);
}
