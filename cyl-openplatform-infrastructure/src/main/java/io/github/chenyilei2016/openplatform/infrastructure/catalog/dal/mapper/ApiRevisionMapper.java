package io.github.chenyilei2016.openplatform.infrastructure.catalog.dal.mapper;

import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import io.github.chenyilei2016.openplatform.infrastructure.catalog.dal.dataobject.ApiDraftDO;
import io.github.chenyilei2016.openplatform.infrastructure.catalog.dal.dataobject.ApiRevisionDO;
import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

@Mapper
public interface ApiRevisionMapper {
    @Select("SELECT COUNT(*) FROM catalog_api_draft WHERE environment_id=#{environmentId} AND id = #{apiId}")
    long countApi(@Param("environmentId") String environmentId, @Param("apiId") String apiId);
    IPage<ApiRevisionDO> selectSummaries(@Param("environmentId") String environmentId, Page<ApiRevisionDO> page, @Param("apiId") String apiId);
    @Select("SELECT * FROM catalog_api_revision WHERE environment_id=#{environmentId} AND api_id = #{apiId} AND revision = #{revision}")
    ApiRevisionDO selectRevision(@Param("environmentId") String environmentId, @Param("apiId") String apiId, @Param("revision") long revision);
    List<ApiDraftDO> selectMissingDrafts(@Param("environmentId") String environmentId, @Param("ids") List<String> ids);
    int insertAll(@Param("revisions") List<ApiRevisionDO> revisions);
}
