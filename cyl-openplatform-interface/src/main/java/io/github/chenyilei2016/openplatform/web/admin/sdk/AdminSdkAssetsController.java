package io.github.chenyilei2016.openplatform.web.admin.sdk;

import io.github.chenyilei2016.openplatform.domain.administration.AdminPermission;
import io.github.chenyilei2016.openplatform.web.shared.sdk.SdkDownloads;
import io.github.chenyilei2016.openplatform.web.shared.sdk.SdkTransferLimiter;
import io.github.chenyilei2016.openplatform.application.sdk.*;
import io.github.chenyilei2016.openplatform.common.ApiResponse;
import io.github.chenyilei2016.openplatform.domain.access.AccessOperator;
import io.github.chenyilei2016.openplatform.domain.common.*;
import io.github.chenyilei2016.openplatform.domain.sdk.*;
import io.github.chenyilei2016.openplatform.identity.RequireAdmin;
import io.github.chenyilei2016.openplatform.identity.AdminSession;
import jakarta.servlet.ServletInputStream;
import jakarta.servlet.http.*;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.io.IOException;
import lombok.RequiredArgsConstructor;
import org.slf4j.MDC;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import tools.jackson.databind.JsonNode;

/** 人工登记、上传及发布SDK资产；沿用后台人员权限与CSRF。 */
@RequireAdmin(permissions = {AdminPermission.MANAGE_APIS, AdminPermission.PUBLISH_APIS, AdminPermission.REVIEW_APIS}, match = RequireAdmin.Match.ANY)
@RestController
@RequestMapping("/admin-api/sdk-assets")
@RequiredArgsConstructor
public class AdminSdkAssetsController {
    private final SdkAssetService service;
    private final SdkTransferLimiter transfers;

    public record Create(SdkAssetKind kind, @Size(max=36) String apiId, @Size(max=36) String releaseId,
                         @NotBlank @Size(max=100) String name,
                         @NotNull @Pattern(regexp="[A-Za-z0-9][A-Za-z0-9._-]{0,31}") String sdkVersion,
                         @NotNull @Pattern(regexp="[A-Z][A-Z0-9_]{0,31}") String language,
                         @NotNull @Pattern(regexp="HTTP_JSON_BEARER_V1") String gatewayProtocol,
                         @NotBlank @Size(max=80) String runtime, @NotNull @Size(max=4000) String releaseNotes) {}
    public record Update(@NotNull JsonNode expectedRevision,
                         @NotBlank @Size(max=100) String name, @NotNull @Size(max=4000) String releaseNotes) {}
    public record Revision(@NotNull JsonNode expectedRevision) {}

    @GetMapping
    public ApiResponse<PageResult<SdkAsset>> page(@RequestParam(defaultValue="1") int page,
            @RequestParam(defaultValue="20") int pageSize, @RequestParam(required=false) String query,
            @RequestParam(required=false) String apiId, @RequestParam(required=false) SdkAssetKind kind,
            @RequestParam(required=false) SdkAssetStatus status, @RequestParam(required=false) String sdkVersion,
            @RequestParam(required=false) String language, HttpServletRequest request, HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store");
        return ApiResponse.success(service.page(new SdkAssetQuery(page, pageSize, query, apiId, kind, status, sdkVersion, language)));
    }

    @GetMapping("/{id}")
    public ApiResponse<SdkAsset> detail(@PathVariable @Size(max=36) String id, HttpServletRequest request, HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store");
        return ApiResponse.success(service.find(id));
    }

    @PostMapping
    @RequireAdmin(permissions = AdminPermission.MANAGE_APIS)
    public ApiResponse<SdkAsset> create(@Valid @RequestBody Create body, HttpServletRequest request) {
        AccessOperator operator = operator(request);
        // 旧调用方未发送kind时，继续按接口资产登记，不能隐式转为公开平台版本。
        SdkAssetKind kind = body.kind() == null ? SdkAssetKind.LEGACY_API : body.kind();
        return ApiResponse.success(service.create(new CreateSdkAsset(kind, body.apiId(), body.releaseId(), body.name(),
                body.sdkVersion(), body.language(), body.gatewayProtocol(), body.runtime(), body.releaseNotes()), operator));
    }

    @PutMapping("/{id}")
    @RequireAdmin(permissions = AdminPermission.MANAGE_APIS)
    public ApiResponse<SdkAsset> update(@PathVariable @Size(max=36) String id, @Valid @RequestBody Update body, HttpServletRequest request) {
        return ApiResponse.success(service.update(id, strictRevision(body.expectedRevision()), body.name(), body.releaseNotes(), operator(request)));
    }

    /** 登记前读取ZIP清单，前置展示版本/语言/运行要求，仍需显式保存与发布。 */
    @PutMapping(value="/inspect", consumes="application/zip")
    @RequireAdmin(permissions = AdminPermission.MANAGE_APIS)
    public ApiResponse<SdkAssetService.ArchivePreview> inspect(HttpServletRequest request) throws IOException {
        ServletInputStream input = request.getInputStream();
        return transfers.execute(() -> ApiResponse.success(service.inspect(input)));
    }

    /** 原始ZIP不经过multipart解析，不落盘；共享限额覆盖解析、校验与持久化。 */
    @PutMapping(value="/{id}/content", consumes="application/zip")
    @RequireAdmin(permissions = AdminPermission.MANAGE_APIS)
    public ApiResponse<SdkAsset> upload(@PathVariable @Size(max=36) String id,
            @RequestParam @Min(1) @Max(Long.MAX_VALUE-1) long expectedRevision, HttpServletRequest request) throws IOException {
        AccessOperator operator = operator(request);
        ServletInputStream input = request.getInputStream();
        return transfers.execute(() -> ApiResponse.success(service.upload(id, expectedRevision, input, operator)));
    }

    @PostMapping("/{id}/publish")
    @RequireAdmin(permissions = AdminPermission.PUBLISH_APIS)
    public ApiResponse<SdkAsset> publish(@PathVariable @Size(max=36) String id, @Valid @RequestBody Revision body, HttpServletRequest request) {
        AccessOperator operator = operator(request);
        long revision = strictRevision(body.expectedRevision());
        return transfers.execute(() -> ApiResponse.success(service.publish(id, revision, operator)));
    }

    @PostMapping("/{id}/withdraw")
    @RequireAdmin(permissions = AdminPermission.PUBLISH_APIS)
    public ApiResponse<SdkAsset> withdraw(@PathVariable @Size(max=36) String id, @Valid @RequestBody Revision body, HttpServletRequest request) {
        return ApiResponse.success(service.withdraw(id, strictRevision(body.expectedRevision()), operator(request)));
    }

    @GetMapping("/{id}/download")
    public ResponseEntity<byte[]> download(@PathVariable @Size(max=36) String id,
            @RequestParam @Min(1) @Max(Long.MAX_VALUE-1) long expectedRevision, HttpServletRequest request, HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store");
        return transfers.execute(() -> SdkDownloads.response(service.adminDownload(id, expectedRevision)));
    }

    /** CAS修订必须保留JSON整数原义，不能隐式截断小数或接受数字字符串。 */
    private long strictRevision(JsonNode value) {
        if (value == null || !value.isIntegralNumber() || !value.canConvertToLong()
                || value.longValue() < 1 || value.longValue() == Long.MAX_VALUE)
            throw new PlatformException(ErrorCode.INVALID_REQUEST, "预期修订必须为有效范围内的正JSON整数");
        return value.longValue();
    }

    private AccessOperator operator(HttpServletRequest request) {
        AdminSession session = AdminSession.current(request);
        return new AccessOperator(session.tenantId(), session.employeeNo(), MDC.get("requestId"), session.userId(), session.employeeId());
    }
}
