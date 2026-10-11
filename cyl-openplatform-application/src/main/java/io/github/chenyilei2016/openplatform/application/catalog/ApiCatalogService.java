package io.github.chenyilei2016.openplatform.application.catalog;

import io.github.chenyilei2016.openplatform.application.connection.DubboBindingPolicy;
import io.github.chenyilei2016.openplatform.domain.access.AccessPageQuery;
import io.github.chenyilei2016.openplatform.domain.access.ScopeFilter;
import io.github.chenyilei2016.openplatform.domain.access.Scope;
import io.github.chenyilei2016.openplatform.domain.access.ScopeRepository;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiCatalogRepository;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiDefinition;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiRevisionSource;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiRevision;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiRevisionRepository;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiDocument;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiSummary;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiCatalogFilter;
import io.github.chenyilei2016.openplatform.domain.catalog.CatalogPageQuery;
import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.FieldValidation;
import io.github.chenyilei2016.openplatform.domain.common.PageResult;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import lombok.RequiredArgsConstructor;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class ApiCatalogService {
    private final ApiCatalogRepository catalog;
    private final CatalogReferencePolicy references;
    private final McpToolNamePolicy toolNames;
    private final ScopeRepository scopes;
    private final DubboBindingPolicy bindings;
    private final ApiRevisionRepository revisions;
    private final io.github.chenyilei2016.openplatform.application.platform.PlatformSettings platform;

    public boolean portalVisible(String id) {
        find(id);
        return catalog.portalVisible(id);
    }

    /** 门户展示独立于草稿/发布，持有同一API锁，不新增修订或审核。 */
    @Transactional
    public boolean setPortalVisible(String id, boolean visible, io.github.chenyilei2016.openplatform.domain.access.AccessOperator operator) {
        catalog.lock(id).orElseThrow(() -> new PlatformException(ErrorCode.NOT_FOUND, "API草稿不存在"));
        if (catalog.portalVisible(id) != visible) catalog.setPortalVisible(id, visible, operator);
        return visible;
    }

    @Transactional
    public ApiDefinition create(ApiDefinition definition, ApiRevisionSource source, String operatorTenantId, String operatorEmployeeNo, String requestId) {
        definition.validate();
        toolNames.require(definition);
        bindings.validate(definition, null);
        if (!scopes.allEnabled(definition.scopeCodes())) throw FieldValidation.invalid("/scopeCodes", FieldValidation.Reason.REFERENCE_UNAVAILABLE, "权限组不存在或已停用");
        references.check(java.util.List.of(definition),true).require(definition);
        try {
            catalog.create(definition);
        } catch (DataIntegrityViolationException exception) {
            throw new PlatformException(ErrorCode.CONFLICT, "操作标识已存在");
        }
        catalog.appendAudit(definition.id(), definition.draftRevision(), source.name(), operatorTenantId, operatorEmployeeNo, requestId, null);
        return definition;
    }

    @Transactional
    public ApiDraftSaveResult update(ApiDefinition definition, long expectedRevision, String operatorTenantId, String operatorEmployeeNo, String requestId) {
        return save(definition, expectedRevision, null, operatorTenantId, operatorEmployeeNo, requestId);
    }

    /**
     * 权限组侧增删 API：API 与权限组的关联保存在草稿 scopeCodes 中，这里只改该字段，其余内容原样保留，
     * 沿用草稿保存的修订并发校验、校验规则与审计；改的是草稿，发布后才影响调用。
     */
    @Transactional
    public ApiDraftSaveResult changeScope(String apiId, long expectedRevision, String scopeCode, boolean included,
                                          String operatorTenantId, String operatorEmployeeNo, String requestId) {
        if (expectedRevision < 1 || expectedRevision == Long.MAX_VALUE)
            throw new PlatformException(ErrorCode.INVALID_REQUEST, "expectedRevision必须为有效草稿修订号");
        ApiDefinition current = find(apiId);
        if (current.draftRevision() != expectedRevision) throw new PlatformException(ErrorCode.CONFLICT, "草稿已被修改，请重新加载后保存");
        java.util.List<String> codes = new java.util.ArrayList<>(current.scopeCodes().stream().filter(code -> !code.equals(scopeCode)).toList());
        if (included) codes.add(scopeCode);
        ApiDefinition changed = new ApiDefinition(apiId, current.service(), current.version(), current.method(),
                current.name(), current.category(), current.owner(), current.protocol(), expectedRevision + 1,
                codes, current.requestSchema(), current.responseSchema(), current.errorDefinitions(),
                current.binding(), current.mappings(), current.lifecycle(), current.description(), current.employeeRequired(), current.responseAdapter(),
                current.operationKind(), current.idempotencyField(), current.mcpTool());
        return save(changed, expectedRevision, null, operatorTenantId, operatorEmployeeNo, requestId);
    }

    /** 恢复完整历史契约为新的草稿头，不触及发布状态或访问开关。 */
    @Transactional
    public ApiDraftSaveResult restore(String apiId, long sourceRevision, long expectedRevision,
                                      String operatorTenantId, String operatorEmployeeNo, String requestId) {
        if (expectedRevision < 1 || expectedRevision == Long.MAX_VALUE)
            throw new PlatformException(ErrorCode.INVALID_REQUEST, "expectedRevision必须为有效草稿修订号");
        ApiRevision history = revisions.find(apiId, sourceRevision)
                .orElseThrow(() -> new PlatformException(ErrorCode.NOT_FOUND, "该API草稿历史不存在"));
        ApiDefinition source = history.snapshot();
        ApiDefinition restored = new ApiDefinition(apiId, source.service(), source.version(), source.method(),
                source.name(), source.category(), source.owner(), source.protocol(), expectedRevision + 1,
                source.scopeCodes(), source.requestSchema(), source.responseSchema(), source.errorDefinitions(),
                source.binding(), source.mappings(), source.lifecycle(), source.description(), source.employeeRequired(), source.responseAdapter(),
                source.operationKind(), source.idempotencyField(), source.mcpTool());
        return save(restored, expectedRevision, history, operatorTenantId, operatorEmployeeNo, requestId);
    }

    private ApiDraftSaveResult save(ApiDefinition definition, long expectedRevision, ApiRevision restoration,
                                    String operatorTenantId, String operatorEmployeeNo, String requestId) {
        definition.validate();
        toolNames.require(definition);
        // 与发布和导入保持scope → 草稿父行锁顺序；无变化保存也必须串行检查修订。
        if (!scopes.allEnabled(definition.scopeCodes().stream().sorted().toList())) throw FieldValidation.invalid("/scopeCodes", FieldValidation.Reason.REFERENCE_UNAVAILABLE, "权限组不存在或已停用");
        references.check(java.util.List.of(definition),true).require(definition);
        ApiDefinition existing = catalog.lock(definition.id())
                .orElseThrow(() -> new PlatformException(ErrorCode.NOT_FOUND, "API草稿不存在"));
        if (existing.draftRevision() != expectedRevision) throw new PlatformException(ErrorCode.CONFLICT, "草稿已被修改，请重新加载后保存");
        if (restoration == null) validateExisting(definition, existing);
        // 历史中固定的旧连接修订仍须存在且启用，不改为最新修订。
        bindings.validate(definition, restoration == null ? existing : restoration.snapshot());
        ApiDraftSaveResult result = ApiDraftSaveResult.prepare(existing, definition, expectedRevision);
        if (!result.changed()) return result;
        if (!catalog.update(definition, expectedRevision)) throw new PlatformException(ErrorCode.CONFLICT, "草稿已被修改，请重新加载后保存");
        catalog.appendAudit(definition.id(), definition.draftRevision(),
                (restoration == null ? ApiRevisionSource.UPDATE_API_DRAFT : ApiRevisionSource.RESTORE_API_DRAFT).name(),
                operatorTenantId, operatorEmployeeNo, requestId,
                restoration == null ? null : restoration.metadata().revision());
        return result;
    }

    public record ValidationResult(boolean valid, java.util.List<FieldValidation.Issue> fieldIssues,
                                   boolean truncated, Long checkedDraftRevision) {}

    /** 候选校验只读取引用，不持有写锁，也不访问注册中心或业务提供方。 */
    @Transactional(readOnly = true, isolation = org.springframework.transaction.annotation.Isolation.REPEATABLE_READ)
    public ValidationResult validateCandidate(ApiDefinition definition, Long expectedRevision) {
        return validateCandidate(definition, expectedRevision, false);
    }

    /** newOperation：候选将作为新 API 创建，额外预检对外标识是否已被占用（导入更新已有 API 时不检查）。 */
    @Transactional(readOnly = true, isolation = org.springframework.transaction.annotation.Isolation.REPEATABLE_READ)
    public ValidationResult validateCandidate(ApiDefinition definition, Long expectedRevision, boolean newOperation) {
        ApiDefinition existing = expectedRevision == null ? null : find(definition.id());
        if (existing != null && existing.draftRevision() != expectedRevision)
            throw new PlatformException(ErrorCode.CONFLICT, "草稿已被修改，请重新加载后校验");
        FieldValidation checks = new FieldValidation();
        checks.inspect("", definition::validate);
        if (checks.valid()) {
            references.check(java.util.List.of(definition),false).issues(definition).forEach(checks::add);
            checks.inspect("", () -> toolNames.require(definition));
            if (existing != null) checks.inspect("", () -> validateExisting(definition, existing));
            checks.inspect("", () -> bindings.validate(definition, existing));
            if (scopes.enabledCodes(definition.scopeCodes()).size() != definition.scopeCodes().size())
                checks.add(new FieldValidation.Issue("/scopeCodes", FieldValidation.Reason.REFERENCE_UNAVAILABLE, "权限组不存在或已停用"));
        }
        // 新建前预检对外标识占用：只依赖标识本身，其他字段未填完时也能提前提示（110）。
        if (newOperation && existing == null && validOperation(definition))
            catalog.findOperations(java.util.List.of(io.github.chenyilei2016.openplatform.domain.catalog.ApiOperation.of(definition))).stream()
                    .findFirst().ifPresent(taken -> checks.add(new FieldValidation.Issue("/method", FieldValidation.Reason.INVALID_VALUE,
                            "service、外部版本与 method 的组合已被 API「" + taken.name() + "」使用，请更换")));
        FieldValidation.Problems problems = checks.problems();
        return new ValidationResult(checks.valid(), problems.fieldIssues(), problems.truncated(),
                existing == null ? null : existing.draftRevision());
    }

    private static boolean validOperation(ApiDefinition definition) {
        return definition.service() != null && definition.service().matches("[a-z][a-z0-9_]{0,63}")
                && definition.method() != null && definition.method().matches("[a-z][a-z0-9_]{0,63}")
                && definition.version() != null && definition.version().matches("[a-zA-Z0-9][a-zA-Z0-9._-]{0,31}");
    }

    private void validateExisting(ApiDefinition definition, ApiDefinition existing) {
        FieldValidation checks = new FieldValidation();
        checks.check(!(definition.description() == null && existing.description() != null && !existing.description().isEmpty()),
                "/description", "已有接口说明，请携带description后保存；清空请明确传空字符串");
        if (!existing.service().equals(definition.service()))
            checks.add(new FieldValidation.Issue("/service", FieldValidation.Reason.IMMUTABLE, "服务标识创建后不可修改"));
        if (!existing.version().equals(definition.version()))
            checks.add(new FieldValidation.Issue("/version", FieldValidation.Reason.IMMUTABLE, "外部版本创建后不可修改"));
        if (!existing.method().equals(definition.method()))
            checks.add(new FieldValidation.Issue("/method", FieldValidation.Reason.IMMUTABLE, "操作标识创建后不可修改"));
        checks.requireValid();
    }

    /** 导出固定草稿配置，复用复制的实际脱敏，不携带历史/身份或服务端元数据。 */
    public ApiDefinition exportConfiguration(String apiId, long revision) {
        ApiDefinition source = find(apiId);
        if (source.draftRevision() != revision)
            throw new PlatformException(ErrorCode.CONFLICT, "草稿已变化，请刷新后导出");
        return new ApiDefinitionSanitizer().snapshot(source, source.owner(), source.lifecycle());
    }

    public ApiDefinition find(String id) {
        return catalog.find(id).orElseThrow(() -> new PlatformException(ErrorCode.NOT_FOUND, "API草稿不存在"));
    }

    public PageResult<ApiSummary> page(CatalogPageQuery query, ApiCatalogFilter filter) { return catalog.page(query, filter); }
    public PageResult<String> categories(CatalogPageQuery query) { return catalog.categories(query); }
    public ApiDocument preview(String id) {
        ApiDefinition api = find(id);
        return ApiDocument.from(api, "草稿预览 · " + api.name()).withBaseUrl(platform.getGatewayBaseUrl());
    }
    public PageResult<Scope> scopes(CatalogPageQuery query) {
        return scopes.page(new AccessPageQuery(query.page(), query.pageSize(), query.query()), new ScopeFilter(null, null, null, null));
    }
}
