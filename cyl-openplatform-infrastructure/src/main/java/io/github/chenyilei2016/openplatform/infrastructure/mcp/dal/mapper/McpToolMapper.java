package io.github.chenyilei2016.openplatform.infrastructure.mcp.dal.mapper;

import io.github.chenyilei2016.openplatform.infrastructure.publication.dal.dataobject.PublicationReleaseDO;
import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface McpToolMapper {
    List<PublicationReleaseDO> listAfter(@Param("environmentId") String environmentId, @Param("toolSetId") String toolSetId, @Param("afterApiId") String afterApiId, @Param("limit") int limit);
    List<PublicationReleaseDO> find(@Param("environmentId") String environmentId, @Param("toolName") String toolName, @Param("toolSetId") String toolSetId);
    List<String> availableApiIds(@Param("environmentId") String environmentId, @Param("apiIds") List<String> apiIds);
    List<io.github.chenyilei2016.openplatform.infrastructure.catalog.dal.dataobject.ApiDraftDO> apiNames(@Param("environmentId") String environmentId, @Param("apiIds") List<String> apiIds);
    List<io.github.chenyilei2016.openplatform.domain.mcp.McpToolRepository.ToolSetRef> toolSets(@Param("environmentId") String environmentId, @Param("apiIds") List<String> apiIds);
}
