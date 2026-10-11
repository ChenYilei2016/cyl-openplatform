package io.github.chenyilei2016.openplatform.domain.connection;

import java.util.List;

/** 连接配置与中心凭据引用边界；应用层不读取配置中的真实凭据。 */
public interface DubboConnectionConfigurationPolicy {
    void validateConfiguration(DubboConnectionConfig config);
    List<String> registryCredentialRefs();
    List<String> metadataCredentialRefs();
}
