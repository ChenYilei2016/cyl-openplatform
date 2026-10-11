package io.github.chenyilei2016.openplatform.application.portal;

import io.github.chenyilei2016.openplatform.application.access.AccessAuditService;
import io.github.chenyilei2016.openplatform.application.access.AccessManagementService;
import io.github.chenyilei2016.openplatform.application.access.ApplicationCredentials;
import io.github.chenyilei2016.openplatform.application.access.GrantManagementService;
import io.github.chenyilei2016.openplatform.application.access.TenantGrantView;
import io.github.chenyilei2016.openplatform.domain.access.AccessOperator;
import io.github.chenyilei2016.openplatform.domain.access.AccessPageQuery;
import io.github.chenyilei2016.openplatform.domain.access.ScopeFilter;
import java.util.Set;
import io.github.chenyilei2016.openplatform.domain.access.UserGrantRepository;
import io.github.chenyilei2016.openplatform.domain.access.EmployeeIdentity;
import io.github.chenyilei2016.openplatform.application.access.UserGrantView;
import io.github.chenyilei2016.openplatform.domain.access.TenantGrantRepository;
import io.github.chenyilei2016.openplatform.domain.access.TenantGrant;
import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PageResult;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.github.chenyilei2016.openplatform.domain.portal.PortalApplication;
import io.github.chenyilei2016.openplatform.domain.portal.PortalApplicationQuery;
import io.github.chenyilei2016.openplatform.domain.portal.PortalApplicationRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 客户自助用例仅接受入口认证后的操作人，并始终以其租户限定关系。 */
@Service
@RequiredArgsConstructor
public class PortalAccessService {
    private final PortalApplicationRepository applications;
    private final AccessManagementService management;
    private final GrantManagementService grants;
    private final TenantGrantRepository tenants;
    private final AccessAuditService audit;
    private final UserGrantRepository users;

    @Transactional(readOnly = true)
    public PageResult<PortalApplication> applications(PortalApplicationQuery query, AccessOperator operator) {
        return applications.page(operator.tenantId(), query);
    }

    /** 前置可用性只给当前配置事实；创建时仍重新校验，不构成授权。 */
    public record CreationAvailability(boolean available, long defaultScopeCount, String reason) {}

    public CreationAvailability creationAvailability() {
        long count = management.scopes(new AccessPageQuery(1, 1, null),
                new ScopeFilter(null, null, Set.of(true), Set.of(true))).total();
        return new CreationAvailability(count > 0 && count <= 100, count,
                count == 0 ? "平台尚未配置有效默认权限，请联系维护者；已有AK仍可绑定。"
                        : count > 100 ? "默认权限组超过100个，请联系维护者调整。" : "");
    }

    public PortalApplication application(String id, AccessOperator operator) {
        return applications.find(operator.tenantId(), id)
                .orElseThrow(() -> new PlatformException(ErrorCode.NOT_FOUND, "本租户关联不存在"));
    }

    public ApplicationCredentials create(String note, AccessOperator operator) {
        return management.createBoundApplication(note, operator);
    }

    public TenantGrantView bind(String appKey, String secret, AccessOperator operator) {
        try {
            return grants.bindTenant(appKey, secret, operator.tenantId(), operator);
        } catch (PlatformException failure) {
            // 绑定用例的FORBIDDEN只表示凭据证明失败，门户不能将它解释为平台会话失效。
            if (failure.getErrorCode() == ErrorCode.FORBIDDEN) {
                throw new PlatformException(ErrorCode.INVALID_CREDENTIALS, "应用凭据无效");
            }
            throw failure;
        }
    }

    public TenantGrantView binding(String id, AccessOperator operator) {
        return TenantGrantView.from(tenants.find(id).filter(grant -> grant.tenantId().equals(operator.tenantId()))
                .orElseThrow(() -> new PlatformException(ErrorCode.NOT_FOUND, "本租户关联不存在")));
    }

    public TenantGrantView updateNote(String id, String note, long expectedRevision, AccessOperator operator) {
        // 先限定可信租户，拒绝请求不携带其他租户的凭据信息。
        TenantGrantView binding = binding(id, operator);
        return audit.change("UPDATE_TENANT_NOTE", binding.applicationId(), operator.tenantId(), id, operator, () -> {
            TenantGrant current = tenants.find(id).filter(grant -> grant.tenantId().equals(operator.tenantId()))
                    .orElseThrow(() -> new PlatformException(ErrorCode.NOT_FOUND, "本租户关联不存在"));
            TenantGrant updated = current.withNote(note, expectedRevision);
            if (!tenants.updateNote(updated, expectedRevision)) {
                throw new PlatformException(ErrorCode.CONFLICT, "备注或关联状态已变化，请核对后重新保存");
            }
            return TenantGrantView.from(updated);
        });
    }

    public PageResult<UserGrantView> users(String id, AccessPageQuery query, AccessOperator operator) {
        binding(id, operator);
        return grants.users(id, query);
    }

    public EmployeeIdentity lookupUser(String id, String employeeNo, AccessOperator operator) {
        binding(id, operator);
        try { return grants.lookupUser(id, employeeNo); }
        catch (PlatformException failure) { throw personnelFailure(failure); }
    }

    public UserGrantView grantUser(String id, String employeeNo, String expectedUserId,
                                  String expectedEmployeeId, AccessOperator operator) {
        requireOwnBinding(id, "GRANT_USER", operator);
        try { return grants.grantUser(id, employeeNo, expectedUserId, expectedEmployeeId, operator); }
        catch (PlatformException failure) { throw personnelFailure(failure); }
    }

    public void revokeUser(String id, String userGrantId, long expectedVersion, AccessOperator operator) {
        requireOwnBinding(id, "REVOKE_USER", operator);
        if (users.find(userGrantId).filter(user -> user.tenantGrantId().equals(id)
                && user.tenantId().equals(operator.tenantId())).isEmpty()) {
            PlatformException failure = new PlatformException(ErrorCode.NOT_FOUND, "本租户人员委托不存在");
            audit.rejected("REVOKE_USER", null, operator.tenantId(), userGrantId, operator, failure);
            throw failure;
        }
        grants.revokeUser(userGrantId, expectedVersion, operator);
    }

    /** 目标人员/应用不可用是操作条件失败，不能让门户误清除操作者的有效会话。 */
    private PlatformException personnelFailure(PlatformException failure) {
        return failure.getErrorCode() == ErrorCode.FORBIDDEN
                ? new PlatformException(ErrorCode.INVALID_REQUEST, failure.getMessage()) : failure;
    }

    private void requireOwnBinding(String id, String action, AccessOperator operator) {
        try { binding(id, operator); }
        catch (PlatformException failure) {
            audit.rejected(action, null, operator.tenantId(), id, operator, failure);
            throw failure;
        }
    }

    public void revoke(String id, AccessOperator operator) {
        // 关系的租户不可变；先核对本租户，不能将他租户应用信息写入当前客户的拒绝审计。
        if (tenants.find(id).filter(grant -> grant.tenantId().equals(operator.tenantId())).isEmpty()) {
            var failure = new PlatformException(ErrorCode.NOT_FOUND, "租户关联不存在");
            audit.rejected("REVOKE_TENANT", null, operator.tenantId(), id, operator, failure);
            throw failure;
        }
        grants.revokeTenant(id, operator);
    }
}
