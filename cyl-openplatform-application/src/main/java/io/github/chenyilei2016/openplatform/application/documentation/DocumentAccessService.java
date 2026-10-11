package io.github.chenyilei2016.openplatform.application.documentation;

import io.github.chenyilei2016.openplatform.application.publication.PublishedApiService;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiDocument;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiDefinition;
import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.github.chenyilei2016.openplatform.domain.documentation.DocumentCatalogRepository;
import io.github.chenyilei2016.openplatform.domain.documentation.DocumentView;
import io.github.chenyilei2016.openplatform.domain.publication.EffectiveRelease;
import io.github.chenyilei2016.openplatform.domain.token.TokenContext;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

/** 公开阅读、管理读取与客户授权分别进入，最终只产生相同的公开生效投影。 */
@Service
@RequiredArgsConstructor
public class DocumentAccessService {
    private final io.github.chenyilei2016.openplatform.domain.catalog.ApiCategoryRepository categories;
    private final PublishedApiService publications;
    private final DocumentCatalogRepository documents;
    private final io.github.chenyilei2016.openplatform.application.platform.PlatformSettings platform;

    public DocumentView visibleDocument(String service, String version, String method, String tenantId) {
        return documents.visibleDocument(service, version, method, tenantId)
                .map(view -> new DocumentView(view.releaseId(), view.stateVersion(), view.service(), view.version(), view.method(), view.category(),
                        view.document().withBaseUrl(platform.getGatewayBaseUrl())))
                .orElseThrow(() -> new PlatformException(ErrorCode.NOT_FOUND, "API未发布或已停用"));
    }

    public DocumentView customer(String service, String version, String method, TokenContext context) {
        return view(publications.requireEffective(service, version, method, context));
    }
    public DocumentView administrative(String service, String version, String method) {
        return view(publications.requireEnabled(service, version, method));
    }
    private DocumentView view(EffectiveRelease release) {
        ApiDefinition api = release.snapshot();
        return new DocumentView(release.releaseId(), release.stateVersion(), api.service(), api.version(),
                api.method(), categories.displayName(api.category()), ApiDocument.from(api, api.name()).withBaseUrl(platform.getGatewayBaseUrl()));
    }
}
