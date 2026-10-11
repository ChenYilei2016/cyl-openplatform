package io.github.chenyilei2016.openplatform.domain.publication;

import io.github.chenyilei2016.openplatform.domain.catalog.CatalogPageQuery;
import io.github.chenyilei2016.openplatform.domain.common.PageResult;

import java.util.Optional;

public interface PublicationRepository {
    Optional<Release> find(String id);

    Optional<Release> findSubmission(String key);

    PageResult<ReleaseSummary> page(CatalogPageQuery query, ReleaseStatus status, Boolean auditRequired);

    PageResult<ReleaseSummary> apiReleases(String apiId, CatalogPageQuery query);

    PublicationState state(String apiId);

    /** 工作区仅投影当前生效/待审的两个修订号，不读取历史快照。 */
    java.util.Map<String, Long> draftRevisions(String apiId, java.util.Set<String> releaseIds);

    void saveState(PublicationState state);

    void insert(Release release);

    void decide(Release release);

    Optional<EffectiveRelease> effective(String apiId);

    Optional<EffectiveRelease> effective(String service, String version, String method);

    void appendAudit(PublicationAudit audit);

    PageResult<PublicationAudit> audit(String apiId, CatalogPageQuery query);
}
