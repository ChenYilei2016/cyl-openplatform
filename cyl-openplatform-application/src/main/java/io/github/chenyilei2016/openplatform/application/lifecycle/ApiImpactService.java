package io.github.chenyilei2016.openplatform.application.lifecycle;

import io.github.chenyilei2016.openplatform.domain.access.AccessPageQuery;
import io.github.chenyilei2016.openplatform.domain.access.ScopeRepository;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiCatalogRepository;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiDefinition;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiLifecycle;
import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PageResult;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.github.chenyilei2016.openplatform.domain.lifecycle.AffectedApplication;
import io.github.chenyilei2016.openplatform.domain.lifecycle.ApiImpactRepository;
import io.github.chenyilei2016.openplatform.domain.lifecycle.ImpactBasis;
import io.github.chenyilei2016.openplatform.domain.publication.PublicationRepository;
import java.time.Instant;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class ApiImpactService {
    private final ApiCatalogRepository catalog;
    private final PublicationRepository publications;
    private final ScopeRepository scopes;
    private final ApiImpactRepository impacts;

    public record AffectedApplications(String apiId, String service, String version, String method,
                                       ImpactBasis basis, long draftRevision, String releaseId,
                                       ApiLifecycle lifecycle, boolean enabled, Instant evaluatedAt,
                                       PageResult<AffectedApplication> applications) {}

    /** 同次读取保持契约与授权查询快照一致；跨页仅固定API修订，授权仍可能变化。 */
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public AffectedApplications affected(String apiId, ImpactBasis basis, Long expectedRevision, AccessPageQuery query) {
        if (query.offset() > 100_000 || (expectedRevision != null && expectedRevision < 1))
            throw new PlatformException(ErrorCode.INVALID_REQUEST, "分页偏移或期望修订超出限制");
        ApiDefinition definition;
        boolean enabled;
        String releaseId;
        if (basis == ImpactBasis.EFFECTIVE) {
            var effective = publications.effective(apiId)
                    .orElseThrow(() -> new PlatformException(ErrorCode.NOT_FOUND, "API尚未发布"));
            definition = effective.snapshot();
            enabled = effective.enabled();
            releaseId = effective.releaseId();
        } else {
            definition = catalog.find(apiId)
                    .orElseThrow(() -> new PlatformException(ErrorCode.NOT_FOUND, "API不存在"));
            enabled = publications.state(apiId).enabled();
            releaseId = null;
        }
        if (expectedRevision != null && definition.draftRevision() != expectedRevision)
            throw new PlatformException(ErrorCode.CONFLICT, "API契约修订已变化，请重新查询影响");
        var applications = impacts.page(scopes.enabledCodes(definition.scopeCodes()), query);
        return new AffectedApplications(apiId, definition.service(), definition.version(), definition.method(),
                basis, definition.draftRevision(), releaseId, definition.lifecycle(), enabled, Instant.now(), applications);
    }
}
