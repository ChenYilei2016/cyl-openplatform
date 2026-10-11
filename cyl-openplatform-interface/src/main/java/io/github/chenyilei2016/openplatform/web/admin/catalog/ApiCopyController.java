package io.github.chenyilei2016.openplatform.web.admin.catalog;

import io.github.chenyilei2016.openplatform.application.catalog.ApiCopyService;
import io.github.chenyilei2016.openplatform.application.catalog.ApiCopyService.SourceKind;
import io.github.chenyilei2016.openplatform.common.ApiResponse;
import io.github.chenyilei2016.openplatform.domain.administration.AdminPermission;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiDefinition;
import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.github.chenyilei2016.openplatform.identity.AdminSession;
import io.github.chenyilei2016.openplatform.identity.RequireAdmin;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import lombok.RequiredArgsConstructor;
import org.slf4j.MDC;
import org.springframework.web.bind.annotation.*;
import java.io.IOException;

/** API复制预览无写入；保存和结果查询均绑定当前可信租户与维护人员。 */
@RestController
@RequestMapping("/admin-api/api-copies")
@RequireAdmin(permissions = AdminPermission.MANAGE_APIS)
@RequiredArgsConstructor
public class ApiCopyController {
    private final ApiCopyService copies;
    private final io.github.chenyilei2016.openplatform.application.catalog.ApiOwnerService owners;
    private final ApiDraftRequestReader bodies;
    public record PreviewRequest(@NotBlank @Size(max = 36) String sourceApiId, @NotNull SourceKind sourceKind,
                                 @Positive Long expectedSourceRevision, @Size(max = 36) String sourceReleaseId) {}
    public record CopyRequest(@NotBlank @Pattern(regexp = "[a-zA-Z0-9_-]{1,36}") String creationKey,
                              @NotBlank @Size(max = 36) String sourceApiId, @NotNull SourceKind sourceKind,
                              @NotNull @Positive Long sourceRevision, @Size(max = 36) String sourceReleaseId,
                              @NotNull @Valid ApiCatalogController.SaveApiRequest definition) {}

    @PostMapping(value = "/preview", consumes = "application/json")
    public ApiResponse<ApiCopyService.Preview> preview(HttpServletRequest request) throws IOException {
        PreviewRequest body = bodies.read(request, PreviewRequest.class);
        AdminSession operator = AdminSession.current(request);
        String owner = owners.current(io.github.chenyilei2016.openplatform.identity.VerifiedEmployeeSession.current(request),io.github.chenyilei2016.openplatform.identity.VerifiedEmployeeSession.tenantName(request)).id();
        return ApiResponse.success(copies.preview(body.sourceApiId(), body.sourceKind(), body.expectedSourceRevision(), body.sourceReleaseId(), owner));
    }

    @PostMapping(consumes = "application/json")
    public ApiResponse<ApiDefinition> create(HttpServletRequest request) throws IOException {
        CopyRequest body = bodies.read(request, CopyRequest.class);
        AdminSession operator = AdminSession.current(request);
        if (body.definition().expectedRevision() != null)
            throw new PlatformException(ErrorCode.INVALID_REQUEST, "复制新建不能携带目标草稿expectedRevision");
        return ApiResponse.success(copies.create(body.creationKey(), body.sourceApiId(), body.sourceKind(), body.sourceRevision(),
                body.sourceReleaseId(), body.definition().definition(null, 1), operator.tenantId(), operator.employeeNo(), MDC.get("requestId")));
    }

    @GetMapping("/requests/{creationKey}")
    public ApiResponse<ApiDefinition> result(@PathVariable @Pattern(regexp = "[a-zA-Z0-9_-]{1,36}") String creationKey, HttpServletRequest request) {
        AdminSession operator = AdminSession.current(request);
        return ApiResponse.success(copies.result(creationKey, operator.tenantId(), operator.employeeNo()));
    }
}
