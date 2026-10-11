package io.github.chenyilei2016.openplatform.domain.connection;

import io.github.chenyilei2016.openplatform.domain.common.PageResult;
import java.util.Set;

/** 使用独立索引投影查询影响与预热范围，不加载API契约正文。 */
public interface DubboConnectionUsageRepository {
    record Usage(String apiId, String name, long revision, String kind) {}
    PageResult<Usage> page(String connectionId, int page, int pageSize);
    boolean isReferenced(String connectionId, long revision);
    Set<DubboConnectionRepository.RevisionKey> referencedRevisions(String environmentId, int limit);
}
