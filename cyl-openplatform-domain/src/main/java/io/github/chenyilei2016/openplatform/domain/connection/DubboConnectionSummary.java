package io.github.chenyilei2016.openplatform.domain.connection;

import io.github.chenyilei2016.openplatform.domain.connection.DubboConnectionConfig.DiscoveryMode;
import io.github.chenyilei2016.openplatform.domain.connection.DubboConnectionConfig.MetadataType;
import io.github.chenyilei2016.openplatform.domain.connection.DubboConnectionConfig.ProviderMetadataMode;
import java.time.Instant;

/** 安全分页摘要；类型来自当前可选修订，无可选修订时来自草稿。 */
public record DubboConnectionSummary(String id, String name, String environmentId, String description,
                                     long draftRevision, Long activeRevision, boolean enabled,
                                     long stateVersion, Instant updatedAt, MetadataType metadataType,
                                     DiscoveryMode discoveryMode, ProviderMetadataMode providerMetadataMode,
                                     DubboConnectionRuntime.DiagnosticResult registryCheck) {
    public DubboConnectionSummary withRegistryCheck(DubboConnectionRuntime.DiagnosticResult check) {
        return new DubboConnectionSummary(id, name, environmentId, description, draftRevision, activeRevision, enabled,
                stateVersion, updatedAt, metadataType, discoveryMode, providerMetadataMode, check);
    }
}
