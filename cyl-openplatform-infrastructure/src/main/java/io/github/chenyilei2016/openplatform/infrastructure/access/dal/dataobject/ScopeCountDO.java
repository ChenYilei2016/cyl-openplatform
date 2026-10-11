package io.github.chenyilei2016.openplatform.infrastructure.access.dal.dataobject;

/** 按权限组代码分组的计数投影。 */
public record ScopeCountDO(String scopeCode, long total) {}
