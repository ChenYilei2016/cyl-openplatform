package io.github.chenyilei2016.openplatform.infrastructure.access.dal.impl;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import io.github.chenyilei2016.openplatform.domain.access.AccessPageQuery;
import io.github.chenyilei2016.openplatform.domain.access.GrantStatus;
import io.github.chenyilei2016.openplatform.domain.access.UserGrant;
import io.github.chenyilei2016.openplatform.domain.access.UserGrantRepository;
import io.github.chenyilei2016.openplatform.domain.common.PageResult;
import io.github.chenyilei2016.openplatform.infrastructure.access.dal.dataobject.UserGrantDO;
import io.github.chenyilei2016.openplatform.infrastructure.access.dal.mapper.UserGrantMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Repository;
import java.util.Optional;

@Repository
@RequiredArgsConstructor
public class UserGrantRepositoryImpl implements UserGrantRepository {
    private final UserGrantMapper mapper;

    @Override
    public Optional<UserGrant> find(String id) {
        return Optional.ofNullable(mapper.selectById(id)).map(UserGrantRepositoryImpl::toDomain);
    }

    @Override
    public Optional<UserGrant> findByEmployee(String tenantGrantId, String employeeId) {
        return Optional.ofNullable(mapper.selectOne(Wrappers.<UserGrantDO>lambdaQuery()
                        .eq(UserGrantDO::getTenantGrantId, tenantGrantId).eq(UserGrantDO::getEmployeeId, employeeId)))
                .map(UserGrantRepositoryImpl::toDomain);
    }

    @Override
    public Optional<UserGrant> findByEmployeeNo(String tenantGrantId, String employeeNo) {
        return Optional.ofNullable(mapper.selectOne(Wrappers.<UserGrantDO>lambdaQuery()
                        .eq(UserGrantDO::getTenantGrantId, tenantGrantId).eq(UserGrantDO::getEmployeeNo, employeeNo)))
                .map(UserGrantRepositoryImpl::toDomain);
    }

    @Override
    public PageResult<UserGrant> page(String tenantGrantId, AccessPageQuery query) {
        var page = mapper.selectPage(new Page<>(query.page(), query.pageSize()), Wrappers.<UserGrantDO>lambdaQuery()
                .eq(UserGrantDO::getTenantGrantId, tenantGrantId)
                .eq(query.query() != null && !query.query().isBlank(), UserGrantDO::getEmployeeNo, query.query() == null ? null : query.query().trim())
                .orderByAsc(UserGrantDO::getEmployeeNo, UserGrantDO::getId));
        return new PageResult<>(page.getRecords().stream().map(UserGrantRepositoryImpl::toDomain).toList(),
                page.getTotal(), query.page(), query.pageSize());
    }

    @Override
    public void create(UserGrant grant) {
        mapper.insert(new UserGrantDO(grant.id(), grant.tenantGrantId(), grant.tenantId(), grant.userId(),
                grant.employeeId(), grant.employeeNo(), grant.displayName(), GrantStatus.ACTIVE.name(), 0L));
    }

    @Override
    public void reactivate(UserGrant grant) {
        var updated = new UserGrantDO();
        updated.setId(grant.id());
        updated.setUserId(grant.userId());
        updated.setEmployeeNo(grant.employeeNo());
        updated.setDisplayName(grant.displayName());
        mapper.reactivate(updated);
    }

    @Override
    public void revoke(String id) {
        mapper.revoke(id);
    }

    @Override
    public void revokeByTenant(String tenantGrantId) {
        mapper.revokeByTenant(tenantGrantId);
    }

    private static UserGrant toDomain(UserGrantDO grant) {
        return new UserGrant(grant.getId(), grant.getTenantGrantId(), grant.getTenantId(), grant.getUserId(),
                grant.getEmployeeId(), grant.getEmployeeNo(), grant.getDisplayName(), GrantStatus.valueOf(grant.getStatus()),
                grant.getAuthorizationVersion());
    }
}
