package io.github.chenyilei2016.openplatform.domain.access;

/** 租户视角的权限组。直接授予记录与最终可用性分开，公共通用不伪造授予记录。 */
public record TenantScopePermission(Scope scope, String grantId, GrantStatus grantStatus) {
    public boolean directlyGranted() { return grantStatus == GrantStatus.ACTIVE; }
    public boolean available() { return scope.enabled() && (scope.publicAccess() || directlyGranted()); }
    public enum Filter { ALL, DIRECT, PUBLIC, UNGRANTED }
}
