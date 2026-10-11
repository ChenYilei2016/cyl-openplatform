package io.github.chenyilei2016.openplatform.domain.sdk;

import io.github.chenyilei2016.openplatform.domain.common.PageResult;
import java.time.Instant;
import java.util.Optional;

public interface SdkAssetRepository {
    PageResult<SdkAsset> page(SdkAssetQuery query, String publishedReleaseId);
    PageResult<SdkAsset> publicPage(SdkAssetQuery query);
    Optional<SdkAsset> find(String id);
    Optional<SdkAsset> findPublic(String id);
    void create(SdkAsset asset);
    void update(String id, long revision, String name, String releaseNotes);
    void upload(String id, long revision, SdkArchive archive);
    void changeStatus(String id, long revision, SdkAssetStatus status, Instant publishedAt);
    byte[] content(String id, long revision);
}
