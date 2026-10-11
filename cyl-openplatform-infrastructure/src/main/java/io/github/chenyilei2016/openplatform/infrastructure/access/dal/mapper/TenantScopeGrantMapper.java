package io.github.chenyilei2016.openplatform.infrastructure.access.dal.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import io.github.chenyilei2016.openplatform.infrastructure.access.dal.dataobject.TenantScopeGrantDO;
import java.util.List;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import io.github.chenyilei2016.openplatform.domain.access.TenantPermissionSummary;
import io.github.chenyilei2016.openplatform.domain.access.TenantScopePermission;
import io.github.chenyilei2016.openplatform.infrastructure.access.dal.dataobject.TenantScopePermissionDO;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

@Mapper
public interface TenantScopeGrantMapper extends BaseMapper<TenantScopeGrantDO> {
    /** 单表按tenant_id索引分组分页，按ID精确检索；名称在应用层按当前页批量补充。 */
    @Select("""
            <script>
            SELECT tenant_id,SUM(CASE WHEN status='ACTIVE' THEN 1 ELSE 0 END) AS granted_scope_count,MAX(updated_at) AS updated_at
            FROM access_tenant_scope_grant
            <if test="tenantId != null">WHERE tenant_id=#{tenantId}</if>
            GROUP BY tenant_id ORDER BY tenant_id
            </script>
            """)
    IPage<TenantPermissionSummary> selectTenants(Page<TenantPermissionSummary> page, @Param("tenantId") String tenantId);

    /** 总数只扫tenant_id覆盖索引，不对完整聚合结果再包一层COUNT。 */
    @Select("""
            <script>
            SELECT COUNT(DISTINCT tenant_id) FROM access_tenant_scope_grant
            <if test="tenantId != null">WHERE tenant_id=#{tenantId}</if>
            </script>
            """)
    long countManagedTenants(@Param("tenantId") String tenantId);

    @Select("""
            <script>
            SELECT s.id,s.code,s.name,s.enabled,s.public_access,s.default_for_new_application,g.id AS grant_id,g.status AS grant_status
            FROM access_scope s LEFT JOIN access_tenant_scope_grant g ON g.scope_code=s.code AND g.tenant_id=#{tenantId}
            WHERE (s.name LIKE #{pattern} ESCAPE '!' OR s.code LIKE #{pattern} ESCAPE '!')
            <if test="filter.name() == 'DIRECT'">AND g.status='ACTIVE'</if>
            <if test="filter.name() == 'PUBLIC'">AND s.public_access=TRUE</if>
            <if test="filter.name() == 'UNGRANTED'">AND s.public_access=FALSE AND (g.id IS NULL OR g.status='REVOKED')</if>
            ORDER BY s.code
            </script>
            """)
    IPage<TenantScopePermissionDO> selectPermissions(Page<TenantScopePermissionDO> page, @Param("tenantId") String tenantId,
            @Param("pattern") String pattern, @Param("filter") TenantScopePermission.Filter filter);

    /** 启用的公共通用权限组 ∪ 该租户 ACTIVE 授予且权限组启用的权限组；tenantId 为 null 时只取公共通用。 */
    @Select("""
            <script>
            SELECT code FROM access_scope
            WHERE enabled=TRUE AND code IN
            <foreach collection="candidates" item="code" open="(" separator="," close=")">#{code}</foreach>
            AND (public_access=TRUE
            <if test="tenantId != null">
              OR code IN (SELECT scope_code FROM access_tenant_scope_grant WHERE tenant_id=#{tenantId} AND status='ACTIVE')
            </if>)
            ORDER BY code
            </script>
            """)
    List<String> selectAvailableScopeCodes(@Param("tenantId") String tenantId, @Param("candidates") List<String> candidates);
}
