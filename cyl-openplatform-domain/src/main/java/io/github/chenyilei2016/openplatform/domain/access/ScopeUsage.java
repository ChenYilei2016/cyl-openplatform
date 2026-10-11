package io.github.chenyilei2016.openplatform.domain.access;

/** 权限组的引用规模：已发布生效版本携带该组的 API 数、持有该组的凭据数；列表按当前页批量统计。 */
public record ScopeUsage(long apiCount, long credentialCount, long tenantCount) {
    public static final ScopeUsage NONE = new ScopeUsage(0, 0, 0);
}
