package io.github.chenyilei2016.openplatform.domain.documentation;

import io.github.chenyilei2016.openplatform.domain.catalog.ApiLifecycle;

/** 目录标量投影，不读取草稿、内部绑定或完整结构。 */
public record DocumentSummary(String apiId, String releaseId, long stateVersion, long draftRevision,
                              String name, String category, String service, String version, String method,
                              ApiLifecycle.Status lifecycleStatus, boolean mcpSupported) {}
