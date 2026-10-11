package io.github.chenyilei2016.openplatform.domain.catalog;

/** 全局搜索命中的 API 标识投影，不含定义正文。 */
public record ApiSearchHit(String id, String name, String service, String version, String method,
                           String internalClass, String internalMethod) {}
