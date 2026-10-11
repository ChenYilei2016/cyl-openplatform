package io.github.chenyilei2016.openplatform.domain.documentation;

import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;

/** 外部版本按字面精确选择；查询规模在进入持久层前统一限定。 */
public record DocumentQuery(int page, int pageSize, String query, String category,
                            String service, String version, String method, boolean mcpOnly) {
    public DocumentQuery {
        if (page < 1 || pageSize < 1 || pageSize > 100 || (long) (page - 1) * pageSize > 100_000
                || query != null && query.length() > 100 || category != null && category.length() > 100
                || service != null && service.length() > 64 || version != null && version.length() > 32
                || method != null && method.length() > 64) {
            throw new PlatformException(ErrorCode.INVALID_REQUEST, "文档分页或查询条件超出限制");
        }
        query = query == null ? "" : query;
        category = category == null || category.isEmpty() ? null : category;
        service = service == null || service.isEmpty() ? null : service;
        version = version == null || version.isEmpty() ? null : version;
        method = method == null || method.isEmpty() ? null : method;
    }
}
