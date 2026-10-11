package io.github.chenyilei2016.openplatform.domain.catalog;

import io.github.chenyilei2016.openplatform.domain.common.PageResult;

import java.util.Collection;
import java.util.Map;
import java.util.Set;

public interface ApiCategoryRepository {
    record References(long draftApis, long publishedApis, long historicalApis) {
        public boolean used() {
            return draftApis > 0 || publishedApis > 0 || historicalApis > 0;
        }
    }

    PageResult<ApiCategory> page(CatalogPageQuery query);

    String displayName(String name);

    ApiCategory find(String id);

    ApiCategory lock(String id);

    Map<String, References> references(Collection<String> ids);

    void create(ApiCategory category);

    void rename(ApiCategory category, String name);

    void remove(ApiCategory source, ApiCategory target);

    Set<String> availableNames(Collection<String> names, boolean lock);
}
