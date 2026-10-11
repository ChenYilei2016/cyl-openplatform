package io.github.chenyilei2016.openplatform.application.sdk;

import io.github.chenyilei2016.openplatform.domain.sdk.SdkAssetKind;
import java.util.Objects;

/** SDK登记声明；格式校验位于HTTP边界，关联API由应用服务核验。 */
public record CreateSdkAsset(SdkAssetKind kind, String apiId, String releaseId, String name, String sdkVersion, String language,
                             String gatewayProtocol, String runtime, String releaseNotes) {
    public CreateSdkAsset {
        Objects.requireNonNull(kind, "SDK资产类型不能为空").requireApiReferences(apiId, releaseId);
    }
}
