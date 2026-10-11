package io.github.chenyilei2016.openplatform.domain.catalog;

import io.github.chenyilei2016.openplatform.domain.common.PageResult;
import java.util.Optional;

public interface ApiRevisionRepository {
    boolean apiExists(String apiId);
    PageResult<ApiRevisionSummary> page(String apiId, CatalogPageQuery query);
    Optional<ApiRevision> find(String apiId, long revision);
}
