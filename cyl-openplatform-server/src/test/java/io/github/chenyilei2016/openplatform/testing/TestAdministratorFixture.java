package io.github.chenyilei2016.openplatform.testing;

import io.github.chenyilei2016.openplatform.application.administration.AdministratorLoginService;
import io.github.chenyilei2016.openplatform.domain.access.EmployeeIdentity;
import io.github.chenyilei2016.openplatform.domain.administration.AdminPermission;
import io.github.chenyilei2016.openplatform.domain.administration.Administrator;
import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;

import org.mockito.Mockito;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;

import java.util.EnumSet;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

/** 仅测试环境的授权替身，测试人员配置不参与生产授权。 */
@TestConfiguration(proxyBeanMethods = false)
@EnableConfigurationProperties(TestAdministratorFixture.Settings.class)
public class TestAdministratorFixture {
    @Bean
    @Primary
    AdministratorLoginService testAdministratorLogin(Settings settings) {
        return Mockito.mock(
                AdministratorLoginService.class,
                invocation -> {
                    if (!invocation.getMethod().getName().equals("authenticate"))
                        return Mockito.RETURNS_DEFAULTS.answer(invocation);
                    String tenant = invocation.getArgument(0),
                            user = invocation.getArgument(1),
                            employee = invocation.getArgument(2);
                    EmployeeIdentity verified = invocation.getArgument(3);
                    Set<AdminPermission> permissions =
                            settings.operators().stream()
                                    .filter(
                                            operator ->
                                                    tenant.equals(operator.tenantId())
                                                            && employee.equals(
                                                                    operator.employeeNo()))
                                    .flatMap(operator -> operator.permissions().stream())
                                    .collect(
                                            Collectors.toCollection(
                                                    () -> EnumSet.noneOf(AdminPermission.class)));
                    if (permissions.isEmpty())
                        throw new PlatformException(ErrorCode.FORBIDDEN, "无此后台操作权限");
                    Administrator administrator =
                            new Administrator(
                                    "test-operator",
                                    tenant,
                                    user,
                                    verified == null ? user : verified.employeeId(),
                                    employee,
                                    verified == null ? "测试管理员" : verified.displayName(),
                                    true,
                                    false,
                                    1,
                                    permissions);
                    EmployeeIdentity employeeIdentity =
                            verified == null
                                    ? new EmployeeIdentity(
                                            tenant,
                                            user,
                                            user,
                                            employee,
                                            "测试管理员",
                                            true,
                                            io.github.chenyilei2016.openplatform.domain.access.EmployeeStatus
                                                    .PERMANENT)
                                    : verified;
                    return new AdministratorLoginService.AuthenticatedAdministrator(
                            administrator, employeeIdentity);
                });
    }

    @ConfigurationProperties("test.admin")
    public record Settings(List<Operator> operators) {
        public Settings {
            operators = operators == null ? List.of() : List.copyOf(operators);
        }
    }

    public record Operator(String tenantId, String employeeNo, Set<AdminPermission> permissions) {
        public Operator {
            permissions = permissions == null ? Set.of() : Set.copyOf(permissions);
        }
    }
}
