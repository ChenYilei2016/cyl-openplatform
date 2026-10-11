package io.github.chenyilei2016.openplatform.domain.catalog;

import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;

public record CatalogPageQuery(int page, int pageSize, String query) {
    /** service与method各最多64字符，组合检索须容纳完整标识及分隔点。 */
    public static final int MAX_QUERY_LENGTH = 129;

    public CatalogPageQuery {
        if (page < 1 || pageSize < 1 || pageSize > 100 || (query != null && query.length() > MAX_QUERY_LENGTH)) {
            throw new PlatformException(ErrorCode.INVALID_REQUEST, "分页或查询条件超出限制");
        }
        query = query == null ? "" : query;
    }
}
