package io.github.chenyilei2016.openplatform.domain.access;

/** 应用、租户关联和人员委托的撤销版本，用于核对一次授权期间的变化。 */
public record AuthorizationVersions(long application, long tenant, long user) {}
