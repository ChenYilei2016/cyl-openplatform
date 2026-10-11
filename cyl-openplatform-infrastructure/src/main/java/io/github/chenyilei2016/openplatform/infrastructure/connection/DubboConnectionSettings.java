package io.github.chenyilei2016.openplatform.infrastructure.connection;

import io.github.chenyilei2016.openplatform.domain.connection.DubboConnectionConfigurationPolicy;

/** 连接客户端的凭据解析边界；领域策略仍只暴露端点校验和引用名称。 */
public interface DubboConnectionSettings extends DubboConnectionConfigurationPolicy {
    Credential resolveCredential(String reference);

    record Credential(String username, String password) {
        @Override public String toString() { return "Credential[redacted]"; }
    }
}
