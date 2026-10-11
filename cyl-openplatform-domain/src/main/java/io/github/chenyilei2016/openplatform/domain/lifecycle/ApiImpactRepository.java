package io.github.chenyilei2016.openplatform.domain.lifecycle;

import io.github.chenyilei2016.openplatform.domain.access.AccessPageQuery;
import io.github.chenyilei2016.openplatform.domain.common.PageResult;
import java.util.List;

/** 按任一启用权限组交集识别应用，停用应用和无租户授权应用也保留。 */
public interface ApiImpactRepository {
    PageResult<AffectedApplication> page(List<String> enabledScopeCodes, AccessPageQuery query);
}
