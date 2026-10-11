package io.github.chenyilei2016.openplatform.testing;
import io.github.chenyilei2016.openplatform.domain.access.EmployeeIdentity;
import io.github.chenyilei2016.openplatform.domain.access.EmployeeStatus;
import lombok.Getter;
import lombok.Setter;
/** 人员目录SPI的可变测试构建器，用于验证停用、离职与身份变更。 */
@Getter @Setter
public class TestEmployee {
    private Long id, userId, tenantId;
    private String employeeNoStr, name;
    private Boolean enabled;
    private Integer employeeStatus;
    public EmployeeIdentity toIdentity() {
        return new EmployeeIdentity(text(tenantId), text(userId), text(id), employeeNoStr, name,
                Boolean.TRUE.equals(enabled), EmployeeStatus.fromCode(employeeStatus));
    }
    private static String text(Long id) { return id == null || id <= 0 ? null : id.toString(); }
}
