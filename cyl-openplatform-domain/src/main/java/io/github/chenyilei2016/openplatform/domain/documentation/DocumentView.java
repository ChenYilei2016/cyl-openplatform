package io.github.chenyilei2016.openplatform.domain.documentation;

import io.github.chenyilei2016.openplatform.domain.catalog.ApiDocument;

/** 单一生效版本的公开投影，在线与离线内容共用，不带内部绑定。 */
public record DocumentView(String releaseId, long stateVersion, String service, String version,
                           String method, String category, ApiDocument document) {}
