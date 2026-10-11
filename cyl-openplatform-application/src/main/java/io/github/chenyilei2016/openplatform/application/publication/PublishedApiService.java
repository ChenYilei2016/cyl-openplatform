package io.github.chenyilei2016.openplatform.application.publication;

import io.github.chenyilei2016.openplatform.domain.catalog.ApiDocument;
import io.github.chenyilei2016.openplatform.domain.access.ScopeRepository;
import io.github.chenyilei2016.openplatform.domain.common.*;
import io.github.chenyilei2016.openplatform.domain.publication.*;
import io.github.chenyilei2016.openplatform.domain.token.TokenContext;

import lombok.RequiredArgsConstructor;

import org.springframework.stereotype.Service;

/** 文档与后续网关共享生效读取与scope授权；内部绑定只供网关使用。 */
@Service
@RequiredArgsConstructor
public class PublishedApiService {
    private final PublicationRepository publications;
    private final ScopeRepository scopes;
    private final io.github.chenyilei2016.openplatform.application.platform.PlatformSettings platform;

    public EffectiveRelease requireEffective(
            String service, String version, String method, TokenContext context) {
        EffectiveRelease release = requireEnabled(service, version, method);
        if (scopes.enabledCodes(release.snapshot().scopeCodes()).stream()
                .noneMatch(context.scopeCodes()::contains))
            throw new PlatformException(ErrorCode.FORBIDDEN, "Token没有此API的权限组");
        return release;
    }

    /** 运行链取得当前启用快照后，由共享执行器统一检查scope，避免重复查库。 */
    public EffectiveRelease requireEnabled(String service, String version, String method) {
        return
                publications
                        .effective(service, version, method)
                        .filter(EffectiveRelease::enabled)
                        .orElseThrow(
                                () -> new PlatformException(ErrorCode.NOT_FOUND, "API未发布或已停用"));
    }

    public PublishedDocument document(
            String service, String version, String method, TokenContext context) {
        EffectiveRelease release = requireEffective(service, version, method, context);
        return new PublishedDocument(
                release.releaseId(),
                release.stateVersion(),
                ApiDocument.from(release.snapshot(), release.snapshot().name()).withBaseUrl(platform.getGatewayBaseUrl()));
    }

    /** 版本公告来自同一生效快照，退出后仍可供已授权客户查询迁移说明。 */
    public LifecycleAnnouncement announcement(String service, String version, String method, TokenContext context) {
        EffectiveRelease release = requireEffective(service, version, method, context);
        var api = release.snapshot();
        return new LifecycleAnnouncement(release.releaseId(), release.stateVersion(), api.service(), api.version(),
                api.method(), api.name(), api.lifecycle());
    }

    public record LifecycleAnnouncement(String releaseId, long stateVersion, String service, String version,
                                        String method, String name,
                                        io.github.chenyilei2016.openplatform.domain.catalog.ApiLifecycle lifecycle) {}

    public record PublishedDocument(String releaseId, long stateVersion, ApiDocument document) {}
}
