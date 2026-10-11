package io.github.chenyilei2016.openplatform.infrastructure.access.dal.mapper;

import org.apache.ibatis.annotations.Mapper;
import io.github.chenyilei2016.openplatform.domain.access.ApplicationFilter;
import io.github.chenyilei2016.openplatform.infrastructure.access.dal.dataobject.ApplicationSummaryDO;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import io.github.chenyilei2016.openplatform.infrastructure.access.dal.dataobject.ApplicationDO;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import java.util.List;
import io.github.chenyilei2016.openplatform.infrastructure.access.dal.dataobject.ApplicationGrantSummaryDO;
import org.apache.ibatis.annotations.Update;

@Mapper
public interface ApplicationMapper extends BaseMapper<ApplicationDO> {
    String COLUMNS = "id,app_key,name,owner_tenant_id,status,authorization_version,kind";

    /** 凭据管理列表只含普通凭据；MCP 网关凭据在“MCP 接入”页单独管理。 */
    @Select("""
            <script>
            SELECT a.id,a.app_key,a.name,a.owner_tenant_id,a.status,a.authorization_version,a.kind,
              <choose><when test="filter.tenantId != null">g.status</when><otherwise>NULL</otherwise></choose>
              AS selected_tenant_grant_status
            FROM access_application a
            <if test="filter.tenantId != null">
              JOIN access_tenant_grant g ON g.application_id=a.id AND g.tenant_id=#{filter.tenantId}
            </if>
            WHERE a.kind='STANDARD' AND a.name LIKE #{pattern} ESCAPE '!'
            <if test="filter.appKey != null">AND a.app_key=#{filter.appKey}</if>
            <if test="filter.tokenId != null">
              AND a.id IN (SELECT token.application_id FROM platform_token token WHERE token.id=#{filter.tokenId})
            </if>
            <if test="!filter.statuses.isEmpty()">AND a.status IN
              <foreach collection="filter.statuses" item="status" open="(" separator="," close=")">#{status}</foreach>
            </if>
            <if test="filter.tenantId != null and filter.relationStatuses.size() == 1">AND g.status IN
              <foreach collection="filter.relationStatuses" item="status" open="(" separator="," close=")">#{status}</foreach>
            </if>
            <if test="filter.tenantId == null and filter.relationStatuses.size() == 1">
              AND EXISTS (SELECT 1 FROM access_tenant_grant relation WHERE relation.application_id=a.id AND relation.status IN
                <foreach collection="filter.relationStatuses" item="status" open="(" separator="," close=")">#{status}</foreach>)
            </if>
            ORDER BY a.id
            </script>
            """)
    IPage<ApplicationSummaryDO> selectByQuery(Page<ApplicationSummaryDO> page, @Param("pattern") String pattern,
                                             @Param("filter") ApplicationFilter filter);

    /** 只对当前页凭据汇总；数据库限制每个凭据返回两条，避免加载全部关联。 */
    @Select("""
            <script>
            SELECT application_id,tenant_id,status,matched,total_count,matched_count FROM (
              SELECT filtered.*,
                COUNT(*) OVER (PARTITION BY application_id) AS total_count,
                SUM(matched) OVER (PARTITION BY application_id) AS matched_count,
                ROW_NUMBER() OVER (PARTITION BY application_id ORDER BY matched DESC,tenant_id) AS relation_rank
              FROM (
                SELECT application_id,tenant_id,status,
                  CASE WHEN 1=1
                    <if test="filter.tenantId != null">AND tenant_id=#{filter.tenantId}</if>
                    <if test="filter.relationStatuses.size() == 1">AND status IN
                      <foreach collection="filter.relationStatuses" item="status" open="(" separator="," close=")">#{status}</foreach>
                    </if>
                  THEN 1 ELSE 0 END AS matched
                FROM access_tenant_grant WHERE application_id IN
                  <foreach collection="ids" item="id" open="(" separator="," close=")">#{id}</foreach>
              ) filtered
            ) ranked WHERE relation_rank &lt;= 2
            ORDER BY application_id,relation_rank
            </script>
            """)
    List<ApplicationGrantSummaryDO> selectGrantSummaries(@Param("ids") List<String> ids, @Param("filter") ApplicationFilter filter);

    @Select("SELECT " + COLUMNS + " FROM access_application WHERE id=#{id} FOR UPDATE")
    ApplicationDO selectForUpdate(@Param("id") String id);

    @Select("SELECT secret_digest FROM access_application WHERE id=#{id}")
    String selectSecretDigest(@Param("id") String id);

    @Update("UPDATE access_application SET authorization_version=authorization_version+1 WHERE id=#{id}")
    void incrementVersion(@Param("id") String id);

    @Update("""
            UPDATE access_application SET status=#{status},authorization_version=authorization_version+1
            WHERE id=#{id} AND status<>#{status}
            """)
    void changeStatus(@Param("id") String id, @Param("status") String status);

    @Update("""
            UPDATE access_application SET authorization_version=authorization_version+1
            WHERE id IN (SELECT application_id FROM access_application_scope WHERE scope_code=#{code})
            """)
    void incrementScopeVersion(@Param("code") String code);

    @Update("""
            UPDATE access_application SET secret_digest=#{digest},authorization_version=authorization_version+1
            WHERE id=#{id}
            """)
    void rotateSecret(@Param("id") String id, @Param("digest") String digest);
}
