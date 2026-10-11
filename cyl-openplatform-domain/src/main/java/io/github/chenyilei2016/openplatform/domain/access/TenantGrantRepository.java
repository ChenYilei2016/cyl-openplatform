package io.github.chenyilei2016.openplatform.domain.access;

import io.github.chenyilei2016.openplatform.domain.common.PageResult;
import java.util.Optional;

public interface TenantGrantRepository {
    Optional<TenantGrant> find(String id);
    Optional<TenantGrant> findByTenant(String applicationId, String tenantId);
    PageResult<TenantGrant> page(String applicationId, AccessPageQuery query);
    long activeCount(String applicationId);
    void create(TenantGrant grant);
    boolean updateNote(TenantGrant grant, long expectedRevision);
    void reactivate(String id);
    void revoke(String id);
}
