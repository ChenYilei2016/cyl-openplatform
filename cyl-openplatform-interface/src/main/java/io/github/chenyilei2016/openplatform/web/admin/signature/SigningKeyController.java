package io.github.chenyilei2016.openplatform.web.admin.signature;

import io.github.chenyilei2016.openplatform.application.signature.SigningKeyService;
import io.github.chenyilei2016.openplatform.common.ApiResponse;
import io.github.chenyilei2016.openplatform.domain.access.AccessOperator;
import io.github.chenyilei2016.openplatform.domain.access.ApplicationKind;
import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.github.chenyilei2016.openplatform.domain.signature.SigningKey;
import io.github.chenyilei2016.openplatform.domain.administration.AdminPermission;
import io.github.chenyilei2016.openplatform.identity.AdminSession;
import io.github.chenyilei2016.openplatform.identity.RequireAdmin;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.constraints.Pattern;
import lombok.RequiredArgsConstructor;
import org.slf4j.MDC;
import org.springframework.web.bind.annotation.*;
import tools.jackson.databind.JsonNode;

/** 应用管理员维护普通凭据的独立签名密钥；明文只出现在成功签发响应。MCP 网关凭据的密钥在“MCP 接入”管理。 */
@RequireAdmin(permissions = AdminPermission.MANAGE_APPLICATIONS)
@RestController
@RequestMapping("/admin-api/applications/{id}/signing-key")
@RequiredArgsConstructor
public class SigningKeyController {
    private final SigningKeyService service;

    @GetMapping
    public ApiResponse<SigningKeyService.KeyView> get(@PathVariable @Pattern(regexp = "[a-zA-Z0-9_-]{1,36}") String id,
            HttpServletRequest request, HttpServletResponse response) {
        operator(request, response);
        return ApiResponse.success(service.get(id, ApplicationKind.STANDARD));
    }
    @PostMapping
    public ApiResponse<SigningKeyService.IssuedKey> create(@PathVariable @Pattern(regexp = "[a-zA-Z0-9_-]{1,36}") String id,
            @RequestBody JsonNode body, HttpServletRequest request, HttpServletResponse response) {
        return ApiResponse.success(service.issue(id, ApplicationKind.STANDARD, revision(body), false, operator(request, response)));
    }
    @PostMapping("/rotate")
    public ApiResponse<SigningKeyService.IssuedKey> rotate(@PathVariable @Pattern(regexp = "[a-zA-Z0-9_-]{1,36}") String id,
            @RequestBody JsonNode body, HttpServletRequest request, HttpServletResponse response) {
        return ApiResponse.success(service.issue(id, ApplicationKind.STANDARD, revision(body), true, operator(request, response)));
    }
    @PostMapping("/revoke")
    public ApiResponse<SigningKey> revoke(@PathVariable @Pattern(regexp = "[a-zA-Z0-9_-]{1,36}") String id,
            @RequestBody JsonNode body, HttpServletRequest request, HttpServletResponse response) {
        return ApiResponse.success(service.revoke(id, ApplicationKind.STANDARD, revision(body), operator(request, response)));
    }
    private long revision(JsonNode body) {
        var value = body.path("expectedRevision");
        if (!body.isObject() || body.size() != 1 || !value.isIntegralNumber() || !value.canConvertToLong()
                || value.asLong() < 0 || value.asLong() > 9007199254740990L)
            throw new PlatformException(ErrorCode.INVALID_REQUEST, "expectedRevision必须为非负安全整数JSON值");
        return value.asLong();
    }
    private AccessOperator operator(HttpServletRequest request, HttpServletResponse response) {
        AdminSession session = AdminSession.current(request);
        response.setHeader("Cache-Control", "no-store");
        return new AccessOperator(session.tenantId(), session.employeeNo(), MDC.get("requestId"), session.userId(), session.employeeId());
    }
}
