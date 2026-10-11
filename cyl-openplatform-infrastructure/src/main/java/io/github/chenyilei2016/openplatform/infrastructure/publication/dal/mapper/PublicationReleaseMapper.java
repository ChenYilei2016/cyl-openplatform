package io.github.chenyilei2016.openplatform.infrastructure.publication.dal.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import io.github.chenyilei2016.openplatform.infrastructure.publication.dal.dataobject.PublicationReleaseDO;

import org.apache.ibatis.annotations.*;

@Mapper
public interface PublicationReleaseMapper extends BaseMapper<PublicationReleaseDO> {
    @Insert("""
            <script>
            INSERT INTO publication_release_scope(environment_id,release_id,scope_code) VALUES
            <foreach collection="codes" item="code" separator=",">(#{environmentId},#{releaseId},#{code})</foreach>
            </script>
            """)
    int insertScopes(@Param("environmentId") String environmentId, @Param("releaseId") String releaseId, @Param("codes") java.util.List<String> codes);

    @Select(
            "SELECT r.id,r.api_id,r.reviewed_at,r.submitted_at,r.snapshot_json, s.state_version AS effective_state_version, s.enabled AS effective_enabled"
                + " FROM publication_state s JOIN publication_release r ON r.id=s.live_release_id"
                + " WHERE r.environment_id=#{environmentId} AND s.environment_id=#{environmentId} AND s.api_id=#{apiId}")
    PublicationReleaseDO effective(@Param("environmentId") String environmentId, @Param("apiId") String apiId);

    @Select(
            "SELECT r.id,r.api_id,r.reviewed_at,r.submitted_at,r.snapshot_json, s.state_version AS effective_state_version, s.enabled AS effective_enabled"
                    + " FROM catalog_api_draft d JOIN publication_state s ON s.api_id=d.id"
                    + " JOIN publication_release r ON r.id=s.live_release_id"
                    + " WHERE d.environment_id=#{environmentId} AND r.environment_id=#{environmentId} AND s.environment_id=#{environmentId} AND d.service=#{service} AND d.version=#{version} AND d.method=#{method}")
    PublicationReleaseDO effectiveOperation(@Param("environmentId") String environmentId,
            @Param("service") String service,
            @Param("version") String version,
            @Param("method") String method);
}
