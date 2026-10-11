package io.github.chenyilei2016.openplatform.infrastructure.lifecycle.dal.impl;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import io.github.chenyilei2016.openplatform.domain.access.AccessPageQuery;
import io.github.chenyilei2016.openplatform.domain.access.ApplicationStatus;
import io.github.chenyilei2016.openplatform.domain.common.PageResult;
import io.github.chenyilei2016.openplatform.domain.lifecycle.AffectedApplication;
import io.github.chenyilei2016.openplatform.domain.lifecycle.ApiImpactRepository;
import io.github.chenyilei2016.openplatform.infrastructure.common.SqlPatterns;
import io.github.chenyilei2016.openplatform.infrastructure.lifecycle.dal.mapper.ApiImpactMapper;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Repository;

@Repository
@RequiredArgsConstructor
public class ApiImpactRepositoryImpl implements ApiImpactRepository {
    private final ApiImpactMapper mapper;

    @Override
    public PageResult<AffectedApplication> page(List<String> enabledScopeCodes, AccessPageQuery query) {
        if (enabledScopeCodes.isEmpty()) return new PageResult<>(List.of(), 0, query.page(), query.pageSize());
        var page = mapper.selectApplications(new Page<>(query.page(), query.pageSize()), enabledScopeCodes, SqlPatterns.contains(query.query()));
        if (page.getRecords().isEmpty()) return new PageResult<>(List.of(), page.getTotal(), query.page(), query.pageSize());
        var ids = page.getRecords().stream().map(row -> row.getId()).toList();
        Map<String, List<String>> matched = new HashMap<>();
        mapper.selectMatchedScopes(ids, enabledScopeCodes).forEach(row ->
                matched.computeIfAbsent(row.getApplicationId(), ignored -> new ArrayList<>()).add(row.getScopeCode()));
        Map<String, Long> grantCounts = new HashMap<>();
        mapper.countActiveGrants(ids).forEach(row -> grantCounts.put(row.applicationId(), row.activeTenantGrantCount()));
        var items = page.getRecords().stream().map(row -> new AffectedApplication(row.getId(), row.getName(),
                row.getOwnerTenantId(), ApplicationStatus.valueOf(row.getStatus()), matched.getOrDefault(row.getId(), List.of()),
                grantCounts.getOrDefault(row.getId(), 0L))).toList();
        return new PageResult<>(items, page.getTotal(), query.page(), query.pageSize());
    }
}
