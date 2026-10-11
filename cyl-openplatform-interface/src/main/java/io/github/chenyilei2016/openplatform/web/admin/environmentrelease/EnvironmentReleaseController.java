package io.github.chenyilei2016.openplatform.web.admin.environmentrelease;

import io.github.chenyilei2016.openplatform.domain.access.EmployeeProfile;
import io.github.chenyilei2016.openplatform.domain.access.EmployeeProfileQuery;
import io.github.chenyilei2016.openplatform.domain.administration.AdminPermission;
import io.github.chenyilei2016.openplatform.application.environmentrelease.EnvironmentReleasePublisher;
import io.github.chenyilei2016.openplatform.common.ApiResponse;
import io.github.chenyilei2016.openplatform.domain.access.AccessOperator;
import io.github.chenyilei2016.openplatform.domain.catalog.*;
import io.github.chenyilei2016.openplatform.domain.common.*;
import io.github.chenyilei2016.openplatform.domain.environmentrelease.EnvironmentReleaseModels.*;
import io.github.chenyilei2016.openplatform.identity.RequireAdmin;
import io.github.chenyilei2016.openplatform.identity.AdminSession;
import io.github.chenyilei2016.openplatform.web.shared.common.JsonRequestReader;
import jakarta.servlet.http.*;
import jakarta.validation.Validator;
import jakarta.validation.constraints.*;
import java.io.IOException;
import java.math.BigInteger;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.slf4j.MDC;
import org.springframework.web.bind.annotation.*;
import tools.jackson.databind.json.JsonMapper;

/** 源环境研发明确确认后传输固定快照；刷新只收集实际目标节点观测。 */
@RequireAdmin(permissions = {AdminPermission.MANAGE_APIS, AdminPermission.PUBLISH_APIS, AdminPermission.REVIEW_APIS}, match = RequireAdmin.Match.ANY)
@RestController
@RequestMapping("/admin-api/environment-releases")
@RequiredArgsConstructor
public class EnvironmentReleaseController {
    private final EnvironmentReleasePublisher publisher;
    private final JsonRequestReader requests;
    private final JsonMapper json;
    private final Validator validator;

    public record PreviewInput(@NotBlank @Size(max=36) String releaseId,
                               @NotBlank @Size(max=48) String targetId, ApiBinding binding, @Size(max=36) String targetOwnerId) {}
    public record SendInput(@NotNull @Pattern(regexp="[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}") String transferId,
                            @NotBlank @Size(max=36) String releaseId, @NotBlank @Size(max=48) String targetId,
                            ApiBinding binding, @Size(max=36) String targetOwnerId, @NotNull @Min(0) @Max(Long.MAX_VALUE-1) Long expectedRevision,
                            @NotNull @Pattern(regexp="[0-9a-f]{64}") String previewDigest,
                            @NotNull @Size(max=500) String comment) {}

    @GetMapping("/targets")
    public ApiResponse<List<Target>> targets(HttpServletRequest request, HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store"); return ApiResponse.success(publisher.targets());
    }
    @GetMapping
    public ApiResponse<PageResult<TransferSummary>> page(@RequestParam(defaultValue="1") int page,
            @RequestParam(defaultValue="20") int pageSize, @RequestParam(required=false) String query,
            @RequestParam(required=false) @Size(max=36) String apiId,
            HttpServletRequest request, HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store"); return ApiResponse.success(publisher.page(new CatalogPageQuery(page, pageSize, query), apiId));
    }
    @GetMapping("/{id}")
    public ApiResponse<OutgoingTransfer> find(@PathVariable @Size(max=36) String id,
            HttpServletRequest request, HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store"); return ApiResponse.success(publisher.find(id));
    }
    @GetMapping("/targets/{targetId}/dubbo-connections")
    @RequireAdmin(permissions = AdminPermission.PUBLISH_APIS)
    public ApiResponse<ConnectionDirectory> connections(@PathVariable String targetId,
            @RequestParam(defaultValue = "1") int page, @RequestParam(defaultValue = "20") int pageSize,
            @RequestParam(defaultValue = "") String query, HttpServletRequest request, HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store");
        if (page < 1 || pageSize < 1 || pageSize > 100 || (long) (page - 1) * pageSize > 100_000 || query.length() > 100)
            throw new io.github.chenyilei2016.openplatform.domain.common.PlatformException(
                    io.github.chenyilei2016.openplatform.domain.common.ErrorCode.INVALID_REQUEST, "目录分页或查询条件不合法");
        return ApiResponse.success(publisher.connections(targetId, page, pageSize, query));
    }
    @GetMapping("/targets/{targetId}/owners")
    @RequireAdmin(permissions = AdminPermission.PUBLISH_APIS)
    public ApiResponse<PageResult<EmployeeProfile>> owners(@PathVariable String targetId,
            @RequestParam(defaultValue="1") int page, @RequestParam(defaultValue="20") int pageSize,
            @RequestParam(required=false) String name, @RequestParam(required=false) String employeeNo,
            HttpServletRequest request, HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store");
        return ApiResponse.success(publisher.owners(targetId, new EmployeeProfileQuery(
                AdminSession.current(request).tenantId(),employeeNo,name,page,pageSize)));
    }
    @PostMapping(value="/preview", consumes="application/json")
    @RequireAdmin(permissions = AdminPermission.PUBLISH_APIS)
    public ApiResponse<Preview> preview(HttpServletRequest request, HttpServletResponse response) throws IOException {
        response.setHeader("Cache-Control", "no-store");
        PreviewInput input = read(request, PreviewInput.class);
        return ApiResponse.success(publisher.preview(input.releaseId(), input.targetId(), input.binding(), input.targetOwnerId()));
    }
    @PostMapping(consumes="application/json")
    @RequireAdmin(permissions = AdminPermission.PUBLISH_APIS)
    public ApiResponse<OutgoingTransfer> send(HttpServletRequest request, HttpServletResponse response) throws IOException {
        AccessOperator operator = operator(request, response);
        SendInput input = read(request, SendInput.class);
        return ApiResponse.success(publisher.send(input.transferId(), input.releaseId(), input.targetId(), input.binding(), input.targetOwnerId(),
                input.expectedRevision(), input.previewDigest(), input.comment(), operator));
    }
    @PostMapping("/{id}/retry")
    @RequireAdmin(permissions = AdminPermission.PUBLISH_APIS)
    public ApiResponse<OutgoingTransfer> retry(@PathVariable @Size(max=36) String id,
            HttpServletRequest request, HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store"); return ApiResponse.success(publisher.retry(id));
    }
    @PostMapping("/{id}/refresh")
    @RequireAdmin(permissions = AdminPermission.PUBLISH_APIS)
    public ApiResponse<OutgoingTransfer> refresh(@PathVariable @Size(max=36) String id,
            HttpServletRequest request, HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store"); return ApiResponse.success(publisher.refresh(id));
    }
    private <T> T read(HttpServletRequest request, Class<T> type) throws IOException {
        var body = requests.readObject(request, 262_144);
        if (type == SendInput.class) {
            Object revision = body.get("expectedRevision");
            if (!(revision instanceof Integer || revision instanceof Long || revision instanceof BigInteger))
                throw new PlatformException(ErrorCode.INVALID_REQUEST, "预期目标修订必须为非负JSON整数");
        }
        try {
            T input = json.convertValue(body, type);
            if (!validator.validate(input).isEmpty()) throw new IllegalArgumentException();
            return input;
        } catch (IllegalArgumentException exception) {
            throw new PlatformException(ErrorCode.INVALID_REQUEST, "跨环境请求字段不合法");
        }
    }
    private AccessOperator operator(HttpServletRequest request, HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store");
        AdminSession session = AdminSession.current(request);
        return new AccessOperator(session.tenantId(), session.employeeNo(), MDC.get("requestId"), session.userId(), session.employeeId());
    }
}
