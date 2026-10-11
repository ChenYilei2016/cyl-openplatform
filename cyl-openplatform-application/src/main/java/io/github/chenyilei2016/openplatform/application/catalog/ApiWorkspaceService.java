package io.github.chenyilei2016.openplatform.application.catalog;

import io.github.chenyilei2016.openplatform.domain.catalog.ApiCatalogRepository;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiDefinition;
import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.github.chenyilei2016.openplatform.domain.publication.PublicationRepository;
import io.github.chenyilei2016.openplatform.domain.publication.PublicationState;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

/** 同一数据库快照读取工作区基线；写入仍须独立执行CAS。 */
@Service
@RequiredArgsConstructor
public class ApiWorkspaceService {
    private final ApiCatalogRepository catalog;
    private final PublicationRepository publications;

    public record Workspace(ApiDefinition definition, PublicationState publication,
                            Long liveDraftRevision, Long pendingDraftRevision, boolean portalVisible) {}

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public Workspace find(String apiId) {
        ApiDefinition definition = catalog.find(apiId)
                .orElseThrow(() -> new PlatformException(ErrorCode.NOT_FOUND, "API草稿不存在"));
        PublicationState state = publications.state(apiId);
        Set<String> ids = new HashSet<>();
        if (state.liveReleaseId() != null) ids.add(state.liveReleaseId());
        if (state.pendingReleaseId() != null) ids.add(state.pendingReleaseId());
        Map<String, Long> revisions = publications.draftRevisions(apiId, ids);
        if (revisions.size() != ids.size())
            throw new PlatformException(ErrorCode.DEPENDENCY_UNAVAILABLE, "发布基线关联不完整，请稍后刷新");
        return new Workspace(definition, state,
                state.liveReleaseId() == null ? null : revisions.get(state.liveReleaseId()),
                state.pendingReleaseId() == null ? null : revisions.get(state.pendingReleaseId()), catalog.portalVisible(apiId));
    }
}
