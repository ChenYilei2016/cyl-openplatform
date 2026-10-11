package io.github.chenyilei2016.openplatform.application.access;

import io.github.chenyilei2016.openplatform.domain.common.ObjectIdType;
import io.github.chenyilei2016.openplatform.domain.access.EmployeeProfileRepository;
import java.util.Map;

import io.github.chenyilei2016.openplatform.domain.access.AccessOperator;
import io.github.chenyilei2016.openplatform.domain.access.AccessAudit.EmployeeTarget;
import io.github.chenyilei2016.openplatform.domain.access.AccessPageQuery;
import io.github.chenyilei2016.openplatform.domain.access.ApplicationKind;
import io.github.chenyilei2016.openplatform.domain.access.ApplicationRepository;
import io.github.chenyilei2016.openplatform.domain.access.ClientApplication;
import io.github.chenyilei2016.openplatform.domain.access.EmployeeDirectory;
import io.github.chenyilei2016.openplatform.domain.access.EmployeeIdentity;
import io.github.chenyilei2016.openplatform.domain.access.GrantStatus;
import io.github.chenyilei2016.openplatform.domain.access.TenantGrant;
import io.github.chenyilei2016.openplatform.domain.access.TenantGrantRepository;
import io.github.chenyilei2016.openplatform.domain.access.UserGrant;
import io.github.chenyilei2016.openplatform.domain.access.UserGrantRepository;
import io.github.chenyilei2016.openplatform.domain.common.CredentialSecrets;
import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PageResult;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;

import lombok.RequiredArgsConstructor;

import org.springframework.stereotype.Service;

import java.util.Optional;

@Service
@RequiredArgsConstructor
public class GrantManagementService {
    private final ApplicationRepository applications;
    private final TenantGrantRepository tenants;
    private final AccessAuditService audit;
    private final UserGrantRepository users;
    private final EmployeeDirectory employees;
    private final EmployeeProfileService profiles;
    private final EmployeeProfileRepository profileRecords;

    public TenantGrantView bindTenant(
            String appKey, String secret, String tenantId, AccessOperator operator) {
        var existingApp = applications.findByKey(appKey);
        String applicationId = existingApp.map(ClientApplication::id).orElse(null);
        return audit.change(
                "BIND_TENANT",
                applicationId,
                tenantId,
                applicationId,
                operator,
                () -> {
                    if (applicationId == null)
                        throw new PlatformException(ErrorCode.FORBIDDEN, "应用凭据无效");
                    ClientApplication app = applications.lock(applicationId);
                    // MCP 网关凭据不绑定租户：与凭据不匹配同样拒绝，不暴露其存在。
                    if (app.kind() != ApplicationKind.STANDARD)
                        throw new PlatformException(ErrorCode.FORBIDDEN, "应用凭据无效");
                    if (!CredentialSecrets.matches(
                            secret, applications.secretDigest(applicationId))) {
                        throw new PlatformException(ErrorCode.FORBIDDEN, "应用凭据无效");
                    }
                    app.status().requireEnabled();
                    var existing = tenants.findByTenant(applicationId, tenantId);
                    if (existing.isPresent()) {
                        if (existing.get().status() == GrantStatus.ACTIVE)
                            throw new PlatformException(ErrorCode.CONFLICT, "租户已关联此应用");
                        tenants.reactivate(existing.get().id());
                        return TenantGrantView.from(tenant(existing.get().id()));
                    }
                    TenantGrant grant =
                            new TenantGrant(
                                    ObjectIdType.TENANT_GRANT.nextId(),
                                    applicationId,
                                    tenantId,
                                    GrantStatus.ACTIVE,
                                    0,
                                    "",
                                    0);
                    tenants.create(grant);
                    return TenantGrantView.from(grant);
                });
    }

    public PageResult<TenantGrantView> tenants(String applicationId, AccessPageQuery query) {
        applications
                .find(applicationId)
                .orElseThrow(() -> new PlatformException(ErrorCode.NOT_FOUND, "应用不存在"));
        PageResult<TenantGrant> page = tenants.page(applicationId, query);
        Map<String, String> names = profileRecords.tenantNames(
                page.items().stream().map(TenantGrant::tenantId).distinct().toList());
        return new PageResult<>(
                page.items().stream().map(grant -> TenantGrantView.from(grant).withTenantName(names.get(grant.tenantId()))).toList(),
                page.total(),
                page.page(),
                page.pageSize());
    }

    /** 定点读取并核对父子归属，不通过全量分页寻找租户关系。 */
    public TenantGrantView tenant(String applicationId, String id) {
        applications
                .find(applicationId)
                .orElseThrow(() -> new PlatformException(ErrorCode.NOT_FOUND, "调用方凭据不存在"));
        return tenants.find(id)
                .filter(grant -> grant.applicationId().equals(applicationId))
                .map(grant -> TenantGrantView.from(grant).withTenantName(profileRecords.tenantName(grant.tenantId())))
                .orElseThrow(() -> new PlatformException(ErrorCode.NOT_FOUND, "该凭据下的租户关联不存在"));
    }

    /** 展示备注独立使用noteRevision，既不改变授权版本，也不影响其他租户。 */
    public TenantGrantView updateNote(String applicationId, String id, String note, long expectedRevision, AccessOperator operator) {
        TenantGrantView binding = tenant(applicationId, id);
        return audit.change("UPDATE_TENANT_NOTE", applicationId, binding.tenantId(), id, operator, () -> {
            TenantGrant current = tenants.find(id).filter(grant -> grant.applicationId().equals(applicationId))
                    .orElseThrow(() -> new PlatformException(ErrorCode.NOT_FOUND, "该凭据下的租户关联不存在"));
            TenantGrant updated = current.withNote(note, expectedRevision);
            if (!tenants.updateNote(updated, expectedRevision))
                throw new PlatformException(ErrorCode.CONFLICT, "备注或关联状态已变化，请核对后重新保存");
            return TenantGrantView.from(updated).withTenantName(binding.tenantName());
        });
    }

    public void revokeTenant(String id, AccessOperator operator) {
        var existing = tenants.find(id);
        audit.change(
                "REVOKE_TENANT",
                existing.map(TenantGrant::applicationId).orElse(null),
                existing.map(TenantGrant::tenantId).orElse(null),
                id,
                operator,
                () -> {
                    TenantGrant grant =
                            existing.orElseThrow(
                                    () -> new PlatformException(ErrorCode.NOT_FOUND, "租户关联不存在"));
                    applications.lock(grant.applicationId());
                    tenants.revoke(id);
                    users.revokeByTenant(id);
                    return null;
                });
    }

    public UserGrantView grantUser(
            String tenantGrantId, String employeeNo, String expectedUserId, String expectedEmployeeId, AccessOperator operator) {
        var found = tenants.find(tenantGrantId);
        String appId = found.map(TenantGrant::applicationId).orElse(null);
        String tenantId = found.map(TenantGrant::tenantId).orElse(null);
        TenantGrant initialGrant;
        ClientApplication initialApp;
        EmployeeIdentity identity;
        Optional<UserGrant> initialUser;
        try {
            initialGrant =
                    found.orElseThrow(() -> new PlatformException(ErrorCode.NOT_FOUND, "租户关联不存在"));
            initialApp =
                    applications
                            .find(initialGrant.applicationId())
                            .orElseThrow(() -> new PlatformException(ErrorCode.NOT_FOUND, "应用不存在"));
            initialApp.status().requireEnabled();
            initialGrant.status().requireActive();
            initialUser = users.findByEmployeeNo(tenantGrantId, employeeNo);
            // USC网络调用在事务和行锁之外完成；落库前再次核对应用、租户及人员撤销版本。
            identity = employees.find(initialGrant.tenantId(), employeeNo);
            identity.requireGrantable(initialGrant.tenantId(), employeeNo);

        } catch (PlatformException failure) {
            audit.rejected("GRANT_USER", appId, tenantId, tenantGrantId, operator, failure);
            throw failure;
        }
        EmployeeTarget auditTarget = EmployeeTarget.from(tenantGrantId, identity);
        if ((expectedUserId != null && !expectedUserId.equals(identity.userId()))
                || (expectedEmployeeId != null && !expectedEmployeeId.equals(identity.employeeId()))) {
            PlatformException failure = new PlatformException(ErrorCode.CONFLICT, "该工号对应的人员已变化，请重新核验后确认");
            audit.rejectedPersonnel("GRANT_USER", appId, tenantId, tenantGrantId, operator, auditTarget, failure);
            throw failure;
        }
        // 工号复用不能自动转移原人员的委托归属，包括已撤销记录。
        if (initialUser.isPresent() && !initialUser.get().employeeId().equals(identity.employeeId())) {
            PlatformException failure = new PlatformException(ErrorCode.CONFLICT,
                    "该工号的历史委托属于另一人员，请核对人员工号与历史委托；重新核验不会自动转移授权");
            audit.rejectedPersonnel("GRANT_USER", appId, tenantId, tenantGrantId, operator, auditTarget, failure);
            throw failure;
        }
        UserGrantView result =
                audit.changePersonnel(
                        "GRANT_USER",
                        appId,
                        tenantId,
                        tenantGrantId,
                        operator,
                        auditTarget,
                        () -> {
                            ClientApplication app = applications.lock(initialGrant.applicationId());
                            TenantGrant current = tenant(tenantGrantId);
                            app.status().requireEnabled();
                            current.status().requireActive();
                            if (app.authorizationVersion() != initialApp.authorizationVersion()
                                    || current.authorizationVersion()
                                            != initialGrant.authorizationVersion()) {
                                throw new PlatformException(
                                        ErrorCode.CONFLICT, "查询人员期间授权状态已变化，请重新操作");
                            }
                            var existing =
                                    users.findByEmployee(tenantGrantId, identity.employeeId());
                            if (!initialUser.map(UserGrant::id).equals(existing.map(UserGrant::id))
                                    || !initialUser
                                            .map(UserGrant::authorizationVersion)
                                            .equals(
                                                    existing.map(
                                                            UserGrant::authorizationVersion))) {
                                throw new PlatformException(
                                        ErrorCode.CONFLICT, "查询人员期间人员授权已变化，请重新操作");
                            }
                            if (existing.isPresent()
                                    && existing.get().status() == GrantStatus.ACTIVE) {
                                if (!existing.get().userId().equals(identity.userId())
                                        || !existing.get().employeeNo().equals(identity.employeeNo())) {
                                    throw new PlatformException(ErrorCode.CONFLICT, "既有人员委托身份已变化，请先撤销再重新建立");
                                }
                                return UserGrantView.from(existing.get());
                            }
                            UserGrant grant =
                                    new UserGrant(
                                            existing.map(UserGrant::id)
                                                    .orElseGet(() -> ObjectIdType.USER_GRANT.nextId()),
                                            tenantGrantId,
                                            current.tenantId(),
                                            identity.userId(),
                                            identity.employeeId(),
                                            identity.employeeNo(),
                                            identity.displayName(),
                                            GrantStatus.ACTIVE,
                                            existing.map(value -> value.authorizationVersion() + 1)
                                                    .orElse(0L));
                            if (existing.isPresent()) users.reactivate(grant);
                            else users.create(grant);
                            return UserGrantView.from(grant);
                        });
        profiles.remember(identity, null);
        return result;
    }

    /** 确认页只读核验，不创建委托；真正提交仍需再核验并复核授权版本。 */
    public EmployeeIdentity lookupUser(String tenantGrantId, String employeeNo) {
        TenantGrant grant = tenant(tenantGrantId);
        applications.find(grant.applicationId())
                .orElseThrow(() -> new PlatformException(ErrorCode.NOT_FOUND, "应用不存在")).status().requireEnabled();
        grant.status().requireActive();
        EmployeeIdentity identity = employees.find(grant.tenantId(), employeeNo);
        identity.requireGrantable(grant.tenantId(), employeeNo);
        return identity;
    }

    public PageResult<UserGrantView> users(String tenantGrantId, AccessPageQuery query) {
        tenant(tenantGrantId);
        var page = users.page(tenantGrantId, query);
        return new PageResult<>(
                page.items().stream().map(UserGrantView::from).toList(),
                page.total(),
                page.page(),
                page.pageSize());
    }

    public void revokeUser(String id, Long expectedVersion, AccessOperator operator) {
        var existing = users.find(id);
        var relatedTenant = existing.flatMap(user -> tenants.find(user.tenantGrantId()));
        audit.changePersonnel(
                "REVOKE_USER",
                relatedTenant.map(TenantGrant::applicationId).orElse(null),
                relatedTenant.map(TenantGrant::tenantId).orElse(null),
                id,
                operator,
                existing.map(EmployeeTarget::from).orElse(null),
                () -> {
                    TenantGrant tenant =
                            relatedTenant.orElseThrow(
                                    () -> new PlatformException(ErrorCode.NOT_FOUND, "人员授权不存在"));
                    applications.lock(tenant.applicationId());
                    UserGrant current = users.find(id)
                            .orElseThrow(() -> new PlatformException(ErrorCode.NOT_FOUND, "人员授权不存在"));
                    if (expectedVersion != null && current.authorizationVersion() != expectedVersion) {
                        throw new PlatformException(ErrorCode.CONFLICT, "人员委托状态已变化，请刷新后核对");
                    }
                    if (current.status() == GrantStatus.ACTIVE) users.revoke(id);
                    return UserGrantView.from(current);
                });
    }

    private TenantGrant tenant(String id) {
        return tenants.find(id)
                .orElseThrow(() -> new PlatformException(ErrorCode.NOT_FOUND, "租户关联不存在"));
    }
}
