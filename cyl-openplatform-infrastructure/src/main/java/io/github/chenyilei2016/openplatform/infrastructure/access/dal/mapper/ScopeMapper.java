package io.github.chenyilei2016.openplatform.infrastructure.access.dal.mapper;

import org.apache.ibatis.annotations.Mapper;
import io.github.chenyilei2016.openplatform.domain.access.ScopeFilter;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import io.github.chenyilei2016.openplatform.infrastructure.access.dal.dataobject.ScopeApiDO;
import io.github.chenyilei2016.openplatform.infrastructure.access.dal.dataobject.ScopeCountDO;
import io.github.chenyilei2016.openplatform.infrastructure.access.dal.dataobject.ScopeDO;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import java.util.List;

@Mapper
public interface ScopeMapper extends BaseMapper<ScopeDO> {
    @Select("""
            <script>
            SELECT id,code,name,enabled,default_for_new_application,public_access FROM access_scope
            WHERE (name LIKE #{pattern} ESCAPE '!' OR code LIKE #{pattern} ESCAPE '!')
              AND name LIKE #{namePattern} ESCAPE '!'
            <if test="filter.code != null">AND code=#{filter.code}</if>
            <if test="!filter.enabled.isEmpty()">AND enabled IN
              <foreach collection="filter.enabled" item="enabled" open="(" separator="," close=")">#{enabled}</foreach>
            </if>
            <if test="!filter.defaultForNewApplication.isEmpty()">AND default_for_new_application IN
              <foreach collection="filter.defaultForNewApplication" item="defaultValue" open="(" separator="," close=")">#{defaultValue}</foreach>
            </if>
            ORDER BY code
            </script>
            """)
    IPage<ScopeDO> selectByQuery(Page<ScopeDO> page, @Param("pattern") String pattern,
                               @Param("filter") ScopeFilter filter, @Param("namePattern") String namePattern);

    /** 已发布生效版本（publication_state.live_release_id）携带该组的 API 数。 */
    @Select("""
            <script>
            SELECT rs.scope_code, COUNT(*) AS total FROM publication_state s
            JOIN publication_release_scope rs ON rs.release_id=s.live_release_id
            WHERE s.environment_id=#{environmentId} AND rs.scope_code IN
            <foreach collection="codes" item="code" open="(" separator="," close=")">#{code}</foreach>
            GROUP BY rs.scope_code
            </script>
            """)
    List<ScopeCountDO> countLiveApis(@Param("environmentId") String environmentId, @Param("codes") List<String> codes);

    @Select("""
            <script>
            SELECT scope_code, COUNT(*) AS total FROM access_application_scope WHERE scope_code IN
            <foreach collection="codes" item="code" open="(" separator="," close=")">#{code}</foreach>
            GROUP BY scope_code
            </script>
            """)
    List<ScopeCountDO> countApplications(@Param("codes") List<String> codes);

    /** 只统计当前页权限组的有效直接授予；公共通用的隐式可用租户不计数。 */
    @Select("""
            <script>
            SELECT scope_code,COUNT(*) AS total FROM access_tenant_scope_grant
            WHERE status='ACTIVE' AND scope_code IN
            <foreach collection="codes" item="code" open="(" separator="," close=")">#{code}</foreach>
            GROUP BY scope_code
            </script>
            """)
    List<ScopeCountDO> countTenants(@Param("codes") List<String> codes);

    /**
     * API 与权限组的关联在草稿 definition_json.scopeCodes 中（无关系表），已发布版本另存 publication_release_scope。
     * 两侧任一携带即列出，便于看到待发布的增删；JSON_CONTAINS 返回 NULL 时按不包含处理。
     */
    @Select("""
            <script>
            SELECT d.id,d.name,d.service,d.version,d.method,d.protocol,d.draft_revision,
                   r.draft_revision AS live_draft_revision,
                   JSON_CONTAINS(d.definition_json, #{quoted}, '$.scopeCodes') AS draft_included,
                   CASE WHEN rs.scope_code IS NULL THEN FALSE ELSE TRUE END AS live_included
            FROM catalog_api_draft d
            LEFT JOIN publication_state s ON s.api_id=d.id
            LEFT JOIN publication_release r ON r.id=s.live_release_id
            LEFT JOIN publication_release_scope rs ON rs.release_id=s.live_release_id AND rs.scope_code=#{code}
            WHERE d.environment_id=#{environmentId} AND (rs.scope_code IS NOT NULL OR JSON_CONTAINS(d.definition_json, #{quoted}, '$.scopeCodes')=1)
              AND (d.name LIKE #{pattern} ESCAPE '!' OR d.service LIKE #{pattern} ESCAPE '!' OR d.method LIKE #{pattern} ESCAPE '!')
            ORDER BY d.service,d.method,d.version,d.id
            </script>
            """)
    IPage<ScopeApiDO> selectApis(@Param("environmentId") String environmentId, Page<ScopeApiDO> page, @Param("code") String code, @Param("quoted") String quoted,
                                 @Param("pattern") String pattern);

    @Select("SELECT id,code,name,enabled,default_for_new_application,public_access FROM access_scope WHERE id=#{id} FOR UPDATE")
    ScopeDO selectForUpdate(@Param("id") String id);

    @Select("""
            SELECT code FROM access_scope WHERE enabled=true AND default_for_new_application=true
            ORDER BY code LIMIT 101 FOR UPDATE
            """)
    List<String> selectDefaultCodesForUpdate();

    @Select("""
            <script>
            SELECT code FROM access_scope WHERE enabled=true AND code IN
            <foreach collection="codes" item="code" open="(" separator="," close=")">#{code}</foreach>
            ORDER BY code FOR UPDATE
            </script>
            """)
    List<String> selectEnabledCodesForUpdate(@Param("codes") List<String> codes);
}
