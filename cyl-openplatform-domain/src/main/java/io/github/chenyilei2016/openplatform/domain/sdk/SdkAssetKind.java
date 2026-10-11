package io.github.chenyilei2016.openplatform.domain.sdk;

import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;

/** 平台版本独立发布；历史接口资产保留原有API与生效修订约束。 */
public enum SdkAssetKind {
    PLATFORM, LEGACY_API;

    public void requireApiReferences(String apiId, String releaseId) {
        if (this == PLATFORM && (apiId != null || releaseId != null))
            throw new PlatformException(ErrorCode.INVALID_REQUEST, "平台SDK不能绑定API或生效修订");
        if (this == LEGACY_API && (apiId == null || apiId.isBlank() || releaseId == null || releaseId.isBlank()))
            throw new PlatformException(ErrorCode.INVALID_REQUEST, "历史接口SDK必须指定API和生效修订");
    }
}
