package io.github.chenyilei2016.openplatform.infrastructure.catalog.dal.impl;

import io.github.chenyilei2016.openplatform.domain.environmentrelease.ReleaseEnvironment;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiRevision;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiRevisionRepository;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiRevisionSummary;
import io.github.chenyilei2016.openplatform.domain.catalog.CatalogPageQuery;
import io.github.chenyilei2016.openplatform.domain.common.PageResult;
import io.github.chenyilei2016.openplatform.infrastructure.catalog.ApiDefinitionJson;
import io.github.chenyilei2016.openplatform.infrastructure.catalog.dal.dataobject.ApiRevisionDO;
import io.github.chenyilei2016.openplatform.infrastructure.catalog.dal.mapper.ApiRevisionMapper;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Repository;

@Repository
@RequiredArgsConstructor
public class ApiRevisionRepositoryImpl implements ApiRevisionRepository {
    private final ReleaseEnvironment environment;
    private final ApiRevisionMapper revisions;
    private final ApiDefinitionJson json;

    @Override public boolean apiExists(String apiId) { return revisions.countApi(environment.environmentId(), apiId) > 0; }

    @Override
    public PageResult<ApiRevisionSummary> page(String apiId, CatalogPageQuery query) {
        IPage<ApiRevisionDO> result = revisions.selectSummaries(environment.environmentId(), new Page<>(query.page(), query.pageSize()), apiId);
        return new PageResult<>(result.getRecords().stream().map(ApiRevisionDO::summary).toList(),
                result.getTotal(), query.page(), query.pageSize());
    }

    @Override
    public Optional<ApiRevision> find(String apiId, long revision) {
        return Optional.ofNullable(revisions.selectRevision(environment.environmentId(), apiId, revision))
                .map(value -> new ApiRevision(value.summary(), json.decode(value.getSnapshotJson())));
    }
}
