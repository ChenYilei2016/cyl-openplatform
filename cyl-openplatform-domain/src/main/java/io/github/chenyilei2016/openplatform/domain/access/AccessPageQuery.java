package io.github.chenyilei2016.openplatform.domain.access;

import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;

public record AccessPageQuery(int page, int pageSize, String query) {
    public AccessPageQuery {
        if (page < 1 || pageSize < 1 || pageSize > 100 || (long) (page - 1) * pageSize > 100_000 || (query != null && query.length() > 100)) {
            throw new PlatformException(ErrorCode.INVALID_REQUEST, "分页参数不合法");
        }
    }
    public long offset() { return (long) (page - 1) * pageSize; }
}
