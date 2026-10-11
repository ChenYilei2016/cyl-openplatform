package io.github.chenyilei2016.openplatform.infrastructure.portal.dal.mapper;

import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import io.github.chenyilei2016.openplatform.infrastructure.portal.dal.dataobject.PortalApplicationDO;
import io.github.chenyilei2016.openplatform.infrastructure.portal.dal.dataobject.PortalApplicationScopeDO;
import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

@Mapper
public interface PortalApplicationMapper {
    /** 仅接收可信租户分页后的应用ID；每页最多100个应用，每个应用最多100个权限组。 */
    @Select("""
            <script>
            SELECT r.application_id,r.scope_code AS code,COALESCE(s.name,r.scope_code) AS name,COALESCE(s.enabled,false) AS enabled
            FROM access_application_scope r LEFT JOIN access_scope s ON s.code=r.scope_code
            WHERE r.application_id IN
            <foreach collection="applicationIds" item="id" open="(" separator="," close=")">#{id}</foreach>
            ORDER BY r.application_id,r.scope_code
            </script>
            """)
    List<PortalApplicationScopeDO> selectScopes(@Param("applicationIds") List<String> applicationIds);

    @Select("""
            SELECT g.id,g.application_id,a.app_key,a.name AS global_name,a.status AS application_status,g.status,g.authorization_version,g.note,g.note_revision
            FROM access_tenant_grant g JOIN access_application a ON a.id=g.application_id
            WHERE g.tenant_id=#{tenantId} AND g.id=#{bindingId}
            """)
    PortalApplicationDO selectApplication(@Param("tenantId") String tenantId, @Param("bindingId") String bindingId);

    @Select("""
            <script>
            SELECT g.id,g.application_id,a.app_key,a.name AS global_name,a.status AS application_status,g.status,g.authorization_version,g.note,g.note_revision
            FROM access_tenant_grant g JOIN access_application a ON a.id=g.application_id
            WHERE g.tenant_id=#{tenantId} AND (g.note LIKE #{pattern} ESCAPE '!' OR a.name LIKE #{pattern} ESCAPE '!' OR a.app_key LIKE #{pattern} ESCAPE '!')
            <if test="status != null">AND g.status=#{status}</if>
            <if test="appKey != null">AND a.app_key=#{appKey}</if>
            <if test="namePattern != null">AND (g.note LIKE #{namePattern} ESCAPE '!' OR a.name LIKE #{namePattern} ESCAPE '!')</if>
            ORDER BY g.id
            </script>
            """)
    IPage<PortalApplicationDO> selectApplications(Page<PortalApplicationDO> page,
            @Param("tenantId") String tenantId, @Param("pattern") String pattern,
            @Param("appKey") String appKey, @Param("namePattern") String namePattern, @Param("status") String status);
}
