package io.github.chenyilei2016.openplatform.infrastructure.catalog.dal.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import io.github.chenyilei2016.openplatform.infrastructure.catalog.dal.dataobject.ApiSummaryDO;
import io.github.chenyilei2016.openplatform.infrastructure.catalog.dal.dataobject.ApiDraftDO;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiOperation;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiCatalogFilter;
import java.util.List;

@Mapper
public interface ApiDraftMapper extends BaseMapper<ApiDraftDO> {
    IPage<ApiSummaryDO> selectSummaries(@Param("environmentId") String environmentId, Page<ApiSummaryDO> page, @Param("pattern") String pattern, @Param("filter") ApiCatalogFilter filter,
                                      @Param("classPattern") String classPattern, @Param("simplePattern") String simplePattern,
                                      @Param("methodPattern") String methodPattern);
    @org.apache.ibatis.annotations.Select("SELECT portal_visible FROM catalog_api_draft WHERE environment_id=#{environmentId} AND id=#{id}")
    Boolean portalVisible(@Param("environmentId") String environmentId, @Param("id") String id);
    @org.apache.ibatis.annotations.Update("UPDATE catalog_api_draft SET portal_visible=#{visible} WHERE environment_id=#{environmentId} AND id=#{id}")
    int setPortalVisible(@Param("environmentId") String environmentId, @Param("id") String id, @Param("visible") boolean visible);
    /** 全局搜索：只投影标识列，limit 由调用方限定上限。 */
    List<ApiDraftDO> searchIdentities(@Param("environmentId") String environmentId, @Param("pattern") String pattern, @Param("limit") int limit);
    IPage<String> selectCategories(Page<String> page, @Param("pattern") String pattern);

    @org.apache.ibatis.annotations.Select("SELECT * FROM catalog_api_draft WHERE environment_id=#{environmentId} AND id = #{id} FOR UPDATE")
    ApiDraftDO selectForUpdate(@Param("environmentId") String environmentId, @Param("id") String id);
    int updateDraft(@Param("draft") ApiDraftDO draft, @Param("expectedRevision") long expectedRevision);
    List<ApiDraftDO> selectOperations(@Param("environmentId") String environmentId, @Param("operations") List<ApiOperation> operations);
    /** 只投影生成候选工具名的标识列，不加载定义正文。 */
    List<ApiDraftDO> selectToolNameOperations(@Param("environmentId") String environmentId, @Param("toolNames") List<String> toolNames, @Param("limit") int limit);
    List<ApiDraftDO> selectAllForUpdate(@Param("environmentId") String environmentId, @Param("ids") List<String> ids);
    int insertAll(@Param("drafts") List<ApiDraftDO> drafts);
    int updateAll(@Param("environmentId") String environmentId, @Param("drafts") List<ApiDraftDO> drafts);
}
