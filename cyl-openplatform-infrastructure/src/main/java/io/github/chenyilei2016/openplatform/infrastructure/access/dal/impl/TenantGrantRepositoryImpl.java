package io.github.chenyilei2016.openplatform.infrastructure.access.dal.impl;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import io.github.chenyilei2016.openplatform.domain.access.AccessPageQuery;
import io.github.chenyilei2016.openplatform.domain.access.GrantStatus;
import io.github.chenyilei2016.openplatform.domain.access.TenantGrant;
import io.github.chenyilei2016.openplatform.domain.access.TenantGrantRepository;
import io.github.chenyilei2016.openplatform.domain.common.PageResult;
import io.github.chenyilei2016.openplatform.infrastructure.access.dal.dataobject.TenantGrantDO;
import io.github.chenyilei2016.openplatform.infrastructure.access.dal.mapper.TenantGrantMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Repository;
import java.util.Optional;

@Repository
@RequiredArgsConstructor
public class TenantGrantRepositoryImpl implements TenantGrantRepository {
    private final TenantGrantMapper mapper;

    @Override
    public Optional<TenantGrant> find(String id) {
        return Optional.ofNullable(mapper.selectById(id)).map(TenantGrantRepositoryImpl::toDomain);
    }

    @Override
    public Optional<TenantGrant> findByTenant(String applicationId, String tenantId) {
        return Optional.ofNullable(mapper.selectOne(Wrappers.<TenantGrantDO>lambdaQuery()
                        .eq(TenantGrantDO::getApplicationId, applicationId).eq(TenantGrantDO::getTenantId, tenantId)))
                .map(TenantGrantRepositoryImpl::toDomain);
    }

    @Override
    public PageResult<TenantGrant> page(String applicationId, AccessPageQuery query) {
        var page = mapper.selectPage(new Page<>(query.page(), query.pageSize()), Wrappers.<TenantGrantDO>lambdaQuery()
                .eq(TenantGrantDO::getApplicationId, applicationId)
                .eq(query.query() != null && !query.query().isBlank(), TenantGrantDO::getTenantId, query.query() == null ? null : query.query().trim())
                .orderByAsc(TenantGrantDO::getTenantId, TenantGrantDO::getId));
        return new PageResult<>(page.getRecords().stream().map(TenantGrantRepositoryImpl::toDomain).toList(),
                page.getTotal(), query.page(), query.pageSize());
    }

    @Override
    public void create(TenantGrant grant) {
        mapper.insert(new TenantGrantDO(grant.id(), grant.applicationId(), grant.tenantId(), GrantStatus.ACTIVE.name(), 0L, grant.note(), grant.noteRevision()));
    }

    @Override
    public long activeCount(String applicationId) {
        return mapper.selectCount(Wrappers.<TenantGrantDO>lambdaQuery()
                .eq(TenantGrantDO::getApplicationId, applicationId)
                .eq(TenantGrantDO::getStatus, GrantStatus.ACTIVE.name()));
    }

    @Override
    public boolean updateNote(TenantGrant grant, long expectedRevision) {
        return mapper.updateNote(grant.id(), grant.tenantId(), grant.note(), expectedRevision) == 1;
    }

    @Override
    public void reactivate(String id) {
        mapper.reactivate(id);
    }

    @Override
    public void revoke(String id) {
        mapper.revoke(id);
    }

    private static TenantGrant toDomain(TenantGrantDO grant) {
        return new TenantGrant(grant.getId(), grant.getApplicationId(), grant.getTenantId(),
                GrantStatus.valueOf(grant.getStatus()), grant.getAuthorizationVersion(), grant.getNote(), grant.getNoteRevision());
    }
}
