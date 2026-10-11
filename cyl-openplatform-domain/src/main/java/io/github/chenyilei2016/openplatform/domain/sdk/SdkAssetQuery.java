package io.github.chenyilei2016.openplatform.domain.sdk;

import io.github.chenyilei2016.openplatform.domain.common.*;

public record SdkAssetQuery(int page, int pageSize, String query, String apiId, SdkAssetKind kind,
                            SdkAssetStatus status, String sdkVersion, String language) {
    public SdkAssetQuery {
        if (page < 1 || pageSize < 1 || pageSize > 100 || (long) (page - 1) * pageSize > 100_000
                || (query != null && query.length() > 100) || (apiId != null && apiId.length() > 36)
                || (sdkVersion != null && sdkVersion.length() > 32) || (language != null && language.length() > 32))
            throw new PlatformException(ErrorCode.INVALID_REQUEST, "SDK资产查询参数不合法");
    }
}
