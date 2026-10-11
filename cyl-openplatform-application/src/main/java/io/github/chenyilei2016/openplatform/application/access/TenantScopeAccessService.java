package io.github.chenyilei2016.openplatform.application.access;

import io.github.chenyilei2016.openplatform.domain.access.AccessOperator;
import io.github.chenyilei2016.openplatform.domain.access.AccessPageQuery;
import io.github.chenyilei2016.openplatform.domain.access.EmployeeNumberRef;
import io.github.chenyilei2016.openplatform.domain.access.EmployeeProfileRepository;
import io.github.chenyilei2016.openplatform.domain.access.GrantStatus;
import io.github.chenyilei2016.openplatform.domain.access.Scope;
import io.github.chenyilei2016.openplatform.domain.access.ScopeRepository;
import io.github.chenyilei2016.openplatform.domain.access.TenantScopeGrant;
import io.github.chenyilei2016.openplatform.domain.access.TenantPermissionSummary;
import io.github.chenyilei2016.openplatform.domain.access.TenantScopePermission;
import io.github.chenyilei2016.openplatform.domain.access.TenantScopeGrantRepository;
import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.ObjectIdType;
import io.github.chenyilei2016.openplatform.domain.common.PageResult;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

/**
 * 租户权限（公共通用权限组 + 开通给指定租户的权限组）：管理端维护租户授予，并提供租户可用权限组查询。
 * 只用于 MCP 工具可用性与门户展示；普通凭据调用仍按凭据自己的权限组判断，本服务不改变任何凭据授权版本或 Token。
 */
@Service
@RequiredArgsConstructor
public class TenantScopeAccessService {
    private final ScopeRepository scopes;
    private final TenantScopeGrantRepository grants;
    private final AccessAuditService audit;
    private final EmployeeProfileRepository profiles;

    /**
     * 租户当前可用的权限组代码 = 启用的公共通用权限组 ∪ 该租户 ACTIVE 授予且权限组启用的权限组。
     * <p>每次调用单次查询数据库、不缓存：公共通用开关、权限组启停与租户授予撤销立即生效。
     * tenantId 为 null 或空白时只返回启用的公共通用权限组（如门户未登录访问）。
     * <p>使用方：MCP 工具可用性（API 的权限组与此集合有交集才可用；没有任何权限组的 API 不可用）、门户按租户展示专属 API。
     * 普通凭据调用不得使用此结果代替凭据自身的权限组。
     *
     * @return 不可变集合，按权限组代码升序迭代
     */
    public Set<String> availableScopeCodes(String tenantId, List<String> candidates) {
        if (candidates.isEmpty()) return Set.of();
        if (candidates.size() > 100) throw new IllegalArgumentException("单次只核对一个API的权限组，最多100项");
        return grants.availableScopeCodes(tenantId == null || tenantId.isBlank() ? null : tenantId.strip(), candidates);
    }

    public PageResult<TenantPermissionView> tenants(AccessPageQuery query) {
        PageResult<TenantPermissionSummary> page = grants.tenants(query);
        Map<String, String> names = profiles.tenantNames(page.items().stream().map(TenantPermissionSummary::tenantId).toList());
        return page.map(item -> new TenantPermissionView(item.tenantId(), names.get(item.tenantId()), item.grantedScopeCount(), item.updatedAt()));
    }

    public PageResult<TenantScopePermissionView> permissions(String tenantId, AccessPageQuery query, TenantScopePermission.Filter filter) {
        return grants.permissions(tenantId.strip(), query, filter).map(TenantScopePermissionView::from);
    }

    /** 权限组抽屉“已开通租户”：含已撤销记录，当前页批量补充租户名称与开通人姓名。 */
    public PageResult<TenantScopeGrantView> grants(String scopeId, AccessPageQuery query) {
        PageResult<TenantScopeGrant> page = grants.page(scopes.find(scopeId).code(), query);
        Map<String, String> tenantNames = profiles.tenantNames(page.items().stream().map(TenantScopeGrant::tenantId).distinct().toList());
        Map<EmployeeNumberRef, String> operatorNames = profiles.displayNames(page.items().stream().map(TenantScopeGrant::grantedBy).distinct().toList());
        return page.map(grant -> TenantScopeGrantView.from(grant, tenantNames.get(grant.tenantId()),
                operatorNames.get(grant.grantedBy())));
    }

    /** 开通：已有有效授予报冲突；曾撤销的记录重新开通并更新开通人。锁定权限组行，与权限组设置变更串行。 */
    public TenantScopeGrantView grant(String scopeId, String tenantId, AccessOperator operator) {
        String normalized = tenantId.strip();
        return audit.change("GRANT_TENANT_SCOPE", null, normalized, scopeId, operator, () -> {
            Scope scope = scopes.lock(scopeId);
            Instant now = Instant.now();
            var existing = grants.findByTenant(scope.code(), normalized);
            if (existing.isEmpty()) {
                TenantScopeGrant created = TenantScopeGrant.open(ObjectIdType.TENANT_SCOPE_GRANT.nextId(), normalized, scope.code(), operator, now);
                grants.create(created);
                return view(created);
            }
            TenantScopeGrant current = existing.get();
            if (current.status() == GrantStatus.ACTIVE) throw new PlatformException(ErrorCode.CONFLICT, "该租户已开通此权限组");
            TenantScopeGrant reopened = current.reopen(operator, now);
            if (!grants.changeStatus(reopened, current.revision()))
                throw new PlatformException(ErrorCode.CONFLICT, "租户权限已变化，请刷新后重试");
            return view(reopened);
        });
    }

    /** 撤销保留记录；已撤销时直接返回当前记录（重复提交不报错）。核对授予属于该权限组。 */
    public TenantScopeGrantView revoke(String scopeId, String grantId, AccessOperator operator) {
        var found = grants.find(grantId);
        return audit.change("REVOKE_TENANT_SCOPE", null, found.map(TenantScopeGrant::tenantId).orElse(null), scopeId, operator, () -> {
            Scope scope = scopes.find(scopeId);
            TenantScopeGrant current = found.filter(grant -> grant.scopeCode().equals(scope.code()))
                    .orElseThrow(() -> new PlatformException(ErrorCode.NOT_FOUND, "该权限组下的租户权限不存在"));
            if (current.status() == GrantStatus.REVOKED) return view(current);
            TenantScopeGrant revoked = current.revoke(Instant.now());
            if (!grants.changeStatus(revoked, current.revision()))
                throw new PlatformException(ErrorCode.CONFLICT, "租户权限已变化，请刷新后重试");
            return view(revoked);
        });
    }

    private TenantScopeGrantView view(TenantScopeGrant grant) {
        EmployeeNumberRef operator = grant.grantedBy();
        return TenantScopeGrantView.from(grant, profiles.tenantName(grant.tenantId()), profiles.displayNames(List.of(operator)).get(operator));
    }
}
