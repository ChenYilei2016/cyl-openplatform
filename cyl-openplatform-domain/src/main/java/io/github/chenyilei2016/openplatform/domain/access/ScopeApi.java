package io.github.chenyilei2016.openplatform.domain.access;

/**
 * 与权限组相关的 API：API 与权限组的关联保存在 API 草稿的 scopeCodes 中，发布时随版本固化。
 * draftIncluded 表示当前草稿携带该组，liveIncluded 表示已发布生效版本携带该组；两者不同即为待发布的增删。
 */
public record ScopeApi(String id, String name, String service, String version, String method, String protocol,
                       long draftRevision, Long liveDraftRevision, boolean draftIncluded, boolean liveIncluded) {}
