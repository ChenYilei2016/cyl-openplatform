package io.github.chenyilei2016.openplatform.administration;

import io.github.chenyilei2016.openplatform.domain.access.*;
import io.github.chenyilei2016.openplatform.domain.administration.*;

import io.github.chenyilei2016.openplatform.application.identity.AccountAuthentication;
import io.github.chenyilei2016.openplatform.testing.TestAccount;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfSystemProperty;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.context.jdbc.Sql;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.when;

/** 可选实页验收：真实HTTP/授权/SQL，外部本地账号身份替身与独立H2；不启动公司local配置。 */
@org.springframework.test.context.ActiveProfiles("test")
@EnabledIfSystemProperty(named = "ui81.live", matches = "true")
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.DEFINED_PORT, properties = {
    "spring.datasource.driver-class-name=org.h2.Driver", "spring.datasource.username=sa", "spring.datasource.password=",
    "open-platform.local-login.enabled=false", "spring.cloud.nacos.config.enabled=false", "spring.cloud.nacos.discovery.enabled=false",
    "server.port=18082", "server.address=127.0.0.1",
    "spring.datasource.url=jdbc:h2:mem:ui81;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1"
})
@Sql("classpath:db/administrator-schema.sql")
class AdministratorWorkspaceLiveTest {
    @MockitoBean AccountAuthentication login;
    @MockitoBean EmployeeDirectory employees;
    @Autowired AdministratorRepository administrators;
    @Autowired EmployeeProfileRepository profiles;
    @Autowired PlatformTransactionManager transactions;

    @Test
    void serveControlledBrowserWorkspace() throws Exception {
        List<EmployeeIdentity> identities = new ArrayList<>();
        for (int i = 1; i <= 26; i++) {
            identities.add(new EmployeeIdentity("81", String.valueOf(81000 + i), String.valueOf(82000 + i),
                    "E" + i, i == 1 ? "验收总管理员" : i == 2 ? "验收审计员" : "验收员工" + i, true, EmployeeStatus.PERMANENT));
        }
        when(employees.find(anyString(), anyString())).thenAnswer(invocation -> identities.stream()
                .filter(person -> person.tenantId().equals(invocation.getArgument(0)) && person.employeeNo().equals(invocation.getArgument(1)))
                .findFirst().orElseThrow(() -> new io.github.chenyilei2016.openplatform.domain.common.PlatformException(
                        io.github.chenyilei2016.openplatform.domain.common.ErrorCode.FORBIDDEN, "人员不存在或不可授权")));
        for (EmployeeIdentity identity : identities) {
            TestAccount user = new TestAccount();
            user.setId(Long.valueOf(identity.userId())); user.setEmployeeId(Long.valueOf(identity.employeeId()));
            user.setTenantId(identity.tenantId()); user.setEmployeeNoStr(identity.employeeNo()); user.setEmployeeName(identity.displayName());
            when(login.current(identity.employeeNo())).thenAnswer(invocation -> user.toAccount());
            when(login.authenticate(identity.employeeNo(), "fixture-password")).thenReturn(new AccountAuthentication.Account(identity.employeeNo(), user.toAccount().employee(), null));
            profiles.remember(new EmployeeProfile(null, identity.tenantId(), "独立验收租户", identity.employeeId(), identity.userId(),
                    identity.employeeNo(), identity.displayName(), Instant.now()), Instant.EPOCH);
        }
        new TransactionTemplate(transactions).executeWithoutResult(transaction -> {
            administrators.lockControl();
            administrators.createAll(identities.subList(0, 22).stream().map(person -> new Administrator(
                    "ui81-" + person.employeeNo(), person.tenantId(), person.userId(), person.employeeId(), person.employeeNo(),
                    person.employeeNo().equals("E3") ? "用于桌面长名称排版验收的跨团队接口运维管理员" : person.displayName(), true,
                    person.employeeNo().equals("E1"), 1,
                    person.employeeNo().equals("E2") ? Set.of(AdminPermission.VIEW_AUDIT) : Set.of(AdminPermission.MANAGE_APIS))).toList());
        });
        Path directory = Path.of(System.getProperty("ui81.stateDir"));
        Files.createDirectories(directory);
        Path stop = directory.resolve("stop");
        Files.deleteIfExists(stop);
        Files.writeString(directory.resolve("ready.json"), "{\"port\":18082,\"tenantId\":\"81\",\"root\":\"E1\",\"auditor\":\"E2\",\"newEmployees\":[\"E23\",\"E24\",\"E25\",\"E26\"]}");
        Instant deadline = Instant.now().plusSeconds(3600);
        while (Instant.now().isBefore(deadline) && !Files.exists(stop)) Thread.sleep(500);
    }
}
