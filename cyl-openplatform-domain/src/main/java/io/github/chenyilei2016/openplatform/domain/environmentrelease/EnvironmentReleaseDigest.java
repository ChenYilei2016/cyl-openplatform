package io.github.chenyilei2016.openplatform.domain.environmentrelease;

import io.github.chenyilei2016.openplatform.domain.catalog.ApiDefinition;
import io.github.chenyilei2016.openplatform.domain.environmentrelease.EnvironmentReleaseModels.SendRequest;

/** 对完整传输及目标预览生成确定性摘要，保留JSON数值精度。 */
public interface EnvironmentReleaseDigest {
    String preview(ApiDefinition definition, ApiDefinition before);

    String request(SendRequest request);
}
