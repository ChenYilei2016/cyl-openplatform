package io.github.chenyilei2016.openplatform.domain.common;

import java.util.List;
import java.util.function.Function;

public record PageResult<T>(List<T> items, long total, int page, int pageSize) {
    public PageResult {
        items = List.copyOf(items);
    }

    /** 保持分页信息，逐项转换当前页内容。 */
    public <R> PageResult<R> map(Function<? super T, ? extends R> mapper) {
        return new PageResult<>(items.stream().<R>map(mapper).toList(), total, page, pageSize);
    }
}
