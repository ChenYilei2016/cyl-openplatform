package io.github.chenyilei2016.openplatform.domain.access;

import io.github.chenyilei2016.openplatform.domain.common.PageResult;
import java.util.Optional;

public interface UserGrantRepository {
    Optional<UserGrant> find(String id);
    Optional<UserGrant> findByEmployee(String tenantGrantId, String employeeId);
    Optional<UserGrant> findByEmployeeNo(String tenantGrantId, String employeeNo);
    PageResult<UserGrant> page(String tenantGrantId, AccessPageQuery query);
    void create(UserGrant grant);
    void reactivate(UserGrant grant);
    void revoke(String id);
    void revokeByTenant(String tenantGrantId);
}
