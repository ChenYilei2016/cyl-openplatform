package io.github.chenyilei2016.openplatform.infrastructure.connection.dal.impl;

import io.github.chenyilei2016.openplatform.domain.environmentrelease.ReleaseEnvironment;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import io.github.chenyilei2016.openplatform.domain.common.PageResult;
import io.github.chenyilei2016.openplatform.domain.connection.DubboConnectionRepository.RevisionKey;
import io.github.chenyilei2016.openplatform.domain.connection.DubboConnectionUsageRepository;
import io.github.chenyilei2016.openplatform.infrastructure.connection.dal.mapper.DubboConnectionUsageMapper;
import java.util.LinkedHashSet;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Repository;

@Repository
@RequiredArgsConstructor
public class DubboConnectionUsageRepositoryImpl implements DubboConnectionUsageRepository {
    private final DubboConnectionUsageMapper mapper;
    private final ReleaseEnvironment environment;

    @Override
    public PageResult<Usage> page(String connectionId, int page, int pageSize) {
        int size = Math.clamp(pageSize, 1, 100);
        int number = Math.max(page, 1);
        com.baomidou.mybatisplus.core.metadata.IPage<Usage> result = mapper.usages(environment.environmentId(), new Page<>(number, size), connectionId);
        return new PageResult<>(result.getRecords(), result.getTotal(), number, size);
    }

    @Override public boolean isReferenced(String connectionId, long revision) { return mapper.isReferenced(environment.environmentId(), connectionId, revision); }

    @Override
    public Set<RevisionKey> referencedRevisions(String environmentId, int limit) {
        return new LinkedHashSet<>(mapper.referenced(environmentId, Math.clamp(limit, 1, 101)));
    }
}
