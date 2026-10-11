package io.github.chenyilei2016.openplatform.infrastructure.observability.dal.impl;

import io.github.chenyilei2016.openplatform.domain.environmentrelease.ReleaseEnvironment;
import io.github.chenyilei2016.openplatform.domain.common.PageResult;
import io.github.chenyilei2016.openplatform.domain.observability.ManagementAudit;
import io.github.chenyilei2016.openplatform.domain.observability.ManagementAuditRepository;
import io.github.chenyilei2016.openplatform.domain.observability.ObservationQuery;
import io.github.chenyilei2016.openplatform.infrastructure.observability.dal.mapper.ManagementAuditMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Repository;

@Repository
@RequiredArgsConstructor
public class ManagementAuditRepositoryImpl implements ManagementAuditRepository {
    private final ReleaseEnvironment environment;
    private final ManagementAuditMapper mapper;

    @Override
    public PageResult<ManagementAudit> page(ObservationQuery query) {
        return new PageResult<>(mapper.page(environment.environmentId(), query), mapper.count(environment.environmentId(), query), query.page(), query.pageSize());
    }
}
