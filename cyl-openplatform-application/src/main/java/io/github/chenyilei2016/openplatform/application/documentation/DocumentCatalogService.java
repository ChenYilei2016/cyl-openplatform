package io.github.chenyilei2016.openplatform.application.documentation;

import io.github.chenyilei2016.openplatform.domain.access.ScopeRepository;
import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PageResult;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.github.chenyilei2016.openplatform.domain.documentation.*;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

/** 同一只读快照内完成启用scope、投影就绪、总数与当前页查询。 */
@Service
@RequiredArgsConstructor
public class DocumentCatalogService {
    private final DocumentCatalogRepository documents;
    private final ScopeRepository scopes;

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public PageResult<DocumentSummary> page(DocumentQuery query, DocumentAudience audience, List<String> scopeCodes, String tenantId) {
        List<String> enabled = audience.requiresScopes() ? scopes.enabledCodes(scopeCodes) : List.of();
        if (audience.requiresScopes() && enabled.isEmpty()) return new PageResult<>(List.of(), 0, query.page(), query.pageSize());
        requireProjectionReady();
        return documents.page(query, audience, enabled, tenantId);
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public PageResult<DocumentCategory> categories(DocumentQuery query, DocumentAudience audience, List<String> scopeCodes, String tenantId) {
        List<String> enabled = audience.requiresScopes() ? scopes.enabledCodes(scopeCodes) : List.of();
        if (audience.requiresScopes() && enabled.isEmpty()) return new PageResult<>(List.of(), 0, query.page(), query.pageSize());
        requireProjectionReady();
        return documents.categories(query, audience, enabled, tenantId);
    }

    private void requireProjectionReady() {
        if (!documents.projectionReady()) {
            throw new PlatformException(ErrorCode.DEPENDENCY_UNAVAILABLE, "生效文档索引尚未完成迁移，请联系管理员");
        }
    }
}
