package io.github.chenyilei2016.openplatform.web.admin.operations;

import io.github.chenyilei2016.openplatform.application.operations.AlertService;
import io.github.chenyilei2016.openplatform.common.ApiResponse;
import io.github.chenyilei2016.openplatform.domain.access.AccessOperator;
import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PageResult;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.github.chenyilei2016.openplatform.domain.operations.*;
import io.github.chenyilei2016.openplatform.domain.administration.AdminPermission;
import io.github.chenyilei2016.openplatform.identity.AdminSession;
import io.github.chenyilei2016.openplatform.identity.RequireAdmin;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import java.math.BigDecimal;
import lombok.RequiredArgsConstructor;
import org.slf4j.MDC;
import org.springframework.web.bind.annotation.*;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** 平台正式调用站内告警；读审计权限与策略维护权限分离，不触发外部通知。 */
@RestController
@RequestMapping("/admin-api/operations/alerts")
@RequiredArgsConstructor
public class AlertController {
    private final AlertService service;
    private final JsonMapper json;
    public record ChangePolicy(long expectedVersion, int windowMinutes, long minRequests, boolean failureEnabled,
                               BigDecimal failureRateThreshold, boolean latencyEnabled, long averageLatencyThresholdMillis) {}

    @GetMapping("/policy")
    @RequireAdmin(permissions = AdminPermission.VIEW_AUDIT)
    public ApiResponse<OperationsAlertPolicy> policy(HttpServletRequest request, HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store");
        return ApiResponse.success(service.policy());
    }

    @PutMapping("/policy")
    @RequireAdmin(permissions = AdminPermission.MANAGE_OPERATIONS)
    public ApiResponse<OperationsAlertPolicy> update(@RequestBody JsonNode input, HttpServletRequest request, HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store");
        AdminSession session = AdminSession.current(request);
        if (!input.isObject() || !input.path("expectedVersion").isIntegralNumber()
                || !input.path("windowMinutes").isIntegralNumber() || !input.path("minRequests").isIntegralNumber()
                || !input.path("averageLatencyThresholdMillis").isIntegralNumber()
                || !input.path("failureRateThreshold").isNumber() || !input.path("failureEnabled").isBoolean()
                || !input.path("latencyEnabled").isBoolean()) {
            throw new PlatformException(ErrorCode.INVALID_REQUEST, "告警策略需使用严格JSON整数、数值和布尔值");
        }
        ChangePolicy body;
        try { body = json.convertValue(input, ChangePolicy.class); }
        catch (RuntimeException failure) { throw new PlatformException(ErrorCode.INVALID_REQUEST, "告警策略字段或数值范围不合法"); }
        if (body.expectedVersion() < 0 || body.expectedVersion() > 9007199254740990L)
            throw new PlatformException(ErrorCode.INVALID_REQUEST, "策略版本超出有效范围");
        var replacement = new OperationsAlertPolicy(body.expectedVersion() + 1, body.windowMinutes(), body.minRequests(),
                body.failureEnabled(), body.failureRateThreshold(), body.latencyEnabled(), body.averageLatencyThresholdMillis());
        return ApiResponse.success(service.update(replacement, body.expectedVersion(),
                new AccessOperator(session.tenantId(), session.employeeNo(), MDC.get("requestId"), session.userId(), session.employeeId())));
    }

    @GetMapping("/state")
    @RequireAdmin(permissions = AdminPermission.VIEW_AUDIT)
    public ApiResponse<AlertOverview> state(HttpServletRequest request, HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store");
        return ApiResponse.success(service.overview());
    }

    @GetMapping("/events")
    @RequireAdmin(permissions = AdminPermission.VIEW_AUDIT)
    public ApiResponse<PageResult<AlertEvent>> events(@RequestParam(defaultValue = "1") @Min(1) int page,
            @RequestParam(defaultValue = "20") @Min(1) @Max(100) int pageSize,
            HttpServletRequest request, HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store");
        return ApiResponse.success(service.events(page, pageSize));
    }

    @PostMapping("/evaluate")
    @RequireAdmin(permissions = AdminPermission.MANAGE_OPERATIONS)
    public ApiResponse<AlertOverview> evaluate(@RequestBody(required = false) JsonNode input,
            HttpServletRequest request, HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store");
        if (input != null && (!input.isObject() || !input.isEmpty()))
            throw new PlatformException(ErrorCode.INVALID_REQUEST, "立即评估只接受空请求或空JSON对象");
        return ApiResponse.success(service.evaluate());
    }

}
