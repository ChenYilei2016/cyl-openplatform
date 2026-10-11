package io.github.chenyilei2016.openplatform.web.admin.catalog;

import com.fasterxml.jackson.annotation.JsonUnwrapped;
import io.github.chenyilei2016.openplatform.application.catalog.ApiRevisionService;
import io.github.chenyilei2016.openplatform.application.catalog.ApiCatalogService;
import io.github.chenyilei2016.openplatform.application.catalog.ApiDraftSaveResult;
import io.github.chenyilei2016.openplatform.common.ApiResponse;
import io.github.chenyilei2016.openplatform.domain.administration.AdminPermission;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiDefinition;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiRevision;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiRevisionSummary;
import io.github.chenyilei2016.openplatform.domain.catalog.CatalogPageQuery;
import io.github.chenyilei2016.openplatform.domain.common.PageResult;
import io.github.chenyilei2016.openplatform.identity.RequireAdmin;
import io.github.chenyilei2016.openplatform.identity.AdminSession;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 草稿历史包含内部绑定，只允许API维护人员读取；列表不携带历史正文。 */
@RequireAdmin(permissions = AdminPermission.MANAGE_APIS)
@RestController
@RequestMapping("/admin-api/apis/{apiId}/revisions")
@RequiredArgsConstructor
public class ApiRevisionController {
    private final ApiRevisionService revisions;
    private final ApiCatalogService catalog;

    public record RestoreRequest(@NotNull @Positive @Max(Long.MAX_VALUE - 1) Long expectedRevision) {}

    /** 仅改变草稿；源版本来自服务端归档，客户端不能提交替换后的历史正文。 */
    @PostMapping("/{revision}/restore")
    public ApiResponse<ApiCatalogController.SaveApiResponse> restore(@PathVariable @Size(max = 36) String apiId,
            @PathVariable @Positive long revision, @Valid @RequestBody RestoreRequest body,
            HttpServletRequest request) {
        AdminSession operator = AdminSession.current(request);
        ApiDraftSaveResult saved = catalog.restore(apiId, revision, body.expectedRevision(),
                operator.tenantId(), operator.employeeNo(), org.slf4j.MDC.get("requestId"));
        return ApiResponse.success(new ApiCatalogController.SaveApiResponse(saved.definition(), saved.changed()));
    }

    /** 修订摘要平铺输出，附操作人展示姓名。 */
    public record RevisionRow(@JsonUnwrapped ApiRevisionSummary revision, String operatorName) {}

    @GetMapping
    public ApiResponse<PageResult<RevisionRow>> page(@PathVariable @Size(max = 36) String apiId,
            @RequestParam(defaultValue = "1") int page, @RequestParam(defaultValue = "20") int pageSize) {
        return ApiResponse.success(revisions.page(apiId, new CatalogPageQuery(page, pageSize, null))
                .map(item -> new RevisionRow(item.revision(), item.operatorName())));
    }

    public record RevisionResponse(@JsonUnwrapped ApiRevisionSummary metadata, ApiDefinition snapshot) {}

    @GetMapping("/{revision}")
    public ApiResponse<RevisionResponse> find(@PathVariable @Size(max = 36) String apiId,
            @PathVariable @Positive long revision) {
        ApiRevision history = revisions.find(apiId, revision);
        return ApiResponse.success(new RevisionResponse(history.metadata(), history.snapshot()));
    }
}
