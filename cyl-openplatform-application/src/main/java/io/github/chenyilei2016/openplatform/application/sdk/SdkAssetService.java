package io.github.chenyilei2016.openplatform.application.sdk;

import io.github.chenyilei2016.openplatform.domain.common.ObjectIdType;
import io.github.chenyilei2016.openplatform.application.access.AccessAuditService;
import io.github.chenyilei2016.openplatform.application.publication.PublishedApiService;
import io.github.chenyilei2016.openplatform.domain.access.AccessOperator;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiDefinition;
import io.github.chenyilei2016.openplatform.domain.common.*;
import io.github.chenyilei2016.openplatform.domain.publication.*;
import io.github.chenyilei2016.openplatform.domain.sdk.*;
import io.github.chenyilei2016.openplatform.domain.token.TokenContext;
import java.io.ByteArrayInputStream;
import java.time.Instant;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.*;

/** 资产变更只经过一个审计事务；客户读取使用生效API与业务Token的既有授权。 */
@Service
@RequiredArgsConstructor
public class SdkAssetService {
    private final SdkAssetRepository assets;
    private final PublicationRepository publications;
    private final PublishedApiService publishedApis;
    private final AccessAuditService audit;
    private final SdkArchiveReader archiveReader;

    public PageResult<SdkAsset> page(SdkAssetQuery query) { return assets.page(query, null); }

    public SdkAsset find(String id) {
        return assets.find(id).orElseThrow(() -> new PlatformException(ErrorCode.NOT_FOUND, "SDK资产不存在"));
    }

    public SdkAsset create(CreateSdkAsset command, AccessOperator operator) {
        String id = ObjectIdType.SDK_ASSET.nextId();
        return audit.change("SDK_ASSET_CREATE", null, null, id, operator, () -> {
            String apiId = null;
            String releaseId = null;
            ApiDefinition api = null;
            if (command.kind() == SdkAssetKind.LEGACY_API) {
                EffectiveRelease release = publications.effective(command.apiId()).filter(EffectiveRelease::enabled)
                        .orElseThrow(() -> new PlatformException(ErrorCode.NOT_FOUND, "API未发布或已停用"));
                if (!release.releaseId().equals(command.releaseId()))
                    throw new PlatformException(ErrorCode.CONFLICT, "API生效版本已变化，请刷新后登记");
                apiId = release.apiId();
                releaseId = release.releaseId();
                api = release.snapshot();
            }
            assets.create(new SdkAsset(id, command.kind(), apiId, releaseId,
                    api == null ? null : api.service(), api == null ? null : api.version(), api == null ? null : api.method(),
                    command.name(), command.sdkVersion(), command.language(), command.gatewayProtocol(), command.runtime(),
                    command.releaseNotes(), SdkAssetStatus.DRAFT, 1, null, null, Instant.now(), null));
            return find(id);
        });
    }

    public SdkAsset update(String id, long revision, String name, String releaseNotes, AccessOperator operator) {
        return audit.change("SDK_ASSET_UPDATE", null, null, id, operator, () -> {
            SdkAsset asset = find(id);
            asset.requireRevision(revision);
            asset.status().requireDraft();
            assets.update(id, revision, name, releaseNotes);
            return find(id);
        });
    }

    public record ArchivePreview(SdkManifest manifest, String sha256, int sizeBytes) {}

    /** 登记前复用正式上传校验，提取清单；不写入资产，也不执行包内程序。 */
    public ArchivePreview inspect(java.io.InputStream input) {
        SdkArchive archive = archiveReader.read(input);
        return new ArchivePreview(archive.manifest(), archive.sha256(), archive.content().length);
    }

    public SdkAsset upload(String id, long revision, java.io.InputStream input, AccessOperator operator) {
        SdkArchive archive;
        try {
            archive = archiveReader.read(input);
        } catch (PlatformException failure) {
            audit.rejected("SDK_ASSET_UPLOAD", null, null, id, operator, failure);
            throw failure;
        }
        return audit.change("SDK_ASSET_UPLOAD", null, null, id, operator, () -> {
            SdkAsset asset = find(id);
            asset.requireRevision(revision);
            asset.status().requireDraft();
            if (!asset.manifest().equals(archive.manifest()))
                throw new PlatformException(ErrorCode.INVALID_REQUEST, "ZIP清单与SDK登记声明不一致");
            assets.upload(id, revision, archive);
            return find(id);
        });
    }

    public SdkAsset publish(String id, long revision, AccessOperator operator) {
        return audit.change("SDK_ASSET_PUBLISH", null, null, id, operator, () -> {
            SdkAsset asset = find(id);
            asset.requireRevision(revision);
            asset.status().requireDraft();
            if (asset.sha256() == null || asset.sizeBytes() == null)
                throw new PlatformException(ErrorCode.CONFLICT, "请先上传完整SDK ZIP");
            verifiedContent(asset);
            if (asset.kind() == SdkAssetKind.LEGACY_API && publications.effective(asset.apiId()).filter(EffectiveRelease::enabled)
                    .filter(release -> release.releaseId().equals(asset.releaseId())).isEmpty())
                throw new PlatformException(ErrorCode.CONFLICT, "API生效版本已变化，不能发布此SDK资产");
            assets.changeStatus(id, revision, SdkAssetStatus.PUBLISHED, Instant.now());
            return find(id);
        });
    }

    public SdkAsset withdraw(String id, long revision, AccessOperator operator) {
        return audit.change("SDK_ASSET_WITHDRAW", null, null, id, operator, () -> {
            SdkAsset asset = find(id);
            asset.requireRevision(revision);
            asset.status().requireWithdrawable();
            assets.changeStatus(id, revision, SdkAssetStatus.WITHDRAWN, null);
            return find(id);
        });
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public PageResult<SdkAsset> customerPage(String service, String version, String method, int page, int pageSize, TokenContext token) {
        EffectiveRelease release = publishedApis.requireEffective(service, version, method, token);
        return assets.page(new SdkAssetQuery(page, pageSize, null, release.apiId(), SdkAssetKind.LEGACY_API,
                SdkAssetStatus.PUBLISHED, null, null), release.releaseId());
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public SdkAsset customer(String id, TokenContext token) {
        SdkAsset asset = find(id);
        if (asset.kind() != SdkAssetKind.LEGACY_API || asset.status() != SdkAssetStatus.PUBLISHED)
            throw new PlatformException(ErrorCode.NOT_FOUND, "SDK资产当前不可见");
        EffectiveRelease release = publishedApis.requireEnabled(asset.service(), asset.version(), asset.method());
        if (!release.releaseId().equals(asset.releaseId())) throw new PlatformException(ErrorCode.NOT_FOUND, "SDK资产不适用于当前生效版本");
        publishedApis.requireEffective(asset.service(), asset.version(), asset.method(), token);
        return asset;
    }

    public PageResult<SdkAsset> publicPage(SdkAssetQuery query) { return assets.publicPage(query); }

    public SdkAsset publicAsset(String id) {
        return assets.findPublic(id).orElseThrow(() -> new PlatformException(ErrorCode.NOT_FOUND, "SDK资产当前不可见"));
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public Download publicDownload(String id, long revision) {
        return download(publicAsset(id), revision);
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public Download adminDownload(String id, long revision) {
        return download(find(id), revision);
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public Download customerDownload(String id, long revision, TokenContext token) {
        return download(customer(id, token), revision);
    }

    private Download download(SdkAsset asset, long revision) {
        asset.requireRevision(revision);
        if (asset.sha256() == null || asset.sizeBytes() == null)
            throw new PlatformException(ErrorCode.NOT_FOUND, "SDK资产尚未上传");
        return new Download(asset.language() + "-" + asset.sdkVersion() + "-" + asset.id() + ".zip", verifiedContent(asset));
    }

    /** 发布与下载均核验实际存储内容；仓储先限制BLOB大小，解析器继续执行ZIP与manifest边界。 */
    private byte[] verifiedContent(SdkAsset asset) {
        byte[] content = assets.content(asset.id(), asset.revision());
        if (content == null || asset.sizeBytes() == null || content.length != asset.sizeBytes()
                || content.length > SdkArchive.MAX_CONTENT_BYTES)
            throw new PlatformException(ErrorCode.INTERNAL_ERROR, "SDK内容完整性校验失败");
        SdkArchive archive;
        try {
            archive = archiveReader.read(new ByteArrayInputStream(content));
        } catch (PlatformException failure) {
            throw new PlatformException(ErrorCode.INTERNAL_ERROR, "SDK存储内容格式校验失败");
        }
        if (!archive.sha256().equals(asset.sha256()) || !archive.manifest().equals(asset.manifest()))
            throw new PlatformException(ErrorCode.INTERNAL_ERROR, "SDK内容完整性校验失败");
        return content;
    }

    public record Download(String filename, byte[] content) {
        @Override public String toString() { return "Download[filename=" + filename + ",size=" + content.length + "]"; }
    }
}
