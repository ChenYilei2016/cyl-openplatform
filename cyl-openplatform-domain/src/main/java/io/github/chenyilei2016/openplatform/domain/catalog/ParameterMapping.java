package io.github.chenyilei2016.openplatform.domain.catalog;

import java.util.Set;

public record ParameterMapping(String target, Source source, String path, Object value, Location location) {
    /** 旧调用方及缺少位置的旧JSON保持按HTTP方法分配的语义。 */
    public ParameterMapping(String target, Source source, String path, Object value) {
        this(target, source, path, value, null);
    }
    public enum Source { REQUEST, FIXED, CONTEXT }
    public enum Location {
        PATH, QUERY, BODY;
        public static Location defaultFor(ApiBinding.Http http) { return http.hasJsonBody() ? BODY : QUERY; }
    }
    public Location effectiveLocation(ApiBinding.Http http) { return location == null ? Location.defaultFor(http) : location; }
    public static final Set<String> CONTEXT_FIELDS = Set.of("applicationId", "appKey", "tenantId", "userId", "employeeId", "employeeNo");
}
