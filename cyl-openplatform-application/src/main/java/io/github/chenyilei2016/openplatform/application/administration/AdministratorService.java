package io.github.chenyilei2016.openplatform.application.administration;

import io.github.chenyilei2016.openplatform.domain.common.ObjectIdType;
import io.github.chenyilei2016.openplatform.domain.access.EmployeeDirectory;
import io.github.chenyilei2016.openplatform.domain.access.EmployeeIdentity;
import io.github.chenyilei2016.openplatform.domain.access.EmployeeProfileRepository;
import io.github.chenyilei2016.openplatform.domain.administration.AdminPermission;
import io.github.chenyilei2016.openplatform.domain.administration.Administrator;
import io.github.chenyilei2016.openplatform.domain.administration.AdministratorActor;
import io.github.chenyilei2016.openplatform.domain.administration.AdministratorAudit;
import io.github.chenyilei2016.openplatform.domain.administration.AdministratorAuditQuery;
import io.github.chenyilei2016.openplatform.domain.administration.AdministratorQuery;
import io.github.chenyilei2016.openplatform.domain.administration.AdministratorRepository;
import io.github.chenyilei2016.openplatform.domain.administration.AdministratorStatus;
import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PageResult;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;

import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Supplier;

/** DB是唯一授权来源；外部人员查询在加锁前完成，写入及前后快照在同一事务中提交。 */
@Service
public class AdministratorService {
    private final AdministratorRepository administrators;
    private final EmployeeDirectory employees;
    private final EmployeeProfileRepository profiles;
    private final TransactionTemplate changes;
    private final TransactionTemplate reads;

    public AdministratorService(
            AdministratorRepository administrators,
            EmployeeDirectory employees,
            EmployeeProfileRepository profiles,
            PlatformTransactionManager transactions) {
        this.administrators = administrators;
        this.employees = employees;
        this.profiles = profiles;
        changes = new TransactionTemplate(transactions);
        // 锁获取前不建立旧快照；控制行锁之后才读取当前操作人和目标资格。
        changes.setIsolationLevel(TransactionDefinition.ISOLATION_READ_COMMITTED);
        reads = new TransactionTemplate(transactions);
        reads.setReadOnly(true);
        reads.setIsolationLevel(TransactionDefinition.ISOLATION_REPEATABLE_READ);
    }

    public Administrator authenticate(EmployeeIdentity identity) {
        if (identity == null) throw new PlatformException(ErrorCode.FORBIDDEN, "当前人员无平台管理资格");
        identity.requireGrantable(identity.tenantId(), identity.employeeNo());
        return available(
                () ->
                        reads.execute(
                                transaction -> {
                                    Administrator current =
                                            administrators
                                                    .findByIdentity(
                                                            identity.tenantId(),
                                                            identity.employeeNo())
                                                    .orElseThrow(
                                                            () ->
                                                                    new PlatformException(
                                                                            ErrorCode.FORBIDDEN,
                                                                            "当前人员无平台管理资格，请联系总管理员"));
                                    if (!current.enabled() || !current.matches(identity)) {
                                        throw new PlatformException(
                                                ErrorCode.FORBIDDEN, "平台管理资格已停用或身份已变更，请联系总管理员");
                                    }
                                    return current;
                                }));
    }

    /** 名单按当前页批量补充租户展示名称（一次查询）。 */
    public PageResult<AdministratorView> page(AdministratorQuery query, AdministratorActor actor) {
        return available(
                () ->
                        reads.execute(
                                transaction -> {
                                    requireActor(actor, false);
                                    PageResult<Administrator> page = administrators.page(query);
                                    Map<String, String> tenants = page.items().isEmpty() ? Map.of()
                                            : profiles.tenantNames(page.items().stream().map(Administrator::tenantId).distinct().toList());
                                    return new PageResult<>(
                                            page.items().stream()
                                                    .map(item -> AdministratorView.of(item, tenants.get(item.tenantId())))
                                                    .toList(),
                                            page.total(), page.page(), page.pageSize());
                                }));
    }

    public PageResult<AdministratorAudit> audit(
            AdministratorAuditQuery query, AdministratorActor actor) {
        return available(
                () ->
                        reads.execute(
                                transaction -> {
                                    requireActor(actor, false);
                                    return administrators.audit(query);
                                }));
    }

    public AdministratorStatus status(AdministratorActor actor) {
        return available(
                () ->
                        reads.execute(
                                transaction -> {
                                    requireActor(actor, false);
                                    return administrators.status();
                                }));
    }

    /** 工作区与冲突恢复读取同一对象的最新修订；权限与名单读取一致。 */
    public AdministratorView detail(String id, AdministratorActor actor) {
        return available(() -> reads.execute(transaction -> {
            requireActor(actor, false);
            Administrator administrator = administrators.find(id).orElseThrow(
                    () -> new PlatformException(ErrorCode.NOT_FOUND, "管理员记录不存在"));
            return AdministratorView.of(administrator, profiles.tenantName(administrator.tenantId()));
        }));
    }

    public EmployeeIdentity lookupEmployee(
            String tenantId, String employeeNo, AdministratorActor actor) {
        available(() -> reads.execute(transaction -> requireActor(actor, true)));
        return verifiedEmployee(tenantId, employeeNo);
    }

    public Administrator create(
            String tenantId,
            String employeeNo,
            String expectedUserId,
            String expectedEmployeeId,
            Set<AdminPermission> permissions,
            boolean superAdministrator,
            String reason,
            AdministratorActor actor) {
        validateChange(permissions, reason);
        available(() -> reads.execute(transaction -> requireActor(actor, true)));
        EmployeeIdentity identity = verifiedEmployee(tenantId, employeeNo);
        if (!identity.userId().equals(expectedUserId)
                || !identity.employeeId().equals(expectedEmployeeId)) {
            throw new PlatformException(ErrorCode.CONFLICT, "员工身份已变化，请重新查询并确认");
        }
        Administrator created =
                new Administrator(
                        ObjectIdType.ADMINISTRATOR.nextId(),
                        identity.tenantId(),
                        identity.userId(),
                        identity.employeeId(),
                        identity.employeeNo(),
                        identity.displayName(),
                        true,
                        superAdministrator,
                        1,
                        permissions);
        return change(
                () -> {
                    administrators.lockControl();
                    requireActor(actor, true);
                    if (administrators.findByIdentity(tenantId, employeeNo).isPresent()) {
                        throw new PlatformException(ErrorCode.CONFLICT, "员工已有管理员记录，请在原记录上调整权限");
                    }
                    administrators.createAll(List.of(created));
                    administrators.appendAudits(
                            List.of(auditEntry(null, created, "CREATE", reason, actor)));
                    return created;
                });
    }

    public Administrator update(
            String id,
            long expectedRevision,
            Set<AdminPermission> permissions,
            boolean enabled,
            boolean superAdministrator,
            String reason,
            AdministratorActor actor) {
        validateChange(permissions, reason);
        if (expectedRevision < 1)
            throw new PlatformException(ErrorCode.INVALID_REQUEST, "请提供当前管理员修订号");
        Administrator observed =
                available(
                        () ->
                                reads.execute(
                                        transaction -> {
                                            requireActor(actor, true);
                                            return administrators
                                                    .find(id)
                                                    .orElseThrow(
                                                            () ->
                                                                    new PlatformException(
                                                                            ErrorCode.NOT_FOUND,
                                                                            "管理员记录不存在"));
                                        }));
        // 停用离职人员不依赖人员目录仍能返回该员工；启用和保持启用时必须重新核验。
        EmployeeIdentity identity =
                enabled ? verifiedEmployee(observed.tenantId(), observed.employeeNo()) : null;
        if (identity != null && !observed.matches(identity)) {
            throw new PlatformException(ErrorCode.CONFLICT, "员工账号或人员身份已变化，不能复用旧管理员记录");
        }
        return change(
                () -> {
                    administrators.lockControl();
                    requireActor(actor, true);
                    Administrator current =
                            administrators
                                    .find(id)
                                    .orElseThrow(
                                            () ->
                                                    new PlatformException(
                                                            ErrorCode.NOT_FOUND, "管理员记录不存在"));
                    if (current.revision() != expectedRevision
                            || current.revision() != observed.revision()) {
                        throw new PlatformException(ErrorCode.CONFLICT, "管理员权限已变更，请刷新后重试");
                    }
                    if (current.enabled()
                            && current.superAdministrator()
                            && (!enabled || !superAdministrator)
                            && administrators.countEnabledSuperAdministrators() <= 1) {
                        throw new PlatformException(ErrorCode.CONFLICT, "必须保留至少一名启用的总管理员，请先授权其他人员");
                    }
                    Administrator updated =
                            new Administrator(
                                    current.id(),
                                    current.tenantId(),
                                    current.userId(),
                                    current.employeeId(),
                                    current.employeeNo(),
                                    identity == null
                                            ? current.displayName()
                                            : identity.displayName(),
                                    enabled,
                                    superAdministrator,
                                    Math.addExact(current.revision(), 1),
                                    permissions);
                    administrators.update(updated, expectedRevision);
                    administrators.appendAudits(
                            List.of(auditEntry(current, updated, "UPDATE", reason, actor)));
                    return updated;
                });
    }

    private Administrator requireActor(
            AdministratorActor actor, boolean requireSuperAdministrator) {
        if (actor == null) throw new PlatformException(ErrorCode.FORBIDDEN, "缺少可信管理身份");
        Administrator current =
                administrators
                        .find(actor.administratorId())
                        .orElseThrow(() -> new PlatformException(ErrorCode.FORBIDDEN, "当前管理资格已撤销"));
        if (!current.enabled()
                || !current.tenantId().equals(actor.tenantId())
                || !current.employeeNo().equals(actor.employeeNo())
                || (requireSuperAdministrator
                        ? !current.superAdministrator()
                        : !current.canAuditAdministrators())) {
            throw new PlatformException(
                    ErrorCode.FORBIDDEN,
                    requireSuperAdministrator ? "此操作需要总管理员权限，请联系总管理员" : "此操作需要查看审计记录权限或总管理员资格");
        }
        return current;
    }

    private EmployeeIdentity verifiedEmployee(String tenantId, String employeeNo) {
        requireText(tenantId, 64, "租户ID");
        requireText(employeeNo, 64, "工号");
        EmployeeIdentity identity = available(() -> employees.find(tenantId, employeeNo));
        if (identity == null) throw new PlatformException(ErrorCode.FORBIDDEN, "人员不存在或当前身份无效");
        identity.requireGrantable(tenantId, employeeNo);
        return identity;
    }

    private void validateChange(Set<AdminPermission> permissions, String reason) {
        if (permissions == null || permissions.stream().anyMatch(java.util.Objects::isNull)) {
            throw new PlatformException(ErrorCode.INVALID_REQUEST, "请选择有效的平台权限");
        }
        requireText(reason, 500, "变更原因");
    }

    private void requireText(String value, int maximum, String label) {
        if (value == null || value.isBlank() || value.length() > maximum) {
            throw new PlatformException(
                    ErrorCode.INVALID_REQUEST, label + "不能为空且不能超过" + maximum + "个字符");
        }
    }

    private AdministratorAudit auditEntry(
            Administrator before,
            Administrator after,
            String action,
            String reason,
            AdministratorActor actor) {
        return new AdministratorAudit(
                ObjectIdType.ADMINISTRATOR_AUDIT.nextId(),
                after.id(),
                actor.tenantId(),
                actor.employeeNo(),
                action,
                reason,
                before,
                after,
                actor.requestId(),
                Instant.now());
    }

    private <T> T change(Supplier<T> mutation) {
        return available(
                () -> {
                    try {
                        return changes.execute(transaction -> mutation.get());
                    } catch (DuplicateKeyException exception) {
                        throw new PlatformException(ErrorCode.CONFLICT, "管理员身份或授权记录冲突，请刷新后重试");
                    }
                });
    }

    private <T> T available(Supplier<T> operation) {
        try {
            return operation.get();
        } catch (PlatformException exception) {
            throw exception;
        } catch (RuntimeException exception) {
            throw new PlatformException(ErrorCode.DEPENDENCY_UNAVAILABLE,
                    "管理员权限服务暂不可用，请稍后重试", exception);
        }
    }
}
