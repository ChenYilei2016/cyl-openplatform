package io.github.chenyilei2016.openplatform.infrastructure.token.dal.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import io.github.chenyilei2016.openplatform.infrastructure.token.dal.dataobject.TokenDO;
import org.apache.ibatis.annotations.Mapper;
import io.github.chenyilei2016.openplatform.domain.token.TokenFilter;
import java.time.Instant;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

@Mapper
public interface TokenMapper extends BaseMapper<TokenDO> {
    String COLUMNS = "id,application_id,app_key,tenant_grant_id,tenant_id,user_grant_id,user_id,employee_id,employee_no,"
            + "application_version,tenant_version,user_version,scope_codes,status,issued_at,expires_at";

    @Select("SELECT " + COLUMNS + " FROM platform_token WHERE token_digest=#{digest}")
    TokenDO selectByDigest(@Param("digest") String digest);

    @Select("SELECT " + COLUMNS + " FROM platform_token WHERE id=#{id} FOR UPDATE")
    TokenDO selectForUpdate(@Param("id") String id);

    @Update("UPDATE platform_token SET status='REVOKED' WHERE id=#{id} AND status='ACTIVE'")
    void revoke(@Param("id") String id);

    // 与TokenStatus.effective相同优先级：撤销优先，其次到期，再判断授权版本。
    String AUTHORIZATION_VALID = """
            (a.status='ENABLED' AND a.authorization_version=t.application_version
             AND g.status='ACTIVE' AND g.authorization_version=t.tenant_version
             AND (t.user_grant_id IS NULL OR (u.status='ACTIVE' AND u.authorization_version=t.user_version)))
            """;
    String EFFECTIVE_STATUS = "CASE WHEN t.status='REVOKED' THEN 'REVOKED' "
            + "WHEN t.expires_at &lt;= #{now} THEN 'EXPIRED' WHEN " + AUTHORIZATION_VALID
            + " THEN 'ACTIVE' ELSE 'INVALIDATED' END";

    @Select("""
            <script>
            SELECT t.id,t.application_id,t.app_key,t.tenant_grant_id,t.tenant_id,t.user_grant_id,
              t.user_id,t.employee_id,t.employee_no,t.application_version,t.tenant_version,t.user_version,
              t.scope_codes,t.status,t.issued_at,t.expires_at,
              CASE WHEN
            """ + AUTHORIZATION_VALID + """
              THEN true ELSE false END AS authorization_valid
            FROM platform_token t
            LEFT JOIN access_application a ON a.id=t.application_id
            LEFT JOIN access_tenant_grant g ON g.id=t.tenant_grant_id
            LEFT JOIN access_user_grant u ON u.id=t.user_grant_id
            WHERE t.application_id=#{applicationId}
            <if test="filter.tokenId != null">AND t.id=#{filter.tokenId}</if>
            <if test="filter.tenantId != null">AND t.tenant_id=#{filter.tenantId}</if>
            <if test="filter.employeeNo != null">AND t.employee_no=#{filter.employeeNo}</if>
            <if test="filter.subjectTypes.size() == 1">
              <choose>
                <when test="filter.subjectTypes.iterator().next().name() == 'USER'">AND t.user_grant_id IS NOT NULL</when>
                <otherwise>AND t.user_grant_id IS NULL</otherwise>
              </choose>
            </if>
            <if test="!filter.statuses.isEmpty()">AND
            """ + EFFECTIVE_STATUS + """
              IN <foreach collection="filter.statuses" item="status" open="(" separator="," close=")">#{status}</foreach>
            </if>
            ORDER BY t.issued_at DESC,t.id DESC
            </script>
            """)
    IPage<TokenDO> selectByApplication(Page<TokenDO> page, @Param("applicationId") String applicationId,
                                      @Param("filter") TokenFilter filter, @Param("now") Instant now);
}
