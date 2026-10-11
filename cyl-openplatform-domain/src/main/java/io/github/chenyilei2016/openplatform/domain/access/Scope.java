package io.github.chenyilei2016.openplatform.domain.access;

/**
 * 权限组。enabled 决定持有此组的凭据能否调用；defaultForNewApplication 只在创建凭据时复制给新凭据；
 * publicAccess（公共通用）动态生效：启用期间所有租户在 MCP 工具与门户展示中可用，关闭即收回，不复制到凭据，也不改变普通凭据调用判断。
 */
public record Scope(String id, String code, String name, boolean enabled, boolean defaultForNewApplication,
                    boolean publicAccess) {}
