package io.github.chenyilei2016.openplatform.infrastructure.access.dal.impl;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import io.github.chenyilei2016.openplatform.domain.access.AccessPageQuery;
import io.github.chenyilei2016.openplatform.domain.access.CallableGrant;
import io.github.chenyilei2016.openplatform.domain.access.DebugIdentityRepository;
import io.github.chenyilei2016.openplatform.domain.access.GrantStatus;
import io.github.chenyilei2016.openplatform.domain.access.UserGrant;
import io.github.chenyilei2016.openplatform.domain.common.PageResult;
import io.github.chenyilei2016.openplatform.infrastructure.access.dal.dataobject.CallableGrantDO;
import io.github.chenyilei2016.openplatform.infrastructure.access.dal.dataobject.UserGrantDO;
import io.github.chenyilei2016.openplatform.infrastructure.access.dal.mapper.DebugIdentityMapper;
import io.github.chenyilei2016.openplatform.infrastructure.access.dal.mapper.UserGrantMapper;
import io.github.chenyilei2016.openplatform.infrastructure.common.SqlPatterns;
import java.util.Collection;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Repository;

@Repository
@RequiredArgsConstructor
public class DebugIdentityRepositoryImpl implements DebugIdentityRepository {
    private final DebugIdentityMapper mapper;
    private final UserGrantMapper users;

    @Override
    public PageResult<CallableGrant> callableGrants(Collection<String> scopeCodes, AccessPageQuery query) {
        if (scopeCodes.isEmpty()) return new PageResult<>(List.of(), 0, query.page(), query.pageSize());
        var page = mapper.selectCallable(new Page<>(query.page(), query.pageSize()), scopeCodes, SqlPatterns.contains(query.query()));
        return new PageResult<>(page.getRecords().stream().map(DebugIdentityRepositoryImpl::toDomain).toList(),
                page.getTotal(), query.page(), query.pageSize());
    }

    @Override
    public PageResult<UserGrant> activeUsers(String tenantGrantId, AccessPageQuery query) {
        String text = query.query() == null ? "" : query.query().trim();
        var page = users.selectPage(new Page<>(query.page(), query.pageSize()), Wrappers.<UserGrantDO>lambdaQuery()
                .eq(UserGrantDO::getTenantGrantId, tenantGrantId)
                .eq(UserGrantDO::getStatus, GrantStatus.ACTIVE.name())
                .and(!text.isEmpty(), condition -> condition.like(UserGrantDO::getEmployeeNo, text).or().like(UserGrantDO::getDisplayName, text))
                .orderByAsc(UserGrantDO::getEmployeeNo, UserGrantDO::getId));
        return new PageResult<>(page.getRecords().stream().map(grant -> new UserGrant(grant.getId(), grant.getTenantGrantId(),
                grant.getTenantId(), grant.getUserId(), grant.getEmployeeId(), grant.getEmployeeNo(), grant.getDisplayName(),
                GrantStatus.valueOf(grant.getStatus()), grant.getAuthorizationVersion())).toList(), page.getTotal(), query.page(), query.pageSize());
    }

    private static CallableGrant toDomain(CallableGrantDO row) {
        return new CallableGrant(row.getApplicationId(), row.getApplicationName(), row.getAppKey(),
                row.getTenantGrantId(), row.getTenantId(), row.getNote());
    }
}
