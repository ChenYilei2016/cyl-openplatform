package io.github.chenyilei2016.openplatform.application.catalog;

import io.github.chenyilei2016.openplatform.application.access.AccessAuditService;
import io.github.chenyilei2016.openplatform.domain.access.AccessOperator;
import io.github.chenyilei2016.openplatform.domain.catalog.*;
import io.github.chenyilei2016.openplatform.domain.common.*;

import lombok.RequiredArgsConstructor;

import org.springframework.stereotype.Service;

import java.util.*;

@Service
@RequiredArgsConstructor
public class ApiCategoryService {
    private final ApiCategoryRepository categories;
    private final AccessAuditService audit;

    public record View(
            String id,
            String name,
            long revision,
            long draftApis,
            long publishedApis,
            long historicalApis,
            boolean enabled) {}

    public PageResult<View> page(CatalogPageQuery query) {
        PageResult<ApiCategory> page = categories.page(query);
        Map<String, ApiCategoryRepository.References> counts =
                categories.references(page.items().stream().map(ApiCategory::id).toList());
        return new PageResult<>(
                page.items().stream()
                        .map(
                                c -> {
                                    ApiCategoryRepository.References r =
                                            counts.getOrDefault(
                                                    c.id(),
                                                    new ApiCategoryRepository.References(0, 0, 0));
                                    return new View(
                                            c.id(),
                                            c.name(),
                                            c.revision(),
                                            r.draftApis(),
                                            r.publishedApis(),
                                            r.historicalApis(),
                                            c.enabled());
                                })
                        .toList(),
                page.total(),
                page.page(),
                page.pageSize());
    }

    public ApiCategory create(String name, AccessOperator operator) {
        String checked = ApiCategory.checkedName(name), id = ObjectIdType.API_CATEGORY.nextId();
        return audit.change(
                "CREATE_API_CATEGORY",
                null,
                null,
                id,
                operator,
                () -> {
                    ApiCategory category = new ApiCategory(id, checked, true, 1);
                    categories.create(category);
                    return category;
                });
    }

    public ApiCategory rename(
            String id, String name, long expectedRevision, AccessOperator operator) {
        String checked = ApiCategory.checkedName(name);
        return audit.change(
                "RENAME_API_CATEGORY",
                null,
                null,
                id,
                operator,
                () -> {
                    ApiCategory current = categories.lock(id);
                    checkRevision(current, expectedRevision);
                    if (current.name().equals(checked)) return current;
                    categories.rename(current, checked);
                    return new ApiCategory(id, checked, true, current.revision() + 1);
                });
    }

    /** 改别名归属即可迁移目录；不改草稿正文、固定发布快照或调用权限。 */
    public void remove(String id, String targetId, long expectedRevision, AccessOperator operator) {
        if (Objects.equals(id, targetId))
            throw new PlatformException(ErrorCode.INVALID_REQUEST, "迁移目标不能是当前分类");
        audit.change(
                targetId == null ? "REMOVE_API_CATEGORY" : "MERGE_API_CATEGORY",
                null,
                null,
                id,
                operator,
                () -> {
                    Map<String, ApiCategory> locked = new HashMap<>();
                    List<String> ids =
                            targetId == null
                                    ? List.of(id)
                                    : List.of(id, targetId).stream().sorted().toList();
                    for (String key : ids) locked.put(key, categories.lock(key));
                    ApiCategory source = locked.get(id);
                    checkRevision(source, expectedRevision);
                    if (targetId == null
                            && categories
                                    .references(List.of(id))
                                    .getOrDefault(id, new ApiCategoryRepository.References(0, 0, 0))
                                    .used())
                        throw new PlatformException(
                                ErrorCode.CONFLICT, "分类仍被接口、发布或历史修订引用，请先选择迁移目标");
                    categories.remove(source, locked.get(targetId));
                    return null;
                });
    }

    public View find(String id) {
        ApiCategory category = categories.find(id);
        ApiCategoryRepository.References usage =
                categories
                        .references(List.of(id))
                        .getOrDefault(id, new ApiCategoryRepository.References(0, 0, 0));
        return new View(
                id,
                category.name(),
                category.revision(),
                usage.draftApis(),
                usage.publishedApis(),
                usage.historicalApis(),
                category.enabled());
    }

    public String displayName(String name) {
        return categories.displayName(name);
    }

    private void checkRevision(ApiCategory category, long expected) {
        if (expected != category.revision())
            throw new PlatformException(ErrorCode.CONFLICT, "分类已被修改，请刷新核对后重试");
    }
}
