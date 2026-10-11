package io.github.chenyilei2016.openplatform.web.admin.mcp;

import io.github.chenyilei2016.openplatform.application.mcp.McpGatewayCredentialService;
import io.github.chenyilei2016.openplatform.application.mcp.McpTenantActivationService;
import io.github.chenyilei2016.openplatform.common.ApiResponse;
import io.github.chenyilei2016.openplatform.domain.access.AccessOperator;
import io.github.chenyilei2016.openplatform.domain.access.AccessPageQuery;
import io.github.chenyilei2016.openplatform.domain.administration.AdminPermission;
import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PageResult;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.github.chenyilei2016.openplatform.domain.mcp.McpActivationStatus;
import io.github.chenyilei2016.openplatform.identity.AdminSession;
import io.github.chenyilei2016.openplatform.identity.RequireAdmin;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.slf4j.MDC;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** “MCP 接入”管理：每环境唯一的网关凭据与租户开通；签名密钥明文只出现在创建或轮换的响应中。 */
@RequireAdmin(permissions = AdminPermission.MANAGE_APPLICATIONS)
@RestController
@RequestMapping("/admin-api/mcp")
@RequiredArgsConstructor
public class McpManagementController {
    private final McpGatewayCredentialService gateway;
    private final McpTenantActivationService activations;

    public record RotateKey(@NotNull @PositiveOrZero @Max(9007199254740990L) Long expectedRevision) {}
    public record ChangeStatus(@NotNull Boolean enabled) {}

    @GetMapping("/gateway-credential")
    public ApiResponse<McpGatewayCredentialService.Overview> gatewayCredential(HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store");
        return ApiResponse.success(gateway.overview());
    }

    /** 创建一次：返回 KeyId 与一次性签名密钥；不接受客户端指定任何字段。 */
    @PostMapping("/gateway-credential")
    public ApiResponse<McpGatewayCredentialService.IssuedCredential> createGatewayCredential(
            @RequestBody(required = false) Map<String, Object> body, HttpServletRequest request, HttpServletResponse response) {
        if (body != null && !body.isEmpty()) throw new PlatformException(ErrorCode.INVALID_REQUEST, "创建网关凭据不接受额外参数");
        response.setHeader("Cache-Control", "no-store");
        return ApiResponse.success(gateway.create(operator(request)));
    }

    @PostMapping("/gateway-credential/rotate")
    public ApiResponse<McpGatewayCredentialService.IssuedCredential> rotateGatewayKey(
            @Valid @RequestBody RotateKey body, HttpServletRequest request, HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store");
        return ApiResponse.success(gateway.rotate(body.expectedRevision(), operator(request)));
    }

    @PutMapping("/gateway-credential/status")
    public ApiResponse<McpGatewayCredentialService.CredentialView> setGatewayStatus(
            @Valid @RequestBody ChangeStatus body, HttpServletRequest request) {
        return ApiResponse.success(gateway.setStatus(body.enabled(), operator(request)));
    }

    /** tenantId 为精确匹配。 */
    @GetMapping("/tenant-activations")
    public ApiResponse<PageResult<McpTenantActivationService.ActivationView>> tenantActivations(
            @RequestParam(defaultValue = "1") int page, @RequestParam(defaultValue = "20") int pageSize,
            @RequestParam(required = false) @Size(max = 64) String tenantId,
            @RequestParam(required = false) McpActivationStatus status) {
        return ApiResponse.success(activations.page(new AccessPageQuery(page, pageSize, tenantId), status));
    }

    @PutMapping("/tenant-activations/{id}/status")
    public ApiResponse<McpTenantActivationService.ActivationView> setActivationStatus(
            @PathVariable @Size(max = 64) String id, @Valid @RequestBody ChangeStatus body, HttpServletRequest request) {
        return ApiResponse.success(activations.changeStatus(id, body.enabled(), operator(request)));
    }

    private AccessOperator operator(HttpServletRequest request) {
        AdminSession session = AdminSession.current(request);
        return new AccessOperator(session.tenantId(), session.employeeNo(), MDC.get("requestId"), session.userId(), session.employeeId());
    }
}
