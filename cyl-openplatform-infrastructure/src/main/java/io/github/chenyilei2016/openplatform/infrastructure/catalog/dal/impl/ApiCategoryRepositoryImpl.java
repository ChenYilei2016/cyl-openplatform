package io.github.chenyilei2016.openplatform.infrastructure.catalog.dal.impl;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import io.github.chenyilei2016.openplatform.domain.catalog.*;
import io.github.chenyilei2016.openplatform.domain.common.*;
import io.github.chenyilei2016.openplatform.infrastructure.catalog.dal.dataobject.ApiCategoryDO;
import io.github.chenyilei2016.openplatform.infrastructure.catalog.dal.mapper.ApiCategoryMapper;
import io.github.chenyilei2016.openplatform.infrastructure.common.SqlPatterns;

import lombok.RequiredArgsConstructor;

import org.springframework.stereotype.Repository;

import java.util.*;
import java.util.stream.Collectors;

@Repository
@RequiredArgsConstructor
public class ApiCategoryRepositoryImpl implements ApiCategoryRepository {
    private final ApiCategoryMapper mapper;

    @Override
    public PageResult<ApiCategory> page(CatalogPageQuery query) {
        Page<ApiCategoryDO> page =
                mapper.selectPage(
                        new Page<>(query.page(), query.pageSize()),
                        Wrappers.<ApiCategoryDO>lambdaQuery()
                                .eq(ApiCategoryDO::getEnabled, true)
                                .apply(
                                        "name LIKE {0} ESCAPE '!'",
                                        SqlPatterns.contains(query.query()))
                                .orderByAsc(ApiCategoryDO::getName, ApiCategoryDO::getId));
        return new PageResult<>(
                page.getRecords().stream().map(ApiCategoryRepositoryImpl::view).toList(),
                page.getTotal(),
                query.page(),
                query.pageSize());
    }

    @Override
    public String displayName(String name) {
        String display = mapper.displayName(name);
        return display == null ? name : display;
    }

    @Override
    public ApiCategory find(String id) {
        ApiCategoryDO row = mapper.selectById(id);
        if (row == null) throw new PlatformException(ErrorCode.NOT_FOUND, "分类不存在");
        return view(row);
    }

    @Override
    public ApiCategory lock(String id) {
        ApiCategoryDO row = mapper.lock(id);
        if (row == null || !row.getEnabled())
            throw new PlatformException(ErrorCode.NOT_FOUND, "分类不存在或已移除");
        return view(row);
    }

    @Override
    public Map<String, References> references(Collection<String> ids) {
        if (ids.isEmpty()) return Map.of();
        if (ids.size() > 100) throw new IllegalArgumentException("分类引用查询最多100项");
        return mapper.references(ids).stream()
                .collect(
                        Collectors.toMap(
                                ApiCategoryMapper.ReferenceCount::id,
                                row ->
                                        new References(
                                                row.draftApis(),
                                                row.publishedApis(),
                                                row.historicalApis())));
    }

    private void reserveAlias(String name, String id) {
        String existing = mapper.alias(name);
        if (existing == null) mapper.addAlias(name, id);
        else if (!existing.equals(id))
            throw FieldValidation.invalid("/name", FieldValidation.Reason.INVALID_VALUE,
                    "分类名称已存在或已用于其他分类，请选择不同名称");
    }

    @Override
    public void create(ApiCategory category) {
        mapper.insert(new ApiCategoryDO(category.id(), category.name(), true, category.revision()));
        reserveAlias(category.name(), category.id());
    }

    @Override
    public void rename(ApiCategory category, String name) {
        reserveAlias(name, category.id());
        mapper.update(
                null,
                Wrappers.<ApiCategoryDO>lambdaUpdate()
                        .eq(ApiCategoryDO::getId, category.id())
                        .set(ApiCategoryDO::getName, name)
                        .set(ApiCategoryDO::getRevision, category.revision() + 1));
    }

    @Override
    public void remove(ApiCategory source, ApiCategory target) {
        if (target != null) mapper.moveAliases(source.id(), target.id());
        // 无草稿、发布或历史引用的删除释放名称，用户可以重新创建；合并仍保留解析关系。
        else mapper.releaseUnusedNames(source.id());
        mapper.update(
                null,
                Wrappers.<ApiCategoryDO>lambdaUpdate()
                        .eq(ApiCategoryDO::getId, source.id())
                        .set(ApiCategoryDO::getEnabled, false)
                        .set(ApiCategoryDO::getRevision, source.revision() + 1));
    }

    @Override
    public Set<String> availableNames(Collection<String> names, boolean lock) {
        if (names.isEmpty()) return Set.of();
        if (names.size() > 100) throw new IllegalArgumentException("分类校验最多100项");
        List<ApiCategoryMapper.Alias> aliases = mapper.aliases(names);
        if (lock && !aliases.isEmpty()) {
            // 分类管理与所有草稿写入只锁分类父行；不依赖 JOIN 的执行计划决定锁顺序。
            Map<String, Boolean> enabled =
                    mapper
                            .lockAll(
                                    aliases.stream()
                                            .map(ApiCategoryMapper.Alias::categoryId)
                                            .distinct()
                                            .sorted()
                                            .toList())
                            .stream()
                            .collect(
                                    Collectors.toMap(
                                            ApiCategoryDO::getId, ApiCategoryDO::getEnabled));
            // 合并会先停用原分类；若读取后发生迁移，要求调用方刷新，不能使用旧的 MVCC 别名映射。
            return aliases.stream()
                    .filter(alias -> Boolean.TRUE.equals(enabled.get(alias.categoryId())))
                    .map(ApiCategoryMapper.Alias::categoryKey)
                    .collect(Collectors.toSet());
        }
        return aliases.stream()
                .filter(ApiCategoryMapper.Alias::enabled)
                .map(ApiCategoryMapper.Alias::categoryKey)
                .collect(Collectors.toSet());
    }

    private static ApiCategory view(ApiCategoryDO row) {
        return new ApiCategory(row.getId(), row.getName(), row.getEnabled(), row.getRevision());
    }
}
