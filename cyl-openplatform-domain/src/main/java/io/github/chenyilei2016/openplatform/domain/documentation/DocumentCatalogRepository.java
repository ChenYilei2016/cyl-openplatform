package io.github.chenyilei2016.openplatform.domain.documentation;

import io.github.chenyilei2016.openplatform.domain.common.PageResult;
import java.util.List;
import java.util.Optional;

public interface DocumentCatalogRepository {
    boolean projectionReady();

    /** 显式区分阅读身份；客户传当前启用scope集合，授权过滤先于分页。 */
    PageResult<DocumentSummary> page(DocumentQuery query, DocumentAudience audience, List<String> scopeCodes, String tenantId);

    PageResult<DocumentCategory> categories(DocumentQuery query, DocumentAudience audience, List<String> scopeCodes, String tenantId);

    Optional<DocumentView> visibleDocument(String service, String version, String method, String tenantId);
}
