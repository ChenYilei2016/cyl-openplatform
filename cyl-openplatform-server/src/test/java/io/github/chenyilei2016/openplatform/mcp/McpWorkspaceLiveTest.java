package io.github.chenyilei2016.openplatform.mcp;

import io.github.chenyilei2016.openplatform.domain.access.EmployeeDirectory;
import io.github.chenyilei2016.openplatform.domain.access.EmployeeIdentity;
import io.github.chenyilei2016.openplatform.domain.access.EmployeeProfile;
import io.github.chenyilei2016.openplatform.domain.access.EmployeeProfileRepository;
import io.github.chenyilei2016.openplatform.domain.access.EmployeeStatus;
import io.github.chenyilei2016.openplatform.domain.administration.AdminPermission;
import io.github.chenyilei2016.openplatform.domain.administration.Administrator;
import io.github.chenyilei2016.openplatform.domain.administration.AdministratorRepository;
import io.github.chenyilei2016.openplatform.domain.common.ObjectIdType;
import io.github.chenyilei2016.openplatform.domain.runtime.HttpApiInvoker;
import io.github.chenyilei2016.openplatform.domain.runtime.HttpParameters;
import io.github.chenyilei2016.openplatform.domain.runtime.InvocationContext;

import io.github.chenyilei2016.openplatform.application.identity.AccountAuthentication;
import io.github.chenyilei2016.openplatform.testing.TestAccount;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfSystemProperty;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

/** 浏览器/标准HTTP客户端验收夹具：独立H2+显式本机Redis，身份与提供方为替身，不读取公司配置。 */
@ActiveProfiles("test")
@EnabledIfSystemProperty(named = "mcp.live", matches = "true")
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.DEFINED_PORT, properties = {
        "server.port=18086", "server.address=127.0.0.1", "spring.datasource.url=jdbc:h2:mem:mcp-live;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1",
        "spring.cloud.nacos.config.enabled=false", "spring.cloud.nacos.discovery.enabled=false",
        "spring.data.redis.host=127.0.0.1", "spring.data.redis.port=16395", "spring.data.redis.database=0", "spring.data.redis.password=",
        "open-platform.environment-release.environment-id=mcp-fixture", "open-platform.publish.audit.enabled=false",
        "open-platform.signature.active-wrapping-key-id=mcp-fixture", "open-platform.signature.wrapping-keys.mcp-fixture=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
        "open-platform.local-login.enabled=false"
})
class McpWorkspaceLiveTest {
    @MockitoBean AccountAuthentication login;
    @MockitoBean EmployeeDirectory employees;
    @MockitoBean HttpApiInvoker provider;
    @Autowired AdministratorRepository administrators;
    @Autowired EmployeeProfileRepository profiles;
    @Autowired PlatformTransactionManager transactions;
    @Autowired StringRedisTemplate redis;

    @Test void serveIsolatedWorkspace() throws Exception {
        assertThat(redis.opsForValue().get("szopen:mcp-owned-redis")).isEqualTo("mcp-regression-only");
        // 独立Redis首次启动的恢复等待由fixture预置已恢复状态；实际Nonce消费与时窗验证仍走正式实现。
        redis.opsForZSet().add("szopen:{request-signature}:nonces", "!initialized", Instant.now().minusSeconds(1000).getEpochSecond());
        for (String tenant : List.of("101", "102")) {
            EmployeeIdentity person = new EmployeeIdentity(tenant, tenant + "01", tenant + "02", "E1", "101".equals(tenant) ? "MCP验收管理员" : "MCP未开通租户员工", true, EmployeeStatus.PERMANENT);
            when(employees.find(tenant, "E1")).thenReturn(person);
            TestAccount user = new TestAccount();
            user.setId(Long.valueOf(person.userId())); user.setEmployeeId(Long.valueOf(person.employeeId()));
            user.setTenantId(tenant); user.setEmployeeNoStr("E1"); user.setEmployeeName(person.displayName());
            when(login.current("mcp-" + tenant)).thenAnswer(invocation -> user.toAccount());
            when(login.authenticate("mcp-" + tenant, "fixture-password")).thenReturn(new AccountAuthentication.Account("mcp-" + tenant, user.toAccount().employee(), null));
            profiles.remember(new EmployeeProfile(null, tenant, "MCP验收租户" + tenant, person.employeeId(), person.userId(), "E1", person.displayName(), Instant.now()), Instant.EPOCH);
        }
        new TransactionTemplate(transactions).executeWithoutResult(transaction -> {
            administrators.lockControl();
            administrators.createAll(List.of(new Administrator(ObjectIdType.ADMINISTRATOR.nextId(), "101", "10101", "10102", "E1", "MCP验收管理员", true, true, 1, Set.of(AdminPermission.values()))));
        });
        when(provider.invoke(any(), any(), any(), anyString())).thenAnswer(invocation -> {
            InvocationContext context = invocation.getArgument(2);
            HttpParameters parameters = invocation.getArgument(1);
            return Map.of("tenantId", context.tenantId(), "orderNo", parameters.body().get("orderNo"));
        });
        Path directory = Path.of(System.getProperty("mcp.live.stateDir"));
        Files.createDirectories(directory);
        Path stop = directory.resolve("stop");
        Files.deleteIfExists(stop);
        Files.writeString(directory.resolve("ready.json"), "{\"port\":18086,\"environmentId\":\"mcp-fixture\",\"adminCookie\":\"mcp-101\",\"otherCookie\":\"mcp-102\"}");
        Instant deadline = Instant.now().plusSeconds(3600);
        while (Instant.now().isBefore(deadline) && !Files.exists(stop)) Thread.sleep(500);
    }
}
