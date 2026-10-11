package io.github.chenyilei2016.openplatform.infrastructure.access.dal.impl;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import io.github.chenyilei2016.openplatform.domain.access.AccessPageQuery;
import io.github.chenyilei2016.openplatform.domain.access.GrantStatus;
import io.github.chenyilei2016.openplatform.domain.access.Scope;
import io.github.chenyilei2016.openplatform.domain.access.TenantPermissionSummary;
import io.github.chenyilei2016.openplatform.domain.access.TenantScopePermission;
import io.github.chenyilei2016.openplatform.infrastructure.common.SqlPatterns;
import io.github.chenyilei2016.openplatform.infrastructure.access.dal.dataobject.TenantScopePermissionDO;
import com.baomidou.mybatisplus.core.metadata.IPage;
import io.github.chenyilei2016.openplatform.domain.access.TenantScopeGrant;
import io.github.chenyilei2016.openplatform.domain.access.TenantScopeGrantRepository;
import io.github.chenyilei2016.openplatform.domain.common.PageResult;
import io.github.chenyilei2016.openplatform.infrastructure.access.dal.dataobject.TenantScopeGrantDO;
import io.github.chenyilei2016.openplatform.infrastructure.access.dal.mapper.TenantScopeGrantMapper;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Repository;

@Repository
@RequiredArgsConstructor
public class TenantScopeGrantRepositoryImpl implements TenantScopeGrantRepository {
    private final TenantScopeGrantMapper mapper;

    @Override
    public Optional<TenantScopeGrant> find(String id) {
        return Optional.ofNullable(mapper.selectById(id)).map(TenantScopeGrantRepositoryImpl::toDomain);
    }

    @Override
    public Optional<TenantScopeGrant> findByTenant(String scopeCode, String tenantId) {
        return Optional.ofNullable(mapper.selectOne(Wrappers.<TenantScopeGrantDO>lambdaQuery()
                        .eq(TenantScopeGrantDO::getScopeCode, scopeCode).eq(TenantScopeGrantDO::getTenantId, tenantId)))
                .map(TenantScopeGrantRepositoryImpl::toDomain);
    }

    @Override
    public PageResult<TenantScopeGrant> page(String scopeCode, AccessPageQuery query) {
        String tenantId = query.query() == null ? null : query.query().strip();
        var page = mapper.selectPage(new Page<>(query.page(), query.pageSize()), Wrappers.<TenantScopeGrantDO>lambdaQuery()
                .eq(TenantScopeGrantDO::getScopeCode, scopeCode)
                .eq(tenantId != null && !tenantId.isEmpty(), TenantScopeGrantDO::getTenantId, tenantId)
                // 'ACTIVE' < 'REVOKED'：有效记录在前。
                .orderByAsc(TenantScopeGrantDO::getStatus)
                .orderByDesc(TenantScopeGrantDO::getUpdatedAt, TenantScopeGrantDO::getId));
        return new PageResult<>(page.getRecords().stream().map(TenantScopeGrantRepositoryImpl::toDomain).toList(),
                page.getTotal(), query.page(), query.pageSize());
    }

    @Override
    public PageResult<TenantPermissionSummary> tenants(AccessPageQuery query) {
        String tenantId = query.query() == null || query.query().isBlank() ? null : query.query().strip();
        IPage<TenantPermissionSummary> page = mapper.selectTenants(new Page<>(query.page(), query.pageSize(), false), tenantId);
        return new PageResult<>(page.getRecords(), mapper.countManagedTenants(tenantId), query.page(), query.pageSize());
    }

    @Override
    public PageResult<TenantScopePermission> permissions(String tenantId, AccessPageQuery query, TenantScopePermission.Filter filter) {
        IPage<TenantScopePermissionDO> page = mapper.selectPermissions(new Page<>(query.page(), query.pageSize()), tenantId, SqlPatterns.contains(query.query()), filter);
        return new PageResult<>(page.getRecords().stream().map(row -> new TenantScopePermission(
                new Scope(row.getId(), row.getCode(), row.getName(), Boolean.TRUE.equals(row.getEnabled()),
                        Boolean.TRUE.equals(row.getDefaultForNewApplication()), Boolean.TRUE.equals(row.getPublicAccess())),
                row.getGrantId(), row.getGrantStatus() == null ? null : GrantStatus.valueOf(row.getGrantStatus()))).toList(),
                page.getTotal(), query.page(), query.pageSize());
    }

    @Override
    public void create(TenantScopeGrant grant) {
        mapper.insert(new TenantScopeGrantDO(grant.id(), grant.tenantId(), grant.scopeCode(), grant.status().name(),
                grant.grantedByTenantId(), grant.grantedByEmployeeNo(), grant.createdAt(), grant.updatedAt(), grant.revision()));
    }

    @Override
    public boolean changeStatus(TenantScopeGrant grant, long expectedRevision) {
        return mapper.update(null, Wrappers.<TenantScopeGrantDO>lambdaUpdate()
                .eq(TenantScopeGrantDO::getId, grant.id()).eq(TenantScopeGrantDO::getRevision, expectedRevision)
                .set(TenantScopeGrantDO::getStatus, grant.status().name())
                .set(TenantScopeGrantDO::getGrantedByTenantId, grant.grantedByTenantId())
                .set(TenantScopeGrantDO::getGrantedByEmployeeNo, grant.grantedByEmployeeNo())
                .set(TenantScopeGrantDO::getUpdatedAt, grant.updatedAt())
                .set(TenantScopeGrantDO::getRevision, grant.revision())) == 1;
    }

    @Override
    public Set<String> availableScopeCodes(String tenantId, List<String> candidates) {
        return Collections.unmodifiableSet(new LinkedHashSet<>(mapper.selectAvailableScopeCodes(tenantId, candidates)));
    }

    private static TenantScopeGrant toDomain(TenantScopeGrantDO grant) {
        return new TenantScopeGrant(grant.getId(), grant.getTenantId(), grant.getScopeCode(), GrantStatus.valueOf(grant.getStatus()),
                grant.getGrantedByTenantId(), grant.getGrantedByEmployeeNo(), grant.getCreatedAt(), grant.getUpdatedAt(),
                grant.getRevision());
    }
}
