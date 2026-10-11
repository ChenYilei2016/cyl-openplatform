package io.github.chenyilei2016.openplatform.web.admin.connection;

import io.github.chenyilei2016.openplatform.application.connection.DubboConnectionService;
import io.github.chenyilei2016.openplatform.application.connection.DubboConnectionService.*;
import io.github.chenyilei2016.openplatform.common.ApiResponse;
import io.github.chenyilei2016.openplatform.domain.access.AccessOperator;
import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PageResult;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.github.chenyilei2016.openplatform.domain.connection.*;
import io.github.chenyilei2016.openplatform.domain.connection.DubboConnectionRepository.RevisionSummary;
import io.github.chenyilei2016.openplatform.domain.administration.AdminPermission;
import io.github.chenyilei2016.openplatform.identity.AdminSession;
import io.github.chenyilei2016.openplatform.identity.RequireAdmin;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Validator;
import jakarta.validation.constraints.*;
import lombok.RequiredArgsConstructor;
import org.slf4j.MDC;
import org.springframework.web.bind.annotation.*;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** 当前部署环境的服务连接管理；API维护者只能读安全摘要及只读注册中心检查。 */
@RequireAdmin(permissions = {AdminPermission.MANAGE_APIS, AdminPermission.MANAGE_CONNECTIONS}, match = RequireAdmin.Match.ANY)
@RestController
@RequestMapping("/admin-api/dubbo-connections")
@RequiredArgsConstructor
public class DubboConnectionController {
    private final DubboConnectionService service;
    private final DubboConnectionUsageRepository usages;
    private final DubboConnectionRuntime runtime;
    private final JsonMapper json;
    private final Validator validator;

    public record Create(@NotBlank @Size(max = 100) String name, @Size(max = 2000) String description,
                         @NotNull DubboConnectionConfig config) {}
    public record SaveDraft(@NotNull @Min(1) @Max(Long.MAX_VALUE - 1) Long expectedStateVersion,
                            @NotBlank @Size(max = 100) String name, @Size(max = 2000) String description,
                            @NotNull DubboConnectionConfig config) {}
    public record Activate(@NotNull @Min(1) @Max(Long.MAX_VALUE - 1) Long expectedStateVersion,
                           @NotNull @Min(1) Long revision) {}
    public record Status(@NotNull @Min(1) @Max(Long.MAX_VALUE - 1) Long expectedStateVersion, @NotNull Boolean enabled) {}
    public record DiagnosticRequest(@NotNull @Min(1) Long revision) {}

    @GetMapping("/configuration")
    @RequireAdmin(permissions = AdminPermission.MANAGE_CONNECTIONS)
    public ApiResponse<Configuration> configuration(HttpServletRequest request) {
        return ApiResponse.success(service.configuration());
    }

    @GetMapping
    public ApiResponse<PageResult<DubboConnectionSummary>> page(@RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int pageSize, @RequestParam(required = false) String query, HttpServletRequest request) {
        return ApiResponse.success(service.page(page, pageSize, query, false));
    }

    @GetMapping("/options")
    public ApiResponse<PageResult<DubboConnectionSummary>> options(@RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int pageSize, @RequestParam(required = false) String query, HttpServletRequest request) {
        return ApiResponse.success(service.page(page, pageSize, query, true));
    }

    /** API工作区的固定引用摘要；单对象读取，不包含地址、凭据引用或连接配置。 */
    @GetMapping("/{id}/summary")
    public ApiResponse<DubboConnectionSummary> summary(@PathVariable @Size(max = 36) String id) {
        return ApiResponse.success(service.summary(id));
    }

    @GetMapping("/{id}")
    @RequireAdmin(permissions = AdminPermission.MANAGE_CONNECTIONS)
    public ApiResponse<Detail> detail(@PathVariable String id, HttpServletRequest request) {
        return ApiResponse.success(service.detail(id));
    }

    @PostMapping
    @RequireAdmin(permissions = AdminPermission.MANAGE_CONNECTIONS)
    public ApiResponse<Detail> create(@RequestBody JsonNode input, HttpServletRequest request) {
        AccessOperator operator = manager(request);
        Create body = read(input, Create.class);
        return ApiResponse.success(service.create(body.name(), body.description(), body.config(), operator));
    }

    @PutMapping("/{id}/draft")
    @RequireAdmin(permissions = AdminPermission.MANAGE_CONNECTIONS)
    public ApiResponse<Detail> saveDraft(@PathVariable String id, @RequestBody JsonNode input, HttpServletRequest request) {
        AccessOperator operator = manager(request);
        requireInteger(input, "expectedStateVersion");
        SaveDraft body = read(input, SaveDraft.class);
        return ApiResponse.success(service.saveDraft(id, body.expectedStateVersion(), body.name(), body.description(), body.config(), operator));
    }

    @PostMapping("/{id}/activate")
    @RequireAdmin(permissions = AdminPermission.MANAGE_CONNECTIONS)
    public ApiResponse<Detail> activate(@PathVariable String id, @RequestBody JsonNode input, HttpServletRequest request) {
        AccessOperator operator = manager(request);
        requireInteger(input, "expectedStateVersion"); requireInteger(input, "revision");
        Activate body = read(input, Activate.class);
        Detail result = service.activate(id, body.expectedStateVersion(), body.revision(), operator);
        if (result.connection().enabled()) runtime.warmup(id, body.revision());
        return ApiResponse.success(result);
    }

    @PutMapping("/{id}/status")
    @RequireAdmin(permissions = AdminPermission.MANAGE_CONNECTIONS)
    public ApiResponse<Detail> status(@PathVariable String id, @RequestBody JsonNode input, HttpServletRequest request) {
        AccessOperator operator = manager(request);
        requireInteger(input, "expectedStateVersion");
        if (!input.path("enabled").isBoolean()) throw new PlatformException(ErrorCode.INVALID_REQUEST, "enabled必须是JSON布尔值");
        Status body = read(input, Status.class);
        return ApiResponse.success(service.status(id, body.expectedStateVersion(), body.enabled(), operator));
    }

    @GetMapping("/{id}/revisions")
    public ApiResponse<PageResult<RevisionSummary>> revisions(@PathVariable String id,
            @RequestParam(defaultValue = "1") int page, @RequestParam(defaultValue = "20") int pageSize, HttpServletRequest request) {
        return ApiResponse.success(service.revisions(id, page, pageSize));
    }

    @GetMapping("/{id}/revisions/{revision}")
    @RequireAdmin(permissions = AdminPermission.MANAGE_CONNECTIONS)
    public ApiResponse<DubboConnectionRevision> revision(@PathVariable String id, @PathVariable long revision, HttpServletRequest request) {
        return ApiResponse.success(service.revision(id, revision));
    }

    @GetMapping("/{id}/references")
    public ApiResponse<PageResult<DubboConnectionUsageRepository.Usage>> references(@PathVariable String id,
            @RequestParam(defaultValue = "1") int page, @RequestParam(defaultValue = "20") int pageSize, HttpServletRequest request) {
        service.find(id); DubboConnectionService.validatePage(page, pageSize, null);
        return ApiResponse.success(usages.page(id, page, pageSize));
    }

    @PostMapping("/{id}/diagnostics")
    public ApiResponse<DubboConnectionRuntime.DiagnosticResult> diagnostics(@PathVariable String id,
            @RequestBody JsonNode input, HttpServletRequest request) {
        service.find(id); requireInteger(input, "revision");
        DiagnosticRequest body = read(input, DiagnosticRequest.class);
        return ApiResponse.success(runtime.diagnose(id, body.revision()));
    }

    private <T> T read(JsonNode input, Class<T> type) {
        if (!input.isObject()) throw new PlatformException(ErrorCode.INVALID_REQUEST, "请求必须为JSON对象");
        JsonNode database = input.at("/config/metadata/database");
        if (!database.isMissingNode() && !database.isNull() && (!database.isIntegralNumber() || !database.canConvertToInt()))
            throw new PlatformException(ErrorCode.INVALID_REQUEST, "Redis database必须为JSON非负整数");
        try {
            T body = json.treeToValue(input, type);
            if (!validator.validate(body).isEmpty()) throw new IllegalArgumentException();
            return body;
        } catch (RuntimeException failure) {
            throw new PlatformException(ErrorCode.INVALID_REQUEST, "连接请求字段类型、必填项或范围不合法");
        }
    }

    private static void requireInteger(JsonNode input, String field) {
        if (!input.path(field).isIntegralNumber()) throw new PlatformException(ErrorCode.INVALID_REQUEST, field + "必须为JSON整数");
    }

    private static AccessOperator manager(HttpServletRequest request) {
        AdminSession session = AdminSession.current(request);
        return new AccessOperator(session.tenantId(), session.employeeNo(), MDC.get("requestId"), session.userId(), session.employeeId());
    }
}
