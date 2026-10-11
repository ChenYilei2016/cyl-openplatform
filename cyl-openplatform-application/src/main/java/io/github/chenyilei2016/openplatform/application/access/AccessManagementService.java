package io.github.chenyilei2016.openplatform.application.access;

import io.github.chenyilei2016.openplatform.domain.access.EmployeeProfileRepository;
import io.github.chenyilei2016.openplatform.domain.observability.CallRecordRepository;
import java.time.Instant;
import java.util.Map;
import java.util.Set;
import java.util.HashMap;
import java.util.HashSet;
import java.util.stream.Collectors;

import io.github.chenyilei2016.openplatform.domain.common.ObjectIdType;
import io.github.chenyilei2016.openplatform.domain.access.AccessAuditRepository;
import io.github.chenyilei2016.openplatform.domain.access.AccessAudit;
import io.github.chenyilei2016.openplatform.domain.access.AccessOperator;
import io.github.chenyilei2016.openplatform.domain.access.AccessPageQuery;
import io.github.chenyilei2016.openplatform.domain.access.ApplicationRepository;
import io.github.chenyilei2016.openplatform.domain.access.ApplicationFilter;
import io.github.chenyilei2016.openplatform.domain.access.ApplicationListing;
import io.github.chenyilei2016.openplatform.domain.access.ScopeFilter;
import io.github.chenyilei2016.openplatform.domain.access.ApplicationKind;
import io.github.chenyilei2016.openplatform.domain.access.ApplicationStatus;
import io.github.chenyilei2016.openplatform.domain.access.ClientApplication;
import io.github.chenyilei2016.openplatform.domain.access.Scope;
import io.github.chenyilei2016.openplatform.domain.access.ScopeApi;
import io.github.chenyilei2016.openplatform.domain.access.ScopeUsage;
import io.github.chenyilei2016.openplatform.domain.access.ScopeRepository;
import io.github.chenyilei2016.openplatform.domain.access.GrantStatus;
import io.github.chenyilei2016.openplatform.domain.access.TenantGrant;
import io.github.chenyilei2016.openplatform.domain.access.TenantGrantRepository;
import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.CredentialSecrets;
import io.github.chenyilei2016.openplatform.domain.common.PageResult;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import org.springframework.stereotype.Service;
import lombok.RequiredArgsConstructor;
import java.util.List;
import java.util.UUID;

/** 应用和scope用例编排；凭据摘要与SQL留在各自边界。 */
@Service
@RequiredArgsConstructor
public class AccessManagementService {
    private final ScopeRepository scopes;
    private final ApplicationRepository applications;
    private final AccessAuditRepository audits;
    private final TenantGrantRepository tenants;
    private final AccessAuditService audit;
    private final EmployeeProfileRepository profiles;
    private final CallRecordRepository callRecords;

    public ScopeView createScope(String code, String name, boolean enabled, boolean defaultForNewApplication,
                                 boolean publicAccess, AccessOperator operator) {
        String id = ObjectIdType.SCOPE.nextId();
        return audit.change("CREATE_SCOPE", null, null, id, operator, () -> {
            Scope scope = new Scope(id, code, name, enabled, defaultForNewApplication, publicAccess);
            scopes.create(scope);
            return ScopeView.from(scope, ScopeUsage.NONE);
        });
    }

    /**
     * publicAccess 为 null 时保留原值（兼容只提交旧字段的调用方）。公共通用只影响租户可用权限组（MCP 与门户展示），
     * 不改变凭据授权版本；只有启停才使持有该组的凭据旧 Token 失效。
     */
    public ScopeView updateScope(String id, String name, boolean enabled, boolean defaults, Boolean publicAccess, AccessOperator operator) {
        return audit.change("UPDATE_SCOPE", null, null, id, operator, () -> {
            Scope existing = scopes.lock(id);
            Scope scope = new Scope(id, existing.code(), name, enabled, defaults,
                    publicAccess == null ? existing.publicAccess() : publicAccess);
            scopes.update(scope);
            if (existing.enabled() != enabled) applications.incrementScopeVersion(scope.code());
            return withUsage(scope);
        });
    }

    /** 列表按当前页批量补充 API 数与凭据数（固定两次聚合查询），不逐行统计。 */
    public PageResult<ScopeView> scopes(AccessPageQuery query, ScopeFilter filter) {
        PageResult<Scope> page = scopes.page(query, filter);
        Map<String, ScopeUsage> usage = scopes.usage(page.items().stream().map(Scope::code).toList());
        return new PageResult<>(page.items().stream()
                .map(scope -> ScopeView.from(scope, usage.getOrDefault(scope.code(), ScopeUsage.NONE))).toList(),
                page.total(), page.page(), page.pageSize());
    }

    public ScopeView scope(String id) {
        return withUsage(scopes.find(id));
    }

    /** 权限组抽屉的 API 页：草稿或已发布版本携带该组的 API，增删通过 API 草稿保存完成，发布后生效。 */
    public PageResult<ScopeApi> scopeApis(String id, AccessPageQuery query) {
        return scopes.apis(scopes.find(id).code(), query);
    }

    private ScopeView withUsage(Scope scope) {
        return ScopeView.from(scope, scopes.usage(List.of(scope.code())).getOrDefault(scope.code(), ScopeUsage.NONE));
    }

    /** initialScopeCodes 为空时沿用“新凭据默认授予”的权限组；显式传入时只接受已启用权限组。 */
    public ApplicationCredentials createApplication(String name, String ownerTenantId, List<String> initialScopeCodes, AccessOperator operator) {
        String id = ObjectIdType.APPLICATION.nextId();
        return audit.change("CREATE_APPLICATION", id, ownerTenantId, id, operator, () -> {
            if (initialScopeCodes == null) return registerApplication(id, name, ownerTenantId, scopes.defaultCodes());
            List<String> codes = initialScopeCodes.stream().distinct().sorted().toList();
            if (!scopes.allEnabled(codes)) throw new PlatformException(ErrorCode.INVALID_REQUEST, "权限组不存在或已停用");
            return registerApplication(id, name, ownerTenantId, codes);
        });
    }

    /** 自助生成是一次完整变更：失败先释放业务事务连接，再记录失败审计。 */
    public ApplicationCredentials createBoundApplication(String note, AccessOperator operator) {
        String id = ObjectIdType.APPLICATION.nextId();
        return audit.change("CREATE_BOUND_APPLICATION", id, operator.tenantId(), id, operator, () -> {
            List<String> defaults = scopes.defaultCodes();
            if (defaults.isEmpty()) {
                throw new PlatformException(ErrorCode.DEPENDENCY_UNAVAILABLE, "默认权限范围尚未配置，请联系平台维护者");
            }
            ApplicationCredentials credentials = registerApplication(id, null, operator.tenantId(), defaults);
            tenants.create(new TenantGrant(ObjectIdType.TENANT_GRANT.nextId(), id, operator.tenantId(), GrantStatus.ACTIVE, 0, note == null ? "" : note.strip(), 0));
            return credentials;
        });
    }

    private ApplicationCredentials registerApplication(String id, String name, String ownerTenantId, List<String> defaults) {
        if (defaults.size() > 100) throw new PlatformException(ErrorCode.CONFLICT, "默认权限组不能超过100个");
        String secret = CredentialSecrets.generate();
        String displayName = name == null || name.isBlank() ? "接入凭据-" + id.substring(id.length() - 8) : name;
        ClientApplication app = new ClientApplication(id, UUID.randomUUID().toString().replace("-", ""), displayName,
                ownerTenantId, ApplicationStatus.ENABLED, 0, defaults, ApplicationKind.STANDARD);
        applications.create(app, CredentialSecrets.digest(secret));
        return new ApplicationCredentials(ApplicationView.from(app), secret);
    }

    public ApplicationView renameApplication(String id, String name, String expectedName, AccessOperator operator) {
        return audit.change("RENAME_APPLICATION", id, null, id, operator, () -> {
            ClientApplication current = applications.lock(id).requireKind(ApplicationKind.STANDARD);
            if (!current.name().equals(expectedName))
                throw new PlatformException(ErrorCode.CONFLICT, "凭据名称已被修改，请核对最新名称后重新保存");
            applications.rename(id, name);
            return application(id);
        });
    }

    public ApplicationView setScopes(String id, List<String> codes, AccessOperator operator) {
        return audit.change("SET_APPLICATION_SCOPES", id, null, id, operator, () -> {
            List<String> distinctCodes = codes.stream().distinct().sorted().toList();
            if (!scopes.allEnabled(distinctCodes)) throw new PlatformException(ErrorCode.INVALID_REQUEST, "权限组不存在或已停用");
            ClientApplication app = applications.lock(id).requireKind(ApplicationKind.STANDARD);
            if (!app.scopeCodes().equals(distinctCodes)) applications.replaceScopes(id, distinctCodes);
            return application(id);
        });
    }

    public ApplicationView setStatus(String id, boolean enabled, AccessOperator operator) {
        return audit.change("SET_APPLICATION_STATUS", id, null, id, operator, () -> {
            applications.lock(id).requireKind(ApplicationKind.STANDARD);
            applications.changeStatus(id, enabled ? ApplicationStatus.ENABLED : ApplicationStatus.DISABLED);
            return application(id);
        });
    }

    public RotatedSecret rotateSecret(String id, AccessOperator operator) {
        return audit.change("ROTATE_APPLICATION_SECRET", id, null, id, operator, () -> {
            ClientApplication app = applications.lock(id).requireKind(ApplicationKind.STANDARD);
            String secret = CredentialSecrets.generate();
            applications.rotateSecret(id, CredentialSecrets.digest(secret));
            return new RotatedSecret(app.appKey(), secret);
        });
    }

    public ApplicationView application(String id) {
        ClientApplication app = applications.find(id).orElseThrow(() -> new PlatformException(ErrorCode.NOT_FOUND, "应用不存在"))
                .requireKind(ApplicationKind.STANDARD);
        ApplicationView view = ApplicationView.from(app).withDetails(profiles.tenantNames(List.of(app.ownerTenantId())),
                scopes.findByCodes(app.scopeCodes()).stream().collect(Collectors.toMap(Scope::code, Scope::name)),
                tenants.activeCount(id));
        return withLastCall(view, callRecords.latestProductionCalls(List.of(id)).get(id));
    }

    private static ApplicationView withLastCall(ApplicationView view, Instant lastCalledAt) {
        return new ApplicationView(view.id(), view.appKey(), view.name(), view.ownerTenantId(), view.status(),
                view.authorizationVersion(), view.scopeCodes(), view.selectedTenantGrantStatus(), view.tenantGrantCount(),
                view.matchedTenantGrantCount(), view.matchedTenantGrants(), view.tenantNames(), view.scopeNames(),
                view.activeTenantGrantCount(), lastCalledAt, view.matchedTokenId());
    }

    public PageResult<ApplicationView> applications(AccessPageQuery query, ApplicationFilter filter) {
        PageResult<ApplicationListing> page = applications.page(query, filter);
        Set<String> tenantIds = new HashSet<>();
        page.items().forEach(item -> {
            tenantIds.add(item.application().ownerTenantId());
            item.matchedTenantGrants().forEach(grant -> tenantIds.add(grant.tenantId()));
        });
        // 补充字段按页批量聚合：租户名称、最近正式调用各一次查询，不随行数增加。
        Map<String, String> names = profiles.tenantNames(tenantIds);
        Map<String, Instant> lastCalls = callRecords.latestProductionCalls(
                page.items().stream().map(item -> item.application().id()).toList());
        return new PageResult<>(page.items().stream().map(item -> {
            ClientApplication app = item.application();
            Map<String, String> visibleNames = new HashMap<>();
            if (names.containsKey(app.ownerTenantId())) visibleNames.put(app.ownerTenantId(), names.get(app.ownerTenantId()));
            item.matchedTenantGrants().forEach(grant -> {
                if (names.containsKey(grant.tenantId())) visibleNames.put(grant.tenantId(), names.get(grant.tenantId()));
            });
            return new ApplicationView(app.id(), app.appKey(), app.name(), app.ownerTenantId(), app.status().name(),
                    app.authorizationVersion(), app.scopeCodes(),
                    item.selectedTenantGrantStatus() == null ? null : item.selectedTenantGrantStatus().name(),
                    item.tenantGrantCount(), item.matchedTenantGrantCount(), item.matchedTenantGrants(), visibleNames, Map.of(), null,
                    lastCalls.get(app.id()), filter.tokenId());
        }).toList(), page.total(), page.page(), page.pageSize());
    }

    public PageResult<AuditView> audit(String id, AccessPageQuery query) {
        applications.find(id).orElseThrow(() -> new PlatformException(ErrorCode.NOT_FOUND, "应用不存在"));
        PageResult<AccessAudit> page = audits.page(id, query);
        return new PageResult<>(page.items().stream().map(AuditView::from).toList(), page.total(), page.page(), page.pageSize());
    }
}
