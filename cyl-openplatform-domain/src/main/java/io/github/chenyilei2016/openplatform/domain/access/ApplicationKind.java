package io.github.chenyilei2016.openplatform.domain.access;

/**
 * 凭据类型决定可进入的入口：STANDARD 走 Token、普通签名与门户绑定；
 * MCP_GATEWAY 是每环境唯一的MCP 网关凭据，只能进入 MCP 入口，不配置权限组、不绑定租户。
 */
public enum ApplicationKind {
    STANDARD, MCP_GATEWAY
}
