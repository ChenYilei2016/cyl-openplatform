package io.github.chenyilei2016.openplatform.infrastructure.documentation.dal.mapper;

import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import io.github.chenyilei2016.openplatform.domain.documentation.DocumentQuery;
import io.github.chenyilei2016.openplatform.domain.documentation.DocumentAudience;
import io.github.chenyilei2016.openplatform.infrastructure.documentation.dal.dataobject.DocumentCategoryDO;
import io.github.chenyilei2016.openplatform.infrastructure.publication.dal.dataobject.PublicationReleaseDO;
import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

@Mapper
public interface DocumentCatalogMapper {
    @Select("""
            SELECT NOT EXISTS (SELECT 1 FROM publication_state s
                JOIN publication_release r ON r.id=s.live_release_id
            WHERE r.environment_id=#{environmentId} AND s.environment_id=#{environmentId} AND s.enabled=true AND r.status='APPLIED' AND r.category IS NULL)
            """)
    boolean projectionReady(@Param("environmentId") String environmentId);

    IPage<PublicationReleaseDO> selectDocuments(@Param("environmentId") String environmentId, Page<PublicationReleaseDO> page, @Param("q") DocumentQuery query,
                                               @Param("pattern") String pattern, @Param("audience") DocumentAudience audience,
                                              @Param("codes") List<String> codes, @Param("tenantId") String tenantId);

    IPage<DocumentCategoryDO> selectCategories(@Param("environmentId") String environmentId, Page<DocumentCategoryDO> page, @Param("q") DocumentQuery query,
                                              @Param("pattern") String pattern, @Param("audience") DocumentAudience audience,
                                              @Param("codes") List<String> codes, @Param("tenantId") String tenantId);

    PublicationReleaseDO selectVisibleDocument(@Param("environmentId") String environmentId, @Param("service") String service,
                                             @Param("version") String version,
                                             @Param("method") String method, @Param("tenantId") String tenantId);
}
