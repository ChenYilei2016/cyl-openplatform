package io.github.chenyilei2016.openplatform.web.portal.mcp;

import io.github.chenyilei2016.openplatform.application.mcp.McpTenantActivationService;
import io.github.chenyilei2016.openplatform.common.ApiResponse;
import io.github.chenyilei2016.openplatform.domain.access.AccessOperator;
import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.github.chenyilei2016.openplatform.identity.PortalSession;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.slf4j.MDC;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 门户“MCP 开通”：本租户任意有效员工可开通、停用、启用；租户只取自平台登录会话，请求不能指定。 */
@RestController
@RequestMapping("/portal-api/mcp/activation")
@RequiredArgsConstructor
public class PortalMcpController {
    private final McpTenantActivationService activations;

    public record ChangeStatus(@NotNull Boolean enabled) {}

    /** 未开通时 data 为 null。 */
    @GetMapping
    public ApiResponse<McpTenantActivationService.ActivationView> activation(HttpServletRequest request) {
        return ApiResponse.success(activations.current(operator(request)).orElse(null));
    }

    @PostMapping
    public ApiResponse<McpTenantActivationService.ActivationView> open(
            @RequestBody(required = false) Map<String, Object> body, HttpServletRequest request) {
        if (body != null && !body.isEmpty()) throw new PlatformException(ErrorCode.INVALID_REQUEST, "开通请求不能指定租户或其他信息");
        return ApiResponse.success(activations.open(operator(request)));
    }

    @PutMapping("/status")
    public ApiResponse<McpTenantActivationService.ActivationView> changeStatus(
            @Valid @RequestBody ChangeStatus body, HttpServletRequest request) {
        return ApiResponse.success(activations.changeOwnStatus(body.enabled(), operator(request)));
    }

    private AccessOperator operator(HttpServletRequest request) {
        PortalSession session = PortalSession.current(request);
        return new AccessOperator(session.tenantId(), session.employeeNo(), MDC.get("requestId"), session.userId(), session.employeeId());
    }
}
