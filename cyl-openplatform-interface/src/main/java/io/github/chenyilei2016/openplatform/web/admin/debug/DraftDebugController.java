package io.github.chenyilei2016.openplatform.web.admin.debug;

import io.github.chenyilei2016.openplatform.web.shared.observability.DiagnosticContent;

import io.github.chenyilei2016.openplatform.application.debug.DebugCaller;
import io.github.chenyilei2016.openplatform.application.debug.DebugIdentityService;
import io.github.chenyilei2016.openplatform.application.debug.DraftDebugService;
import io.github.chenyilei2016.openplatform.domain.access.AccessPageQuery;
import io.github.chenyilei2016.openplatform.domain.common.PageResult;
import io.github.chenyilei2016.openplatform.common.ApiResponse;
import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.github.chenyilei2016.openplatform.domain.administration.AdminPermission;
import io.github.chenyilei2016.openplatform.domain.runtime.InvocationDiagnostics;
import io.github.chenyilei2016.openplatform.domain.token.TokenContext;
import io.github.chenyilei2016.openplatform.identity.AdminSession;
import io.github.chenyilei2016.openplatform.identity.RequireAdmin;
import io.github.chenyilei2016.openplatform.web.shared.observability.CallObservation;
import io.github.chenyilei2016.openplatform.web.shared.runtime.GatewayRequestReader;
import io.github.chenyilei2016.openplatform.web.shared.token.BearerToken;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import jakarta.validation.Validator;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
import java.io.IOException;
import java.net.InetAddress;
import java.math.BigInteger;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.slf4j.MDC;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.json.JsonMapper;

/** 预检不执行业务；执行每次重新授权。原始内容只在此有权管理入口脱敏显示。 */
@RequireAdmin(permissions = AdminPermission.MANAGE_APIS)
@RestController
@RequiredArgsConstructor
public class DraftDebugController {
    private final DraftDebugService debug;
    private final DebugIdentityService identities;
    private final GatewayRequestReader requests;
    private final JsonMapper json;
    private final Validator validator;
    private final DiagnosticContent content;
    private final PreparationLimiter preparations;
    /** 112：后台所选凭据授权；与 Authorization 头二选一。 */
    public record DebugIdentity(@NotBlank @Size(max = 36) String tenantGrantId, @Size(max = 36) String userGrantId) {}
    public record DebugRequest(@NotNull @Positive Long expectedRevision, @NotNull Map<String, Object> input, @Valid DebugIdentity identity) {}
    public record DebugView(String requestId, long draftRevision, long durationMillis, TokenContext identity,
                            InvocationDiagnostics.Outcome outcome, InvocationDiagnostics.Dispatch providerDispatch,
                            List<InvocationDiagnostics.Check> checks, DiagnosticContent.Content mappedInput,
                            DiagnosticContent.Content providerResponse, DiagnosticContent.Content adaptedData,
                            DiagnosticContent.Content publicResponse, DiagnosticContent.Message providerMessage) {}

    /** 有界只读预检：不消费业务治理配额，HTTP不进行GET/HEAD探测。 */
    @PostMapping(value = "/admin-api/apis/{id}/debug/preflight", consumes = "application/json")
    public ApiResponse<DebugView> preflight(@PathVariable @Size(max = 36) String id,
                                           HttpServletRequest request, HttpServletResponse response) throws IOException {
        response.setHeader("Cache-Control", "no-store");
        try (PreparationLimiter.Permit ignored = preparations.acquire()) {
            DebugRequest command = command(request);
            return ApiResponse.success(view(debug.preflight(id, command.expectedRevision(), caller(request, command), command.input(), MDC.get("requestId")), false));
        }
    }

    /** 保存修订CAS不符仍409；提供方/适配失败以outcome表达，HTTP200不代表业务成功。 */
    @PostMapping(value = "/admin-api/apis/{id}/debug", consumes = "application/json")
    public ResponseEntity<ApiResponse<DebugView>> invoke(@PathVariable @Size(max = 36) String id,
                                          HttpServletRequest request, HttpServletResponse response) throws IOException {
        response.setHeader("Cache-Control", "no-store");
        io.github.chenyilei2016.openplatform.domain.observability.CallRecord.CallRecordBuilder observation = CallObservation.current(request);
        try {
            AdminSession operator = AdminSession.current(request);
            observation.operatorTenantId(operator.tenantId()).operatorEmployeeNo(operator.employeeNo());
            DebugRequest command = command(request);
            DraftDebugService.DebugResult result = debug.invoke(id, command.expectedRevision(), caller(request, command), command.input(),
                    MDC.get("requestId"), InetAddress.ofLiteral(request.getRemoteAddr()).getHostAddress(), observation);
            DebugView view = view(result, true);
            if (result.diagnostics().error() == ErrorCode.INVALID_REQUEST)
                return ResponseEntity.badRequest().body(new ApiResponse<>(ErrorCode.INVALID_REQUEST.getCode(), result.diagnostics().message(), view, result.requestId()));
            return ResponseEntity.ok(ApiResponse.success(view));
        } catch (PlatformException exception) {
            observation.errorCode(exception.getErrorCode().getCode());
            throw exception;
        }
    }

    /** 112：可选调用身份——启用、有效租户授权且拥有此 API 任一权限组的凭据；AK 只显示末 4 位。 */
    @GetMapping("/admin-api/apis/{id}/debug/identities")
    public ApiResponse<PageResult<DebugIdentityService.Candidate>> identities(@PathVariable @Size(max = 36) String id,
            @RequestParam(defaultValue = "1") int page, @RequestParam(defaultValue = "20") int pageSize,
            @RequestParam(required = false) String query) {
        return ApiResponse.success(identities.candidates(id, new AccessPageQuery(page, pageSize, query)));
    }

    /** 112：所选凭据授权下的有效人员授权，供“指定调用员工”。 */
    @GetMapping("/admin-api/apis/{id}/debug/identities/{tenantGrantId}/employees")
    public ApiResponse<PageResult<DebugIdentityService.Employee>> employees(@PathVariable @Size(max = 36) String id,
            @PathVariable @Size(max = 36) String tenantGrantId, @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int pageSize, @RequestParam(required = false) String query) {
        return ApiResponse.success(identities.employees(id, tenantGrantId, new AccessPageQuery(page, pageSize, query)));
    }

    /** 业务 Token 与所选凭据二选一；凭据方式记录后台操作者。 */
    private DebugCaller caller(HttpServletRequest request, DebugRequest command) {
        if (command.identity() == null) return new DebugCaller.Bearer(BearerToken.read(request));
        if (request.getHeader("Authorization") != null)
            throw new PlatformException(ErrorCode.INVALID_REQUEST, "调用身份和业务 Token 只能选择一种");
        AdminSession operator = AdminSession.current(request);
        return new DebugCaller.Credential(command.identity().tenantGrantId(), command.identity().userGrantId(),
                operator.tenantId(), operator.employeeNo());
    }

    private DebugRequest command(HttpServletRequest request) throws IOException {
        Map<String, Object> body = requests.readObject(request);
        Object revision = body.get("expectedRevision");
        if (!(revision instanceof Integer || revision instanceof Long || revision instanceof BigInteger))
            throw new PlatformException(ErrorCode.INVALID_REQUEST, "expectedRevision必须是正整数JSON值");
        DebugRequest command;
        try { command = json.convertValue(body, DebugRequest.class); }
        catch (RuntimeException invalid) { throw new PlatformException(ErrorCode.INVALID_REQUEST, "调试请求只接受expectedRevision、input和identity"); }
        if (!validator.validate(command).isEmpty()) throw new PlatformException(ErrorCode.INVALID_REQUEST, "请提供有效草稿修订号和JSON对象input");
        return command;
    }

    private DebugView view(DraftDebugService.DebugResult result, boolean executed) {
        InvocationDiagnostics trace = result.diagnostics();
        ApiResponse<Object> publicResult = new ApiResponse<>(trace.error() == null ? 200 : trace.error().getCode(),
                trace.error() == null ? "成功" : trace.message(), trace.data(), result.requestId());
        List<InvocationDiagnostics.Check> checks = trace.checks().stream().map(check -> new InvocationDiagnostics.Check(check.stage(), check.status(),
                check.reason(), content.message(check.summary()).value(), check.issues())).toList();
        return new DebugView(result.requestId(), result.draftRevision(), result.durationMillis(), result.identity(), trace.outcome(), trace.providerDispatch(), checks,
                content.debugView(trace.mappedInput()), content.debugView(trace.providerResponse()), content.debugView(trace.adaptedData()),
                executed ? content.debugView(InvocationDiagnostics.Capture.of(publicResult)) : DiagnosticContent.Content.unavailable("预检未调用提供方，没有业务返回"),
                content.message(trace.providerMessage()));
    }
}
