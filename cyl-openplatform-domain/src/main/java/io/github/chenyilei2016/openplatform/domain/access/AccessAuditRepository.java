package io.github.chenyilei2016.openplatform.domain.access;

import io.github.chenyilei2016.openplatform.domain.common.PageResult;

public interface AccessAuditRepository {
    void append(AccessAudit audit);
    PageResult<AccessAudit> page(String applicationId, AccessPageQuery query);
}
