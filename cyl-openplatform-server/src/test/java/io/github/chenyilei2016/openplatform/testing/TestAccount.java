package io.github.chenyilei2016.openplatform.testing;

import io.github.chenyilei2016.openplatform.application.identity.AccountAuthentication;
import io.github.chenyilei2016.openplatform.domain.access.EmployeeIdentity;
import io.github.chenyilei2016.openplatform.domain.access.EmployeeStatus;
import lombok.Getter;
import lombok.Setter;

/** HTTP业务测试的身份构建器，不参与生产装配。 */
@Getter @Setter
public class TestAccount {
    private TestTenant tenant;
    private Long id;
    private Long employeeId;
    private String tenantId;
    private String employeeNoStr;
    private String employeeName = "测试管理员";
    public AccountAuthentication.Account verified(io.github.chenyilei2016.openplatform.domain.access.EmployeeDirectory directory) {
        EmployeeIdentity identity = directory.find(tenantId, employeeNoStr);
        identity.requireGrantable(tenantId, employeeNoStr);
        if (!identity.userId().equals(String.valueOf(id))) throw new io.github.chenyilei2016.openplatform.domain.common.PlatformException(io.github.chenyilei2016.openplatform.domain.common.ErrorCode.FORBIDDEN, "身份已变更");
        return new AccountAuthentication.Account(employeeNoStr, identity, tenant == null ? null : tenant.getName());
    }
    public AccountAuthentication.Account toAccount() {
        EmployeeIdentity identity = new EmployeeIdentity(tenantId, id == null ? null : id.toString(),
                employeeId == null ? (id == null ? null : id.toString()) : employeeId.toString(), employeeNoStr,
                employeeName, true, EmployeeStatus.PERMANENT);
        return new AccountAuthentication.Account(employeeNoStr, identity, tenant != null && tenantId.equals(String.valueOf(tenant.getId())) ? tenant.getName() : null);
    }
}
