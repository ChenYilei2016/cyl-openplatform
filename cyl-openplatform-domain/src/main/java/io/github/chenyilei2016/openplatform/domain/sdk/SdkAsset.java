package io.github.chenyilei2016.openplatform.domain.sdk;

import io.github.chenyilei2016.openplatform.domain.common.*;
import java.time.Instant;

/** SDK公开元数据；不携带二进制或内部提供方配置。 */
public record SdkAsset(String id, SdkAssetKind kind, String apiId, String releaseId, String service, String version, String method,
                       String name, String sdkVersion, String language, String gatewayProtocol, String runtime,
                       String releaseNotes, SdkAssetStatus status, long revision, String sha256, Long sizeBytes,
                       Instant createdAt, Instant publishedAt) {
    public void requireRevision(long expectedRevision) {
        if (expectedRevision < 1 || expectedRevision == Long.MAX_VALUE)
            throw new PlatformException(ErrorCode.INVALID_REQUEST, "资产修订号不合法");
        if (revision != expectedRevision) throw new PlatformException(ErrorCode.CONFLICT, "SDK资产已变化，请刷新后重试");
    }

    public SdkManifest manifest() {
        return new SdkManifest("cyl-openplatform.sdk/v1", sdkVersion, language, gatewayProtocol, runtime);
    }
}
