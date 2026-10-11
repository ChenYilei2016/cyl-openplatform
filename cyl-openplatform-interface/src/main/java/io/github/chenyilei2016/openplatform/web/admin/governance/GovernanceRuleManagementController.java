package io.github.chenyilei2016.openplatform.web.admin.governance;

import io.github.chenyilei2016.openplatform.application.governance.GovernanceRuleManagementService;
import io.github.chenyilei2016.openplatform.common.ApiResponse;
import io.github.chenyilei2016.openplatform.domain.access.AccessOperator;
import io.github.chenyilei2016.openplatform.domain.administration.AdminPermission;
import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PageResult;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.github.chenyilei2016.openplatform.domain.governance.GovernanceRule;
import io.github.chenyilei2016.openplatform.identity.AdminSession;
import io.github.chenyilei2016.openplatform.identity.RequireAdmin;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import jakarta.validation.Validator;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.util.EnumSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.slf4j.MDC;
import org.springframework.web.bind.annotation.*;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import static io.github.chenyilei2016.openplatform.application.governance.GovernanceRuleManagement.*;

/** 治理草稿与发布入口；组合目标同时要求凭据和API管理权限。 */
@RestController
@RequestMapping("/admin-api/governance-rules")
@RequireAdmin(permissions = {AdminPermission.MANAGE_APPLICATIONS, AdminPermission.MANAGE_APIS}, match = RequireAdmin.Match.ANY)
@RequiredArgsConstructor
public class GovernanceRuleManagementController {
    private final GovernanceRuleManagementService service;
    private final JsonMapper json;
    private final Validator validator;

    public record Create(@NotBlank @Size(max = 100) String name, @NotNull Config config) {}
    public record Save(@NotBlank @Size(max = 100) String name, @NotNull Config config,
                       @NotNull @Min(1) @Max(9007199254740991L) Long expectedDraftRevision) {}
    public record PreviewRequest(@Size(max = 36) String sourceReleaseId) {}
    public record Publish(@NotNull @Min(1) @Max(9007199254740991L) Long expectedDraftRevision,
                          @NotNull @Min(0) @Max(9007199254740990L) Long expectedStateVersion,
                          @Size(max = 36) String sourceReleaseId,
                          @NotNull @Pattern(regexp = "[0-9a-f]{64}") String previewDigest) {}

    @GetMapping
    public ApiResponse<PageResult<Draft>> page(@RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int pageSize, @RequestParam(required = false) String nameContains,
            @RequestParam(required = false) GovernanceRule.Type type, @RequestParam(required = false) String tenantId,
            @RequestParam(required = false) String appKey, @RequestParam(required = false) String apiId,
            @RequestParam(required = false) GovernanceRule.Mode mode, HttpServletRequest request, HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store");
        AdminSession session = AdminSession.current(request);
        if (type != null) require(session, type);
        return ApiResponse.success(service.page(new Query(page, pageSize, nameContains, type, tenantId, appKey, apiId, mode, allowedTypes(session))));
    }

    /** 当前页关联配置统计：targetType仅API/APPLICATION/TENANT（租户ID最多64字符，其余36），targetId重复参数1–100项；包含草稿/停用，缺失ID视为0。 */
    @GetMapping("/association-counts")
    public ApiResponse<Map<String, Long>> associationCounts(
            @RequestParam GovernanceRule.Type targetType,
            @RequestParam List<String> targetId,
            HttpServletRequest request, HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store");
        AdminSession session = AdminSession.current(request);
        require(session, targetType);
        return ApiResponse.success(service.associationCounts(targetType, targetId, allowedTypes(session)));
    }

    @GetMapping("/{id}")
    public ApiResponse<Draft> get(@PathVariable String id, HttpServletRequest request, HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store");
        return ApiResponse.success(authorized(id, request));
    }

    @PostMapping
    public ApiResponse<Draft> create(@RequestBody JsonNode input, HttpServletRequest request) {
        validateConfig(input);
        Create body = read(input, Create.class);
        AdminSession session = AdminSession.current(request);
        require(session, body.config().target().type());
        return ApiResponse.success(service.create(body.name(), body.config(), operator(session)));
    }

    @PutMapping("/{id}")
    public ApiResponse<Draft> save(@PathVariable String id, @RequestBody JsonNode input, HttpServletRequest request) {
        authorized(id, request); validateConfig(input);
        if (!input.path("expectedDraftRevision").isIntegralNumber()) throw invalid("expectedDraftRevision必须是整数");
        Save body = read(input, Save.class);
        return ApiResponse.success(service.save(id, body.name(), body.config(), body.expectedDraftRevision(), operator(AdminSession.current(request))));
    }

    @PostMapping("/{id}/preview")
    public ApiResponse<Preview> preview(@PathVariable String id, @Valid @RequestBody PreviewRequest body, HttpServletRequest request) {
        authorized(id, request); return ApiResponse.success(service.preview(id, body.sourceReleaseId()));
    }

    @PostMapping("/{id}/publish")
    public ApiResponse<Release> publish(@PathVariable String id, @RequestBody JsonNode input, HttpServletRequest request) {
        authorized(id, request);
        if (!input.path("expectedDraftRevision").isIntegralNumber() || !input.path("expectedStateVersion").isIntegralNumber())
            throw invalid("草稿修订和状态版本必须是整数");
        Publish body = read(input, Publish.class);
        return ApiResponse.success(service.publish(id, body.expectedDraftRevision(), body.expectedStateVersion(), body.sourceReleaseId(),
                body.previewDigest(), operator(AdminSession.current(request))));
    }

    @GetMapping("/{id}/releases")
    public ApiResponse<PageResult<Release>> releases(@PathVariable String id, @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int pageSize, HttpServletRequest request, HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store"); authorized(id, request);
        return ApiResponse.success(service.releases(id, page, pageSize));
    }

    @GetMapping("/{id}/results")
    public ApiResponse<Release> result(@PathVariable String id, @RequestParam String previewDigest,
            HttpServletRequest request, HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store"); authorized(id, request);
        return ApiResponse.success(service.result(id, previewDigest));
    }

    private Draft authorized(String id, HttpServletRequest request) {
        Draft draft = service.find(id); require(AdminSession.current(request), draft.config().target().type()); return draft;
    }
    private static Set<GovernanceRule.Type> allowedTypes(AdminSession session) {
        Set<GovernanceRule.Type> allowed = EnumSet.noneOf(GovernanceRule.Type.class);
        boolean applications = session.permissions().contains(AdminPermission.MANAGE_APPLICATIONS);
        boolean apis = session.permissions().contains(AdminPermission.MANAGE_APIS);
        if (applications) { allowed.add(GovernanceRule.Type.APPLICATION); allowed.add(GovernanceRule.Type.TENANT); }
        if (apis) allowed.add(GovernanceRule.Type.API);
        if (applications && apis) { allowed.add(GovernanceRule.Type.TENANT_API); allowed.add(GovernanceRule.Type.APPLICATION_API); }
        return allowed;
    }
    private static void require(AdminSession session, GovernanceRule.Type type) {
        if (type != GovernanceRule.Type.API) session.requirePermission(AdminPermission.MANAGE_APPLICATIONS);
        if (type == GovernanceRule.Type.API || type == GovernanceRule.Type.TENANT_API || type == GovernanceRule.Type.APPLICATION_API)
            session.requirePermission(AdminPermission.MANAGE_APIS);
    }
    private void validateConfig(JsonNode input) {
        JsonNode config = input.path("config");
        if (!input.isObject() || !config.isObject() || !config.path("enabled").isBoolean() || !config.path("dailyQuota").isIntegralNumber())
            throw invalid("config.enabled必须为布尔值，config.dailyQuota必须为整数");
        for (String field : new String[]{"perSecond", "burst"})
            if (!config.path("rate").path(field).isIntegralNumber()) throw invalid("config.rate." + field + "必须为整数");
    }
    private <T> T read(JsonNode input, Class<T> type) {
        T result;
        try { result = json.convertValue(input, type); }
        catch (RuntimeException invalid) { throw invalid("治理字段类型、目标组合或数值范围不合法"); }
        if (!validator.validate(result).isEmpty()) throw invalid("治理必填字段缺失或超出范围");
        return result;
    }
    private static AccessOperator operator(AdminSession session) { return new AccessOperator(session.tenantId(), session.employeeNo(), MDC.get("requestId"), session.userId(), session.employeeId()); }
    private static PlatformException invalid(String message) { return new PlatformException(ErrorCode.INVALID_REQUEST, message); }
}
