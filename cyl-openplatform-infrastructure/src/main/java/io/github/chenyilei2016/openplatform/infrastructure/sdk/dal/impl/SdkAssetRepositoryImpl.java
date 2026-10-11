package io.github.chenyilei2016.openplatform.infrastructure.sdk.dal.impl;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import io.github.chenyilei2016.openplatform.domain.common.*;
import io.github.chenyilei2016.openplatform.domain.sdk.*;
import io.github.chenyilei2016.openplatform.infrastructure.common.SqlPatterns;
import io.github.chenyilei2016.openplatform.infrastructure.sdk.dal.dataobject.SdkAssetDO;
import io.github.chenyilei2016.openplatform.infrastructure.sdk.dal.mapper.SdkAssetMapper;
import java.time.Instant;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Repository;

@Repository
@RequiredArgsConstructor
public class SdkAssetRepositoryImpl implements SdkAssetRepository {
    private final SdkAssetMapper mapper;

    @Override public PageResult<SdkAsset> page(SdkAssetQuery query, String publishedReleaseId) {
        IPage<SdkAssetDO> page = mapper.selectPageByQuery(new Page<>(query.page(), query.pageSize()), SqlPatterns.contains(query.query()),
                query, publishedReleaseId, false);
        return new PageResult<>(page.getRecords().stream().map(this::asset).toList(), page.getTotal(), query.page(), query.pageSize());
    }

    @Override public PageResult<SdkAsset> publicPage(SdkAssetQuery query) {
        IPage<SdkAssetDO> page = mapper.selectPageByQuery(new Page<>(query.page(), query.pageSize()),
                SqlPatterns.contains(query.query()), query, null, true);
        return new PageResult<>(page.getRecords().stream().map(this::asset).toList(), page.getTotal(), query.page(), query.pageSize());
    }

    @Override public Optional<SdkAsset> findPublic(String id) {
        return Optional.ofNullable(mapper.selectPublic(id)).map(this::asset);
    }

    @Override public Optional<SdkAsset> find(String id) { return Optional.ofNullable(mapper.selectById(id)).map(this::asset); }

    @Override public void create(SdkAsset a) {
        mapper.insert(new SdkAssetDO(a.id(), a.kind().name(), a.apiId(), a.releaseId(), a.service(), a.version(), a.method(), a.name(),
                a.sdkVersion(), a.language(), a.gatewayProtocol(), a.runtime(), a.releaseNotes(), a.status().name(),
                a.revision(), a.sha256(), a.sizeBytes(), a.createdAt(), a.publishedAt(), null));
    }

    @Override public void update(String id, long revision, String name, String releaseNotes) {
        changed(mapper.update(null, Wrappers.<SdkAssetDO>lambdaUpdate().eq(SdkAssetDO::getId, id)
                .eq(SdkAssetDO::getRevision, revision).eq(SdkAssetDO::getStatus, SdkAssetStatus.DRAFT.name())
                .set(SdkAssetDO::getName, name).set(SdkAssetDO::getReleaseNotes, releaseNotes).set(SdkAssetDO::getRevision, revision + 1)));
    }

    @Override public void upload(String id, long revision, SdkArchive archive) {
        changed(mapper.update(null, Wrappers.<SdkAssetDO>lambdaUpdate().eq(SdkAssetDO::getId, id)
                .eq(SdkAssetDO::getRevision, revision).eq(SdkAssetDO::getStatus, SdkAssetStatus.DRAFT.name())
                .set(SdkAssetDO::getPayload, archive.content()).set(SdkAssetDO::getSha256, archive.sha256())
                .set(SdkAssetDO::getSizeBytes, (long) archive.content().length).set(SdkAssetDO::getRevision, revision + 1)));
    }

    @Override public void changeStatus(String id, long revision, SdkAssetStatus status, Instant publishedAt) {
        LambdaUpdateWrapper<SdkAssetDO> update = Wrappers.<SdkAssetDO>lambdaUpdate().eq(SdkAssetDO::getId, id).eq(SdkAssetDO::getRevision, revision)
                .set(SdkAssetDO::getStatus, status.name()).set(SdkAssetDO::getRevision, revision + 1);
        if (status == SdkAssetStatus.PUBLISHED) update.set(SdkAssetDO::getPublishedAt, publishedAt);
        changed(mapper.update(null, update));
    }

    @Override public byte[] content(String id, long revision) {
        SdkAssetDO row = mapper.selectContent(id, revision);
        return row == null ? null : row.getPayload();
    }

    private void changed(int count) {
        if (count != 1) throw new PlatformException(ErrorCode.CONFLICT, "SDK资产已变化，请刷新后重试");
    }

    private SdkAsset asset(SdkAssetDO a) {
        return new SdkAsset(a.getId(), SdkAssetKind.valueOf(a.getKind()), a.getApiId(), a.getReleaseId(), a.getService(), a.getVersion(), a.getMethod(),
                a.getName(), a.getSdkVersion(), a.getLanguage(), a.getGatewayProtocol(), a.getRuntime(), a.getReleaseNotes(),
                SdkAssetStatus.valueOf(a.getStatus()), a.getRevision(), a.getSha256(), a.getSizeBytes(), a.getCreatedAt(), a.getPublishedAt());
    }
}
