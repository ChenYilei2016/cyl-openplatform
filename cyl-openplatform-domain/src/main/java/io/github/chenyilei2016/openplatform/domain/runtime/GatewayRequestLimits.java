package io.github.chenyilei2016.openplatform.domain.runtime;

/** 网关原始请求读取边界，不影响管理接口的JSON契约上限。 */
public record GatewayRequestLimits(int maxRequestBytes) {}
