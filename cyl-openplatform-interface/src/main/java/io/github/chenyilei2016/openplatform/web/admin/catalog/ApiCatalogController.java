package io.github.chenyilei2016.openplatform.web.admin.catalog;

import io.github.chenyilei2016.openplatform.domain.common.ObjectIdType;
import io.github.chenyilei2016.openplatform.application.catalog.ApiCatalogService;
import io.github.chenyilei2016.openplatform.application.catalog.ApiDraftSaveResult;
import com.fasterxml.jackson.annotation.JsonUnwrapped;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiDocument;
import io.github.chenyilei2016.openplatform.common.ApiResponse;
import io.github.chenyilei2016.openplatform.domain.access.Scope;
import io.github.chenyilei2016.openplatform.domain.catalog.*;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiDefinition.ErrorDefinition;
import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.FieldValidation;
import io.github.chenyilei2016.openplatform.domain.common.PageResult;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.github.chenyilei2016.openplatform.domain.administration.AdminPermission;
import io.github.chenyilei2016.openplatform.identity.AdminSession;
import io.github.chenyilei2016.openplatform.identity.RequireAdmin;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import org.slf4j.MDC;
import org.springframework.web.bind.annotation.*;
import java.util.List;
import java.util.Set;
import java.io.IOException;
import io.github.chenyilei2016.openplatform.web.shared.common.JsonRequestReader;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.ObjectReader;

/** API目录草稿管理及受控文档预览；所有入口均强制MANAGE_APIS权限。 */
@RequireAdmin(permissions = AdminPermission.MANAGE_APIS)
@RestController
@RequestMapping("/admin-api/apis")
public class ApiCatalogController {
    private final ApiCatalogService catalog;
    private final io.github.chenyilei2016.openplatform.application.catalog.ApiWorkspaceService workspaces;
    private final JsonRequestReader bodies;
    private final ObjectReader valueReader;
    private final ObjectReader schemaReader;
    private final ApiDraftRequestReader draftBodies;

    public ApiCatalogController(ApiCatalogService catalog, JsonRequestReader bodies, JsonMapper json, ApiDraftRequestReader draftBodies,
                                io.github.chenyilei2016.openplatform.application.catalog.ApiWorkspaceService workspaces) {
        this.workspaces = workspaces;
        this.catalog = catalog;
        this.bodies = bodies;
        this.draftBodies = draftBodies;
        valueReader = json.readerFor(Object.class).with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS);
        // 编辑器切换模式不能借Jackson标量转换悄悄改写原文；使用受控副本，不改变外部身份适配。
        schemaReader = draftBodies.readerFor(SchemaNode.class);
    }

    public record PortalVisibility(@NotNull Boolean visible) {}

    /** 当前环境API的门户展示设置；不改变发布或正式调用权限。 */
    @GetMapping("/{id}/portal-visibility")
    public ApiResponse<PortalVisibility> portalVisibility(@PathVariable @Size(max=36) String id) {
        return ApiResponse.success(new PortalVisibility(catalog.portalVisible(id)));
    }

    @PutMapping(value="/{id}/portal-visibility", consumes="application/json")
    public ApiResponse<PortalVisibility> portalVisibility(@PathVariable @Size(max=36) String id, HttpServletRequest request) throws IOException {
        PortalVisibility body = draftBodies.read(request, PortalVisibility.class);
        AdminSession session = AdminSession.current(request);
        boolean visible = catalog.setPortalVisible(id, body.visible(), new io.github.chenyilei2016.openplatform.domain.access.AccessOperator(
                session.tenantId(), session.employeeNo(), MDC.get("requestId"), session.userId(), session.employeeId()));
        return ApiResponse.success(new PortalVisibility(visible));
    }

    public record SaveApiRequest(String service, String version, String method, String name, String category, String owner,
                                 @NotNull @Size(max = 100) List<@NotNull String> scopeCodes,
                                 @NotNull SchemaNode requestSchema, @NotNull SchemaNode responseSchema,
                                 @NotNull @Size(max = 50) List<@NotNull ErrorDefinition> errorDefinitions,
                                 @NotNull ApiBinding binding, @NotNull @Size(max = 100) List<@NotNull ParameterMapping> mappings,
                                 Long expectedRevision, ApiLifecycle lifecycle, @Size(max = 5000) String description, Boolean employeeRequired, ResponseAdapter responseAdapter,
                                 ApiOperationKind operationKind, @Size(max = 520) String idempotencyField, McpToolConfig mcpTool) {
        public ApiDefinition definition(String id, long revision) {
            return new ApiDefinition(id, service, version, method, name, category, owner, binding.protocol(), revision,
                    scopeCodes, requestSchema, responseSchema, errorDefinitions, binding, mappings, lifecycle, description, employeeRequired, responseAdapter,
                    operationKind, idempotencyField, mcpTool);
        }
    }

    @PostMapping(consumes = "application/json")
    public ApiResponse<ApiDefinition> create(HttpServletRequest request) throws IOException {
        AdminSession operator = AdminSession.current(request);
        SaveApiRequest body = readSave(request);
        validateBaseline(null, body);
        return ApiResponse.success(catalog.create(body.definition(ObjectIdType.API.nextId(), 1), ApiRevisionSource.CREATE_API_DRAFT,
                operator.tenantId(), operator.employeeNo(), MDC.get("requestId")));
    }

    public record SaveApiResponse(@JsonUnwrapped ApiDefinition definition, boolean changed) {}

    @PutMapping(value = "/{id}", consumes = "application/json")
    public ApiResponse<SaveApiResponse> update(@PathVariable @Size(max = 36) String id, HttpServletRequest request) throws IOException {
        AdminSession operator = AdminSession.current(request);
        SaveApiRequest body = readSave(request);
        validateBaseline(id, body);
        ApiDraftSaveResult saved = catalog.update(body.definition(id, body.expectedRevision() + 1), body.expectedRevision(),
                operator.tenantId(), operator.employeeNo(), MDC.get("requestId"));
        return ApiResponse.success(new SaveApiResponse(saved.definition(), saved.changed()));
    }

    public record ChangeScope(@NotNull @Min(1) @Max(Long.MAX_VALUE - 1) Long expectedRevision,
                              @NotBlank @Pattern(regexp = "[a-z0-9][a-z0-9_.:-]{0,63}") String scopeCode,
                              @NotNull Boolean included) {}

    /** 权限组抽屉增删 API：只改草稿 scopeCodes 并生成新草稿修订，需发布后才影响调用。 */
    @PutMapping(value = "/{id}/scope-codes", consumes = "application/json")
    public ApiResponse<SaveApiResponse> changeScope(@PathVariable @Size(max = 36) String id, @Valid @RequestBody ChangeScope body,
                                                    HttpServletRequest request) {
        AdminSession operator = AdminSession.current(request);
        ApiDraftSaveResult saved = catalog.changeScope(id, body.expectedRevision(), body.scopeCode(), body.included(),
                operator.tenantId(), operator.employeeNo(), MDC.get("requestId"));
        return ApiResponse.success(new SaveApiResponse(saved.definition(), saved.changed()));
    }

    /** 只读校验未保存配置；已有API必带expectedRevision。不生成修订或调用提供方。 */
    @PostMapping(value = {"/validate", "/{id}/validate"}, consumes = "application/json")
    public ApiResponse<ApiCatalogService.ValidationResult> validateCandidate(
            @PathVariable(required = false) @Size(max = 36) String id,
            @RequestParam(defaultValue = "false") boolean newOperation, HttpServletRequest request) throws IOException {
        SaveApiRequest body = readSave(request);
        validateBaseline(id, body);
        return ApiResponse.success(catalog.validateCandidate(body.definition(id == null ? ObjectIdType.API.nextId() : id,
                body.expectedRevision() == null ? 1 : body.expectedRevision() + 1), body.expectedRevision(), newOperation && id == null));
    }

    private void validateBaseline(String id, SaveApiRequest body) {
        if (id == null && body.expectedRevision() != null)
            throw new PlatformException(ErrorCode.INVALID_REQUEST, "新增草稿不能指定expectedRevision");
        if (id != null) {
            if (body.expectedRevision() == null || body.expectedRevision() < 1 || body.expectedRevision() == Long.MAX_VALUE)
                throw new PlatformException(ErrorCode.INVALID_REQUEST, "expectedRevision必须为有效草稿修订号");
            if (body.lifecycle() == null || body.operationKind() == null || body.idempotencyField() == null || body.mcpTool() == null)
                requireCarried(body, catalog.find(id));
        }
    }

    /** 旧客户端省略字段时会按默认值覆盖；已有非默认配置必须明确携带，清除幂等字段请传空字符串。 */
    private static void requireCarried(SaveApiRequest body, ApiDefinition existing) {
        FieldValidation checks = new FieldValidation();
        var required = FieldValidation.Reason.REQUIRED;
        if (body.lifecycle() == null && !existing.lifecycle().isDefault())
            checks.add(new FieldValidation.Issue("/lifecycle", required, "已有生命周期说明，请明确携带lifecycle后再保存"));
        if (body.operationKind() == null && existing.operationKind() != ApiOperationKind.MUTATION)
            checks.add(new FieldValidation.Issue("/operationKind", required, "已标注调用性质，请明确携带operationKind后再保存"));
        if (body.idempotencyField() == null && existing.idempotencyField() != null)
            checks.add(new FieldValidation.Issue("/idempotencyField", required, "已配置幂等字段，请明确携带idempotencyField后再保存；清除请传空字符串"));
        if (body.mcpTool() == null && !existing.mcpTool().equals(McpToolConfig.DISABLED))
            checks.add(new FieldValidation.Issue("/mcpTool", required, "已有MCP工具配置，请明确携带mcpTool后再保存"));
        checks.requireValid();
    }

    @GetMapping
    public ApiResponse<PageResult<ApiSummary>> page(@RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int pageSize, @RequestParam(required = false) String query,
            @RequestParam(required = false) Set<ApiProtocol> protocol,
            @RequestParam(required = false) String category,
            @RequestParam(required = false) Set<ApiCatalogFilter.Publication> publication,
            @RequestParam(required = false) Set<ApiCatalogFilter.Review> review,
            @RequestParam(required = false) Set<ApiCatalogFilter.Access> access,
            @RequestParam(required = false) String internalClass,
            @RequestParam(defaultValue = "CONTAINS") ApiCatalogFilter.MatchMode internalMatch,
            @RequestParam(required = false) String internalMethod,
            @RequestParam(required = false) String ownerId,
            @RequestParam(required = false) Set<ApiCatalogFilter.McpTool> mcpTool,
            @RequestParam(defaultValue = "IDENTITY") ApiCatalogFilter.Sort sort, HttpServletRequest request) {
        CatalogPageQuery pagination = new CatalogPageQuery(page, pageSize, query);
        ApiCatalogFilter filter = new ApiCatalogFilter(protocol, category, publication, review, access, internalClass, internalMatch, internalMethod, ownerId, sort, mcpTool);
        return ApiResponse.success(catalog.page(pagination, filter));
    }

    @GetMapping("/categories")
    public ApiResponse<PageResult<String>> categories(@RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int pageSize, @RequestParam(required = false) String query,
            HttpServletRequest request) {
        return ApiResponse.success(catalog.categories(new CatalogPageQuery(page, pageSize, query)));
    }

    /** 高级编辑器只读校验：原始JSON直接解析，成功后才允许前端替换结构化模型。 */
    @PostMapping(value = "/validate-json", consumes = "application/json")
    public ApiResponse<Object> validateJson(@RequestParam(defaultValue = "value") String kind,
            @RequestParam(name = "request", defaultValue = "false") boolean requestSchema,
            HttpServletRequest request) throws IOException {
        if (!kind.equals("value") && !kind.equals("schema")) {
            throw new PlatformException(ErrorCode.INVALID_REQUEST, "校验类型只支持value或schema");
        }
        byte[] bytes = bodies.readBytes(request, 262_144);
        Object value;
        try {
            value = (kind.equals("schema") ? schemaReader : valueReader).readValue(bytes);
        } catch (RuntimeException invalid) {
            throw new PlatformException(ErrorCode.INVALID_REQUEST, "JSON格式、重复字段、尾随内容或结构规模不合法，请保留原文并修正");
        }
        if (kind.equals("schema")) {
            if (!(value instanceof SchemaNode schema) || requestSchema && schema.type() != SchemaType.OBJECT) {
                throw new PlatformException(ErrorCode.INVALID_REQUEST, "Schema不能为空，且请求根节点必须为OBJECT");
            }
            schema.validate(requestSchema);
        }
        return ApiResponse.success(value);
    }

    @GetMapping("/{id}")
    public ApiResponse<ApiDefinition> find(@PathVariable @Size(max = 36) String id, HttpServletRequest request) {
        return ApiResponse.success(catalog.find(id));
    }

    /** 草稿、启停、生效与待审修订的同一数据库快照，不含远程诊断或全部历史。 */
    @GetMapping("/{id}/workspace")
    public ApiResponse<io.github.chenyilei2016.openplatform.application.catalog.ApiWorkspaceService.Workspace> workspace(
            @PathVariable @Size(max = 36) String id) {
        return ApiResponse.success(workspaces.find(id));
    }

    @GetMapping("/{id}/preview")
    public ApiResponse<ApiDocument> preview(@PathVariable @Size(max = 36) String id, HttpServletRequest request) {
        return ApiResponse.success(catalog.preview(id));
    }

    @GetMapping("/scopes")
    public ApiResponse<PageResult<Scope>> scopes(@RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int pageSize, @RequestParam(required = false) String query, HttpServletRequest request) {
        return ApiResponse.success(catalog.scopes(new CatalogPageQuery(page, pageSize, query)));
    }

    /** 保存与高级编辑使用同一严格类型规则，避免直接保存绕过转换校验。 */
    private SaveApiRequest readSave(HttpServletRequest request) throws IOException {
        return draftBodies.read(request, SaveApiRequest.class);
    }
}
