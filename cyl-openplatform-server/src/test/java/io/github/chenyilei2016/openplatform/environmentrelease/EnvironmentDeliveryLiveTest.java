package io.github.chenyilei2016.openplatform.environmentrelease;

import io.github.chenyilei2016.openplatform.OpenPlatformApplication;
import io.github.chenyilei2016.openplatform.domain.access.*;
import io.github.chenyilei2016.openplatform.domain.administration.*;

import io.github.chenyilei2016.openplatform.application.identity.AccountAuthentication;
import io.github.chenyilei2016.openplatform.testing.TestAccount;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfSystemProperty;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.datasource.init.ResourceDatabasePopulator;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import javax.sql.DataSource;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.EnumSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import static org.mockito.Mockito.*;

/** 两个真实本机HTTP服务、独立H2和实际机器传输；仅本地账号身份由测试替身提供。 */
@EnabledIfSystemProperty(named="ui89.live", matches="true")
class EnvironmentDeliveryLiveTest {
    @Test
    void serveSourceAndTarget() throws Exception {
        String credential = UUID.randomUUID().toString()+UUID.randomUUID();
        try (ConfigurableApplicationContext target = start("target89",18084,credential,false);
             ConfigurableApplicationContext source = start("source89",18083,credential,true)) {
            seed(target); seed(source);
            Path directory=Path.of(System.getProperty("ui89.stateDir"));
            Files.createDirectories(directory);
            Path stop=directory.resolve("stop"); Files.deleteIfExists(stop);
            Files.writeString(directory.resolve("ready.json"),"{\"source\":18083,\"target\":18084,\"unreachableNode\":18085,\"tenant\":\"89\",\"admin\":\"E1\",\"reviewer\":\"E2\"}");
            Instant deadline=Instant.now().plusSeconds(7200);
            while(Instant.now().isBefore(deadline)&&!Files.exists(stop)) Thread.sleep(500);
        }
    }
    private ConfigurableApplicationContext start(String environment,int port,String credential,boolean source) {
        List<String> arguments=new ArrayList<>(List.of("--server.address=127.0.0.1","--server.port="+port,
            "--spring.datasource.url=jdbc:h2:mem:"+environment+";MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1",
            "--open-platform.environment-release.environment-id="+environment,"--open-platform.environment-release.node-id="+environment+"-a",
            "--open-platform.publish.audit.enabled="+!source,
            "--logging.level.root=WARN","--open-platform.local-login.enabled=false"));
        if(source) arguments.addAll(List.of("--open-platform.environment-release.targets[0].id=target89",
            "--open-platform.environment-release.targets[0].name=本机目标89（需审核）",
            "--open-platform.environment-release.targets[0].credential="+credential,
            "--open-platform.environment-release.targets[0].nodes[0].id=target89-a",
            "--open-platform.environment-release.targets[0].nodes[0].origin=http://127.0.0.1:18084",
            "--open-platform.environment-release.targets[0].nodes[1].id=target89-b",
            "--open-platform.environment-release.targets[0].nodes[1].origin=http://127.0.0.1:18085"));
        else arguments.addAll(List.of("--open-platform.environment-release.trusted-sources[0].id=source89",
            "--open-platform.environment-release.trusted-sources[0].credential="+credential));
        return new SpringApplicationBuilder(OpenPlatformApplication.class,IdentityFixture.class).profiles("test").run(arguments.toArray(String[]::new));
    }
    private void seed(ConfigurableApplicationContext context) {
        new ResourceDatabasePopulator(new ClassPathResource("db/administrator-schema.sql")).execute(context.getBean(DataSource.class));
        EmployeeProfileRepository profiles=context.getBean(EmployeeProfileRepository.class);
        AdministratorRepository administrators=context.getBean(AdministratorRepository.class);
        for (int i=1;i<=2;i++) profiles.remember(new EmployeeProfile(null,"89","受控交付租户","8900"+i,"8910"+i,"E"+i,i==1?"交付负责人":"目标审核人",Instant.now()),Instant.EPOCH);
        new TransactionTemplate(context.getBean(PlatformTransactionManager.class)).executeWithoutResult(tx->{
            administrators.lockControl();
            administrators.createAll(List.of(
                new Administrator("ui89-admin","89","89101","89001","E1","交付负责人",true,true,1,EnumSet.allOf(AdminPermission.class)),
                new Administrator("ui89-reviewer","89","89102","89002","E2","目标审核人",true,false,1,Set.of(AdminPermission.REVIEW_APIS))));
        });
    }
    @TestConfiguration(proxyBeanMethods=false)
    static class IdentityFixture {
        @Bean @Primary AccountAuthentication fixtureLogin() {
            AccountAuthentication login=mock(AccountAuthentication.class);
            for(int i=1;i<=2;i++) {
                TestAccount user=new TestAccount(); user.setId(89100L+i); user.setEmployeeId(89000L+i);
                user.setTenantId("89"); user.setEmployeeNoStr("E"+i); user.setEmployeeName(i==1?"交付负责人":"目标审核人");
                when(login.current("E"+i)).thenAnswer(invocation -> user.toAccount());
                when(login.authenticate("E"+i, "fixture-password")).thenReturn(new AccountAuthentication.Account("E"+i, user.toAccount().employee(), null));
            }
            return login;
        }
        @Bean @Primary EmployeeDirectory fixtureEmployees() {
            EmployeeDirectory directory=mock(EmployeeDirectory.class);
            for(int i=1;i<=2;i++) when(directory.find("89","E"+i)).thenReturn(new EmployeeIdentity("89","8910"+i,"8900"+i,"E"+i,i==1?"交付负责人":"目标审核人",true,EmployeeStatus.PERMANENT));
            return directory;
        }
    }
}
