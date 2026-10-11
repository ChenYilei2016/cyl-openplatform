package io.github.chenyilei2016.openplatform.application.administration;

import io.github.chenyilei2016.openplatform.domain.administration.AdminPermission;
import io.github.chenyilei2016.openplatform.domain.administration.Administrator;

import java.util.Set;

/** 管理员名单与详情的展示视图：在资格记录上补充租户展示名称（未登记时为空），名称不作为身份或授权依据。 */
public record AdministratorView(
        String id,
        String tenantId,
        String tenantName,
        String userId,
        String employeeId,
        String employeeNo,
        String displayName,
        boolean enabled,
        boolean superAdministrator,
        long revision,
        Set<AdminPermission> permissions) {
    public static AdministratorView of(Administrator administrator, String tenantName) {
        return new AdministratorView(
                administrator.id(),
                administrator.tenantId(),
                tenantName,
                administrator.userId(),
                administrator.employeeId(),
                administrator.employeeNo(),
                administrator.displayName(),
                administrator.enabled(),
                administrator.superAdministrator(),
                administrator.revision(),
                administrator.permissions());
    }
}
