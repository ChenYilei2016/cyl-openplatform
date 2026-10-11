package io.github.chenyilei2016.openplatform.infrastructure.access.dal.impl;

import io.github.chenyilei2016.openplatform.domain.environmentrelease.ReleaseEnvironment;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import io.github.chenyilei2016.openplatform.infrastructure.common.SqlPatterns;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import io.github.chenyilei2016.openplatform.domain.access.AccessPageQuery;
import io.github.chenyilei2016.openplatform.domain.access.Scope;
import io.github.chenyilei2016.openplatform.domain.access.ScopeApi;
import io.github.chenyilei2016.openplatform.domain.access.ScopeUsage;
import io.github.chenyilei2016.openplatform.domain.access.ScopeFilter;
import io.github.chenyilei2016.openplatform.domain.access.ScopeRepository;
import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PageResult;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.github.chenyilei2016.openplatform.infrastructure.access.dal.dataobject.ScopeDO;
import io.github.chenyilei2016.openplatform.infrastructure.access.dal.mapper.ScopeMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Repository;
import io.github.chenyilei2016.openplatform.infrastructure.access.dal.dataobject.ScopeCountDO;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Repository
@RequiredArgsConstructor
public class ScopeRepositoryImpl implements ScopeRepository {
    private final ReleaseEnvironment environment;
    private final ScopeMapper mapper;

    @Override
    public PageResult<Scope> page(AccessPageQuery query, ScopeFilter filter) {
        var page = mapper.selectByQuery(new Page<>(query.page(), query.pageSize()), SqlPatterns.contains(query.query()), filter, SqlPatterns.contains(filter.name()));
        return new PageResult<>(page.getRecords().stream().map(ScopeRepositoryImpl::toDomain).toList(),
                page.getTotal(), query.page(), query.pageSize());
    }

    @Override
    public Map<String, ScopeUsage> usage(List<String> codes) {
        if (codes.isEmpty()) return Map.of();
        Map<String, Long> apis = new HashMap<>();
        for (ScopeCountDO row : mapper.countLiveApis(environment.environmentId(), codes)) apis.put(row.scopeCode(), row.total());
        Map<String, Long> applications = new HashMap<>();
        for (ScopeCountDO row : mapper.countApplications(codes)) applications.put(row.scopeCode(), row.total());
        Map<String, Long> tenants = new HashMap<>();
        for (ScopeCountDO row : mapper.countTenants(codes)) tenants.put(row.scopeCode(), row.total());
        Map<String, ScopeUsage> usage = new HashMap<>();
        for (String code : codes)
            if (apis.containsKey(code) || applications.containsKey(code) || tenants.containsKey(code))
                usage.put(code, new ScopeUsage(apis.getOrDefault(code, 0L), applications.getOrDefault(code, 0L), tenants.getOrDefault(code, 0L)));
        return usage;
    }

    @Override
    public PageResult<ScopeApi> apis(String code, AccessPageQuery query) {
        var page = mapper.selectApis(environment.environmentId(), new Page<>(query.page(), query.pageSize()), code, "\"" + code + "\"",
                SqlPatterns.contains(query.query()));
        return new PageResult<>(page.getRecords().stream().map(row -> new ScopeApi(row.getId(), row.getName(), row.getService(),
                        row.getVersion(), row.getMethod(), row.getProtocol(), row.getDraftRevision(), row.getLiveDraftRevision(),
                        Boolean.TRUE.equals(row.getDraftIncluded()), Boolean.TRUE.equals(row.getLiveIncluded()))).toList(),
                page.getTotal(), query.page(), query.pageSize());
    }

    @Override
    public Scope find(String id) {
        ScopeDO scope = mapper.selectById(id);
        if (scope == null) throw new PlatformException(ErrorCode.NOT_FOUND, "权限组不存在");
        return toDomain(scope);
    }

    @Override
    public Scope lock(String id) {
        ScopeDO scope = mapper.selectForUpdate(id);
        if (scope == null) throw new PlatformException(ErrorCode.NOT_FOUND, "权限组不存在");
        return toDomain(scope);
    }

    @Override
    public List<String> defaultCodes() {
        return mapper.selectDefaultCodesForUpdate();
    }

    @Override
    public List<String> enabledCodes(List<String> codes) {
        if (codes.isEmpty()) return List.of();
        return mapper.selectList(Wrappers.<ScopeDO>lambdaQuery().select(ScopeDO::getCode)
                        .in(ScopeDO::getCode, codes).eq(ScopeDO::getEnabled, true).orderByAsc(ScopeDO::getCode))
                .stream().map(ScopeDO::getCode).toList();
    }

    @Override
    public List<Scope> findByCodes(List<String> codes) {
        if (codes.isEmpty()) return List.of();
        return mapper.selectList(Wrappers.<ScopeDO>lambdaQuery()
                        .in(ScopeDO::getCode, codes).orderByAsc(ScopeDO::getCode))
                .stream().map(ScopeRepositoryImpl::toDomain).toList();
    }

    @Override
    public void create(Scope scope) {
        mapper.insert(new ScopeDO(scope.id(), scope.code(), scope.name(), scope.enabled(), scope.defaultForNewApplication(), scope.publicAccess()));
    }

    @Override
    public void update(Scope scope) {
        mapper.update(null, Wrappers.<ScopeDO>lambdaUpdate().eq(ScopeDO::getId, scope.id())
                .set(ScopeDO::getName, scope.name()).set(ScopeDO::getEnabled, scope.enabled())
                .set(ScopeDO::getDefaultForNewApplication, scope.defaultForNewApplication())
                .set(ScopeDO::getPublicAccess, scope.publicAccess()));
    }

    @Override
    public boolean allEnabled(List<String> codes) {
        return codes.isEmpty() || mapper.selectEnabledCodesForUpdate(codes).size() == codes.size();
    }

    private static Scope toDomain(ScopeDO scope) {
        return new Scope(scope.getId(), scope.getCode(), scope.getName(), scope.getEnabled(), scope.getDefaultForNewApplication(),
                Boolean.TRUE.equals(scope.getPublicAccess()));
    }
}
