package io.github.chenyilei2016.openplatform.domain.administration;

import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;

public record AdministratorAuditQuery(int page, int pageSize, String administratorId) {
    public AdministratorAuditQuery {
        if (page < 1
                || pageSize < 1
                || pageSize > 100
                || administratorId != null && administratorId.length() > 36) {
            throw new PlatformException(ErrorCode.INVALID_REQUEST, "管理员审计查询参数不合法，单页最多100条");
        }
    }
}
