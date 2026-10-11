package io.github.chenyilei2016.openplatform.application.catalog;

import io.github.chenyilei2016.openplatform.application.administration.OperatorNames;
import io.github.chenyilei2016.openplatform.domain.administration.OperatorRef;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiRevision;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiRevisionRepository;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiRevisionSummary;
import io.github.chenyilei2016.openplatform.domain.catalog.CatalogPageQuery;
import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PageResult;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class ApiRevisionService {
    private final ApiRevisionRepository revisions;
    private final OperatorNames operatorNames;

    /** 草稿修订及操作人展示姓名；历史起点等未记录操作人时姓名为 null。 */
    public record RevisionEntry(ApiRevisionSummary revision, String operatorName) {}

    public PageResult<RevisionEntry> page(String apiId, CatalogPageQuery query) {
        if (!revisions.apiExists(apiId)) throw new PlatformException(ErrorCode.NOT_FOUND, "API草稿不存在");
        PageResult<ApiRevisionSummary> page = revisions.page(apiId, query);
        Map<OperatorRef, String> names = operatorNames.of(page.items().stream()
                .map(item -> new OperatorRef(item.operatorTenantId(), item.operatorEmployeeNo())));
        return page.map(item -> new RevisionEntry(item, names.get(new OperatorRef(item.operatorTenantId(), item.operatorEmployeeNo()))));
    }

    public ApiRevision find(String apiId, long revision) {
        return revisions.find(apiId, revision)
                .orElseThrow(() -> new PlatformException(ErrorCode.NOT_FOUND, "该API草稿历史不存在"));
    }
}
