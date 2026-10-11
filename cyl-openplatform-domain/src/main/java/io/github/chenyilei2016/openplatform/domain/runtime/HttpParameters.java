package io.github.chenyilei2016.openplatform.domain.runtime;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

/** 三个位置分别保留，同名值不能在准备或发送时互相覆盖。 */
public record HttpParameters(Map<String, Object> path, Map<String, Object> query, Map<String, Object> body) {
    public HttpParameters {
        path = snapshot(path);
        query = snapshot(query);
        body = snapshot(body);
    }

    private static Map<String, Object> snapshot(Map<String, Object> values) {
        return Collections.unmodifiableMap(new LinkedHashMap<>(values));
    }
}
