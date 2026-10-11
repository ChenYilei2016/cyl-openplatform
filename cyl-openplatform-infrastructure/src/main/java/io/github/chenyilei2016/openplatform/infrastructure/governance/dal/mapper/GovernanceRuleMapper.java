package io.github.chenyilei2016.openplatform.infrastructure.governance.dal.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import io.github.chenyilei2016.openplatform.application.governance.GovernanceRuleManagement.Query;
import io.github.chenyilei2016.openplatform.application.governance.GovernanceRuleManagement.AssociationCount;
import io.github.chenyilei2016.openplatform.domain.governance.GovernanceRule;
import java.util.List;
import java.util.Set;
import io.github.chenyilei2016.openplatform.infrastructure.governance.dal.dataobject.GovernanceRuleDO;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

@Mapper
public interface GovernanceRuleMapper extends BaseMapper<GovernanceRuleDO> {
    /** 当前页ID批量聚合，使用api/application/tenant索引；不读取JSON或联查对象/发布表。 */
    @Select("""
            <script>
            SELECT
              <choose><when test="targetType.name() == 'API'">api_id</when><when test="targetType.name() == 'TENANT'">tenant_id</when><otherwise>application_id</otherwise></choose> AS target_id,
              COUNT(*) AS rule_count
            FROM gateway_governance_rule
            WHERE
              <choose><when test="targetType.name() == 'API'">api_id</when><when test="targetType.name() == 'TENANT'">tenant_id</when><otherwise>application_id</otherwise></choose>
              IN <foreach collection="targetIds" item="id" open="(" separator="," close=")">#{id}</foreach>
              AND (api_id IS NULL OR EXISTS(SELECT 1 FROM catalog_api_draft d WHERE d.id=gateway_governance_rule.api_id AND d.environment_id=#{environmentId}))
              AND target_type IN <foreach collection="allowedTypes" item="type" open="(" separator="," close=")">#{type}</foreach>
            GROUP BY
              <choose><when test="targetType.name() == 'API'">api_id</when><when test="targetType.name() == 'TENANT'">tenant_id</when><otherwise>application_id</otherwise></choose>
            </script>
            """)
    List<AssociationCount> associationCounts(@Param("environmentId") String environmentId, @Param("targetType") GovernanceRule.Type targetType,
                                            @Param("targetIds") List<String> targetIds,
                                            @Param("allowedTypes") Set<GovernanceRule.Type> allowedTypes);

    @Select("SELECT * FROM gateway_governance_rule g WHERE id=#{id} AND (g.api_id IS NULL OR EXISTS(SELECT 1 FROM catalog_api_draft d WHERE d.id=g.api_id AND d.environment_id=#{environmentId})) FOR UPDATE")
    GovernanceRuleDO lock(@Param("environmentId") String environmentId, @Param("id") String id);

    @Select("""
            <script>
            SELECT r.*, a.name AS application_name, a.app_key, c.name AS api_name, c.service AS api_service, c.version AS api_version, c.method AS api_method, l.name AS live_name FROM gateway_governance_rule r
            LEFT JOIN access_application a ON a.id=r.application_id
            LEFT JOIN catalog_api_draft c ON c.id=r.api_id
            LEFT JOIN gateway_governance_release l ON l.id=r.live_release_id
            WHERE (r.api_id IS NULL OR c.environment_id=#{environmentId}) AND r.name LIKE #{pattern} ESCAPE '!'
              AND r.target_type IN <foreach collection="query.allowedTypes" item="type" open="(" separator="," close=")">#{type}</foreach>
              <if test="query.type != null">AND r.target_type=#{query.type}</if>
              <if test="query.tenantId != null">AND r.tenant_id=#{query.tenantId}</if>
              <if test="query.appKey != null">AND a.app_key=#{query.appKey}</if>
              <if test="query.apiId != null">AND r.api_id=#{query.apiId}</if>
              <if test="query.mode != null">AND r.live_mode=#{query.mode}</if>
            ORDER BY r.id
            </script>
            """)
    IPage<GovernanceRuleDO> pageRules(@Param("environmentId") String environmentId, Page<GovernanceRuleDO> page, @Param("query") Query query, @Param("pattern") String pattern);

    @Select("""
            SELECT r.*, a.name AS application_name, a.app_key, c.name AS api_name, c.service AS api_service, c.version AS api_version, c.method AS api_method, l.name AS live_name FROM gateway_governance_rule r
            LEFT JOIN access_application a ON a.id=r.application_id
            LEFT JOIN catalog_api_draft c ON c.id=r.api_id
            LEFT JOIN gateway_governance_release l ON l.id=r.live_release_id
            WHERE (r.api_id IS NULL OR c.environment_id=#{environmentId}) AND r.id=#{id}
            """)
    GovernanceRuleDO detail(@Param("environmentId") String environmentId, @Param("id") String id);

    @Update("""
            UPDATE gateway_governance_rule SET name=#{row.name},live_mode=#{row.liveMode},config_json=#{row.configJson},
              draft_revision=#{row.draftRevision},state_version=#{row.stateVersion},live_release_id=#{row.liveReleaseId},live_rule_json=#{row.liveRuleJson}
            WHERE id=#{row.id} AND (api_id IS NULL OR EXISTS(SELECT 1 FROM catalog_api_draft d WHERE d.id=gateway_governance_rule.api_id AND d.environment_id=#{environmentId})) AND draft_revision=#{expectedDraftRevision} AND state_version=#{expectedStateVersion}
            """)
    int updateChecked(@Param("environmentId") String environmentId, @Param("row") GovernanceRuleDO row, @Param("expectedDraftRevision") long expectedDraftRevision,
                      @Param("expectedStateVersion") long expectedStateVersion);
}
