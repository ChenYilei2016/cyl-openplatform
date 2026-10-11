package io.github.chenyilei2016.openplatform.infrastructure.sdk.dal.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import io.github.chenyilei2016.openplatform.domain.sdk.SdkArchive;
import io.github.chenyilei2016.openplatform.domain.sdk.SdkAssetQuery;
import io.github.chenyilei2016.openplatform.infrastructure.sdk.dal.dataobject.SdkAssetDO;
import org.apache.ibatis.annotations.*;

@Mapper
public interface SdkAssetMapper extends BaseMapper<SdkAssetDO> {
    String METADATA_COLUMNS = "id,kind,api_id,release_id,service,version,method,name,sdk_version,language,gateway_protocol,"
            + "runtime,release_notes,status,revision,sha256,size_bytes,created_at,published_at";
    String PUBLIC_ELIGIBILITY = "kind='PLATFORM' AND status='PUBLISHED' AND sha256 IS NOT NULL "
            + "AND CHAR_LENGTH(sha256)=64 AND size_bytes BETWEEN 1 AND " + SdkArchive.MAX_CONTENT_BYTES
            + " AND payload IS NOT NULL AND OCTET_LENGTH(payload)=size_bytes";

    @Select("<script>SELECT " + METADATA_COLUMNS + " FROM sdk_asset " + """
            WHERE (name LIKE #{pattern} ESCAPE '!' OR sdk_version LIKE #{pattern} ESCAPE '!')
            <if test="query.apiId != null">AND api_id=#{query.apiId}</if>
            <if test="query.kind != null">AND kind=#{query.kind}</if>
            <if test="query.status != null">AND status=#{query.status}</if>
            <if test="query.sdkVersion != null">AND sdk_version=#{query.sdkVersion}</if>
            <if test="query.language != null">AND language=#{query.language}</if>
            <if test="releaseId != null">AND release_id=#{releaseId} AND kind='LEGACY_API' AND status='PUBLISHED'</if>
            """ + "<if test=\"publicOnly\">AND " + PUBLIC_ELIGIBILITY + "</if> ORDER BY created_at DESC,id</script>")
    IPage<SdkAssetDO> selectPageByQuery(Page<SdkAssetDO> page, @Param("pattern") String pattern,
                                      @Param("query") SdkAssetQuery query, @Param("releaseId") String releaseId,
                                      @Param("publicOnly") boolean publicOnly);

    @Select("SELECT " + METADATA_COLUMNS + " FROM sdk_asset WHERE id=#{id} AND " + PUBLIC_ELIGIBILITY)
    SdkAssetDO selectPublic(@Param("id") String id);

    // 大小不合法时只返回NULL，避免损坏或外部写入的BLOB进入应用内存。
    @Select("SELECT CASE WHEN OCTET_LENGTH(payload) BETWEEN 1 AND " + SdkArchive.MAX_CONTENT_BYTES
            + " THEN payload ELSE NULL END AS payload FROM sdk_asset WHERE id=#{id} AND revision=#{revision}")
    SdkAssetDO selectContent(@Param("id") String id, @Param("revision") long revision);
}
