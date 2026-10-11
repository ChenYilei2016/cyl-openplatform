package io.github.chenyilei2016.openplatform.infrastructure.mcp.dal.impl;

import io.github.chenyilei2016.openplatform.domain.environmentrelease.ReleaseEnvironment;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import io.github.chenyilei2016.openplatform.domain.catalog.CatalogPageQuery;
import io.github.chenyilei2016.openplatform.domain.common.PageResult;
import io.github.chenyilei2016.openplatform.domain.mcp.McpToolSet;
import io.github.chenyilei2016.openplatform.domain.mcp.McpToolSetRepository;
import io.github.chenyilei2016.openplatform.infrastructure.common.SqlPatterns;
import io.github.chenyilei2016.openplatform.infrastructure.mcp.dal.dataobject.McpToolSetDO;
import io.github.chenyilei2016.openplatform.infrastructure.mcp.dal.mapper.McpToolSetMapper;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Repository;

@Repository
@RequiredArgsConstructor
public class McpToolSetRepositoryImpl implements McpToolSetRepository {
    private final ReleaseEnvironment environment;
    private final McpToolSetMapper mapper;

    @Override public PageResult<McpToolSet> page(CatalogPageQuery query) {
        Page<McpToolSetDO> page = mapper.selectPage(new Page<>(query.page(), query.pageSize()),
                Wrappers.<McpToolSetDO>lambdaQuery().eq(McpToolSetDO::getEnvironmentId, environment.environmentId()).and(where -> where
                        .apply("name LIKE {0} ESCAPE '!' OR code LIKE {0} ESCAPE '!'", SqlPatterns.contains(query.query())))
                        .orderByAsc(McpToolSetDO::getName, McpToolSetDO::getId));
        return new PageResult<>(page.getRecords().stream().map(McpToolSetRepositoryImpl::domain).toList(), page.getTotal(), query.page(), query.pageSize());
    }
    @Override public Optional<McpToolSet> find(String id) { return Optional.ofNullable(mapper.selectOne(Wrappers.<McpToolSetDO>lambdaQuery().eq(McpToolSetDO::getEnvironmentId, environment.environmentId()).eq(McpToolSetDO::getId, id))).map(McpToolSetRepositoryImpl::domain); }
    @Override public Optional<McpToolSet> findByCode(String code) {
        return Optional.ofNullable(mapper.selectOne(Wrappers.<McpToolSetDO>lambdaQuery().eq(McpToolSetDO::getEnvironmentId, environment.environmentId()).eq(McpToolSetDO::getCode, code))).map(McpToolSetRepositoryImpl::domain);
    }
    @Override public Optional<McpToolSet> lock(String id) { return Optional.ofNullable(mapper.lock(environment.environmentId(), id)).map(McpToolSetRepositoryImpl::domain); }
    @Override public void create(McpToolSet set) {
        mapper.insert(new McpToolSetDO(environment.environmentId(), set.id(), set.code(), set.name(), set.description(), set.enabled(), set.revision()));
    }
    @Override public boolean update(McpToolSet set, long expectedRevision) {
        return mapper.update(null, Wrappers.<McpToolSetDO>lambdaUpdate().eq(McpToolSetDO::getEnvironmentId, environment.environmentId()).eq(McpToolSetDO::getId, set.id()).eq(McpToolSetDO::getRevision, expectedRevision)
                .set(McpToolSetDO::getName, set.name()).set(McpToolSetDO::getDescription, set.description())
                .set(McpToolSetDO::getEnabled, set.enabled()).set(McpToolSetDO::getRevision, set.revision())) == 1;
    }
    @Override public boolean delete(String id, long expectedRevision) {
        return mapper.delete(Wrappers.<McpToolSetDO>lambdaQuery().eq(McpToolSetDO::getEnvironmentId, environment.environmentId()).eq(McpToolSetDO::getId, id).eq(McpToolSetDO::getRevision, expectedRevision)) == 1;
    }
    @Override public List<String> members(String id) {
        List<String> members = mapper.members(environment.environmentId(), id);
        if (members.size() > 200) throw new IllegalStateException("工具集成员超出200项，请核对存储状态");
        return members;
    }
    @Override public void replaceMembers(String id, List<String> apiIds) {
        mapper.deleteMembers(environment.environmentId(), id);
        if (!apiIds.isEmpty()) mapper.insertMembers(environment.environmentId(), id, apiIds);
    }
    private static McpToolSet domain(McpToolSetDO row) {
        return new McpToolSet(row.getId(), row.getCode(), row.getName(), row.getDescription(), row.getEnabled(), row.getRevision());
    }
}
