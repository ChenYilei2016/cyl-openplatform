package io.github.chenyilei2016.openplatform.domain.access;

import java.util.Set;

/** 独立管理条件；旧query搜索保留给现有选择器。 */
public record ScopeFilter(String code, String name, Set<Boolean> enabled, Set<Boolean> defaultForNewApplication) {
    public ScopeFilter {
        enabled = enabled == null ? Set.of() : Set.copyOf(enabled);
        defaultForNewApplication = defaultForNewApplication == null ? Set.of() : Set.copyOf(defaultForNewApplication);
    }
}
