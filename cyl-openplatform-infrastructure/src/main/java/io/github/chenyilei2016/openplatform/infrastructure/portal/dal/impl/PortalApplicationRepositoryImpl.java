package io.github.chenyilei2016.openplatform.infrastructure.portal.dal.impl;

import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import io.github.chenyilei2016.openplatform.domain.access.AccessPageQuery;
import io.github.chenyilei2016.openplatform.domain.access.ApplicationStatus;
import io.github.chenyilei2016.openplatform.domain.access.GrantStatus;
import io.github.chenyilei2016.openplatform.domain.common.PageResult;
import io.github.chenyilei2016.openplatform.domain.portal.PortalApplication;
import io.github.chenyilei2016.openplatform.domain.portal.PortalApplicationQuery;
import io.github.chenyilei2016.openplatform.domain.portal.PortalApplicationRepository;
import io.github.chenyilei2016.openplatform.infrastructure.common.SqlPatterns;
import io.github.chenyilei2016.openplatform.infrastructure.portal.dal.dataobject.PortalApplicationDO;
import io.github.chenyilei2016.openplatform.infrastructure.portal.dal.dataobject.PortalApplicationScopeDO;
import io.github.chenyilei2016.openplatform.infrastructure.portal.dal.mapper.PortalApplicationMapper;
import java.util.Optional;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Repository;

@Repository
@RequiredArgsConstructor
public class PortalApplicationRepositoryImpl implements PortalApplicationRepository {
    private final PortalApplicationMapper mapper;

    @Override
    public Optional<PortalApplication> find(String tenantId, String bindingId) {
        return Optional.ofNullable(mapper.selectApplication(tenantId, bindingId)).map(row -> withScopes(List.of(row)).getFirst());
    }

    private PortalApplication view(PortalApplicationDO row, List<PortalApplication.ScopeSummary> scopes) {
        return new PortalApplication(row.getId(), row.getApplicationId(), row.getAppKey(), row.getName(),
                ApplicationStatus.valueOf(row.getApplicationStatus()), GrantStatus.valueOf(row.getStatus()),
                row.getAuthorizationVersion(), row.getNote(), row.getNoteRevision(), row.getGlobalName(), scopes);
    }

    private List<PortalApplication> withScopes(List<PortalApplicationDO> rows) {
        if (rows.isEmpty()) return List.of();
        Map<String, List<PortalApplication.ScopeSummary>> scopes = mapper.selectScopes(rows.stream()
                .map(PortalApplicationDO::getApplicationId).distinct().toList()).stream()
                .collect(Collectors.groupingBy(PortalApplicationScopeDO::applicationId,
                        Collectors.mapping(scope -> new PortalApplication.ScopeSummary(scope.code(), scope.name(), scope.enabled()), Collectors.toList())));
        return rows.stream().map(row -> view(row, scopes.getOrDefault(row.getApplicationId(), List.of()))).toList();
    }

    @Override
    public PageResult<PortalApplication> page(String tenantId, PortalApplicationQuery query) {
        AccessPageQuery pageQuery = query.pageQuery();
        IPage<PortalApplicationDO> page = mapper.selectApplications(new Page<>(pageQuery.page(), pageQuery.pageSize()),
                tenantId, SqlPatterns.contains(pageQuery.query()), query.appKey(),
                query.name() == null ? null : SqlPatterns.contains(query.name()), query.status() == null ? null : query.status().name());
        return new PageResult<>(withScopes(page.getRecords()),
                page.getTotal(), pageQuery.page(), pageQuery.pageSize());
    }
}
