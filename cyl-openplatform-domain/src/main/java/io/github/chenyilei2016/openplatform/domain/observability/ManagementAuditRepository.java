package io.github.chenyilei2016.openplatform.domain.observability;

import io.github.chenyilei2016.openplatform.domain.common.PageResult;

public interface ManagementAuditRepository {
    PageResult<ManagementAudit> page(ObservationQuery query);
}
