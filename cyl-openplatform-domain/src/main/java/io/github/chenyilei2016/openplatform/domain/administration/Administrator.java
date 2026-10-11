package io.github.chenyilei2016.openplatform.domain.administration;

import io.github.chenyilei2016.openplatform.domain.access.EmployeeIdentity;

import java.util.Set;

/** 平台管理资格；账号ID、人员ID及工号分别保留并共同约束身份。 */
public record Administrator(
        String id,
        String tenantId,
        String userId,
        String employeeId,
        String employeeNo,
        String displayName,
        boolean enabled,
        boolean superAdministrator,
        long revision,
        Set<AdminPermission> permissions) {
    public Administrator {
        permissions = Set.copyOf(permissions);
    }

    public boolean matches(EmployeeIdentity identity) {
        return tenantId.equals(identity.tenantId())
                && userId.equals(identity.userId())
                && employeeId.equals(identity.employeeId())
                && employeeNo.equals(identity.employeeNo());
    }

    public boolean canAuditAdministrators() {
        return enabled && (superAdministrator || permissions.contains(AdminPermission.VIEW_AUDIT));
    }
}
