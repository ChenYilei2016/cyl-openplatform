package io.github.chenyilei2016.openplatform.domain.portal;

import io.github.chenyilei2016.openplatform.domain.common.PageResult;
import java.util.Optional;

public interface PortalApplicationRepository {
    Optional<PortalApplication> find(String tenantId, String bindingId);
    PageResult<PortalApplication> page(String tenantId, PortalApplicationQuery query);
}
