package io.github.chenyilei2016.openplatform.administration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.AdditionalAnswers.delegatesTo;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.baomidou.mybatisplus.annotation.DbType;
import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.extension.plugins.MybatisPlusInterceptor;
import com.baomidou.mybatisplus.extension.plugins.inner.PaginationInnerInterceptor;
import com.baomidou.mybatisplus.extension.spring.MybatisSqlSessionFactoryBean;
import io.github.chenyilei2016.openplatform.application.administration.AdministratorService;
import io.github.chenyilei2016.openplatform.domain.access.EmployeeDirectory;
import io.github.chenyilei2016.openplatform.domain.access.EmployeeIdentity;
import io.github.chenyilei2016.openplatform.domain.access.EmployeeProfileRepository;
import io.github.chenyilei2016.openplatform.domain.access.EmployeeStatus;
import io.github.chenyilei2016.openplatform.domain.administration.AdminPermission;
import io.github.chenyilei2016.openplatform.domain.administration.Administrator;
import io.github.chenyilei2016.openplatform.domain.administration.AdministratorActor;
import io.github.chenyilei2016.openplatform.domain.administration.AdministratorAuditQuery;
import io.github.chenyilei2016.openplatform.domain.administration.AdministratorQuery;
import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.github.chenyilei2016.openplatform.infrastructure.administration.dal.impl.AdministratorRepositoryImpl;
import io.github.chenyilei2016.openplatform.infrastructure.administration.dal.mapper.AdministratorAuditMapper;
import io.github.chenyilei2016.openplatform.infrastructure.administration.dal.mapper.AdministratorControlMapper;
import io.github.chenyilei2016.openplatform.infrastructure.administration.dal.mapper.AdministratorMapper;
import io.github.chenyilei2016.openplatform.infrastructure.administration.dal.mapper.AdministratorPermissionMapper;
import com.zaxxer.hikari.HikariDataSource;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mybatis.spring.SqlSessionTemplate;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.init.ResourceDatabasePopulator;
import org.springframework.transaction.support.TransactionTemplate;

import tools.jackson.databind.json.JsonMapper;

import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

/** 仅使用每例独立H2库，验证真实Mapper、事务、锁和审计；平台人员边界使用替身。 */
class AdministratorServiceTest {
    private EmployeeDirectory employees;
    private EmployeeProfileRepository profiles;
    private AdministratorService service;
    private AdministratorRepositoryImpl repository;
    private AdministratorAuditMapper audits;
    private AdministratorPermissionMapper permissions;
    private JdbcTemplate jdbc;
    private HikariDataSource source;

    @BeforeEach
    void database() throws Exception {
        // H2 2.4.240的IN检查约束引用建表会话；池化连接保持该会话存活到用例结束。
        source = new HikariDataSource();
        source.setJdbcUrl(
                "jdbc:h2:mem:"
                        + UUID.randomUUID()
                        + ";MODE=MySQL;DATABASE_TO_LOWER=TRUE;LOCK_TIMEOUT=5000");
        source.setMaximumPoolSize(4);
        source.setMinimumIdle(1);
        new ResourceDatabasePopulator(new ClassPathResource("db/administrator-schema.sql"))
                .execute(source);
        MybatisConfiguration configuration = new MybatisConfiguration();
        configuration.setMapUnderscoreToCamelCase(true);
        configuration.addMapper(AdministratorMapper.class);
        configuration.addMapper(AdministratorAuditMapper.class);
        configuration.addMapper(AdministratorPermissionMapper.class);
        configuration.addMapper(AdministratorControlMapper.class);
        MybatisPlusInterceptor interceptor = new MybatisPlusInterceptor();
        interceptor.addInnerInterceptor(new PaginationInnerInterceptor(DbType.H2));
        MybatisSqlSessionFactoryBean factory = new MybatisSqlSessionFactoryBean();
        factory.setDataSource(source);
        factory.setConfiguration(configuration);
        factory.setPlugins(interceptor);
        SqlSessionTemplate sessions = new SqlSessionTemplate(factory.getObject());
        audits =
                mock(
                        AdministratorAuditMapper.class,
                        delegatesTo(sessions.getMapper(AdministratorAuditMapper.class)));
        permissions =
                mock(
                        AdministratorPermissionMapper.class,
                        delegatesTo(sessions.getMapper(AdministratorPermissionMapper.class)));
        repository =
                new AdministratorRepositoryImpl(
                        sessions.getMapper(AdministratorMapper.class),
                        permissions,
                        audits,
                        sessions.getMapper(AdministratorControlMapper.class),
                        JsonMapper.builder().build());
        employees = mock(EmployeeDirectory.class);
        profiles = mock(EmployeeProfileRepository.class);
        service =
                new AdministratorService(
                        repository, employees, profiles, new DataSourceTransactionManager(source));
        jdbc = new JdbcTemplate(source);
        when(employees.find("tenant", "root")).thenReturn(identity("root"));
        when(employees.find("tenant", "second")).thenReturn(identity("second"));
        when(employees.find("tenant", "member")).thenReturn(identity("member"));
    }

    @AfterEach
    void closeDatabase() {
        if (source != null) source.close();
    }

    @Test
    void permissionConstraintRejectsUnknownActionsAndDuplicateIdentityIsConflict() {
        seed(List.of(administrator("root", true, Set.of())));
        assertThatThrownBy(
                        () ->
                                jdbc.update(
                                        "INSERT INTO platform_administrator_permission"
                                            + " (administrator_id, permission_code) VALUES (?, ?)",
                                        "root",
                                        "UNKNOWN_ACTION"))
                .isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
        assertThatThrownBy(
                        () ->
                                service.create(
                                        "tenant",
                                        "root",
                                        "user-root",
                                        "employee-root",
                                        Set.of(),
                                        false,
                                        "重复人员",
                                        actor("root")))
                .isInstanceOfSatisfying(
                        PlatformException.class,
                        failure ->
                                assertThat(failure.getErrorCode()).isEqualTo(ErrorCode.CONFLICT));
    }

    @Test
    void latestPermissionsFullIdentityAndDisabledStateAreEnforced() {
        seed(List.of(administrator("root", true, Set.of())));
        Administrator member =
                service.create(
                        "tenant",
                        "member",
                        "user-member",
                        "employee-member",
                        Set.of(AdminPermission.VIEW_AUDIT),
                        false,
                        "新增只读审计人员",
                        actor("root"));
        assertThat(service.authenticate(identity("member")).permissions())
                .containsExactly(AdminPermission.VIEW_AUDIT);
        EmployeeIdentity wrongIdentity =
                new EmployeeIdentity(
                        "tenant",
                        "employee-member",
                        "user-member",
                        "member",
                        "member",
                        true,
                        EmployeeStatus.PERMANENT);
        assertThatThrownBy(() -> service.authenticate(wrongIdentity)).hasMessageContaining("身份已变更");
        service.update(member.id(), 1, Set.of(), true, false, "撤销审计权限", actor("root"));
        assertThat(service.authenticate(identity("member")).permissions()).isEmpty();
        when(employees.find("tenant", "member")).thenThrow(new IllegalStateException("员工已离职"));
        service.update(member.id(), 2, Set.of(), false, false, "离职停用", actor("root"));
        assertThatThrownBy(() -> service.authenticate(identity("member")))
                .hasMessageContaining("已停用");
        assertThat(
                        service.audit(
                                        new AdministratorAuditQuery(1, 20, member.id()),
                                        actor("root"))
                                .items())
                .hasSize(3)
                .first()
                .satisfies(
                        audit -> {
                            assertThat(audit.before().enabled()).isTrue();
                            assertThat(audit.after().enabled()).isFalse();
                            assertThat(audit.reason()).isEqualTo("离职停用");
                        });
    }

    @Test
    void ordinaryAuditorCannotLookupOrAssignAndPagingBatchLoadsPermissions() {
        seed(
                List.of(
                        administrator("root", true, Set.of()),
                        administrator("member", false, Set.of(AdminPermission.VIEW_AUDIT))));
        clearInvocations(permissions);
        assertThat(
                        service.page(
                                        new AdministratorQuery(1, 20, null, null, "tenant", null, null, null),
                                        actor("member"))
                                .total())
                .isEqualTo(2);
        // 一次读取操作人权限，一次批量读取当前页权限，与页面人数无关。
        verify(permissions, times(2)).selectForAdministrators(anyList());
        assertThatThrownBy(() -> service.lookupEmployee("tenant", "second", actor("member")))
                .hasMessageContaining("总管理员");
        assertThatThrownBy(
                        () ->
                                service.update(
                                        "member", 1, Set.of(), true, true, "自行提权", actor("member")))
                .hasMessageContaining("总管理员");
    }

    @Test
    void singleSearchMatchesNameOrExactEmployeeNoAndRoleFilterWithBatchedTenantNames() {
        seed(
                List.of(
                        administrator("root", true, Set.of()),
                        administrator("member", false, Set.of(AdminPermission.VIEW_AUDIT)),
                        new Administrator("zhang", "tenant", "user-zhang", "employee-zhang", "E100", "张三",
                                true, false, 1, Set.of())));
        when(profiles.tenantNames(anyList())).thenReturn(java.util.Map.of("tenant", "测试租户"));
        var byName = service.page(new AdministratorQuery(1, 20, "张", null, null, null, null, null), actor("root"));
        assertThat(byName.items()).extracting("employeeNo").containsExactly("E100");
        assertThat(byName.items()).extracting("tenantName").containsOnly("测试租户");
        assertThat(service.page(new AdministratorQuery(1, 20, "E100", null, null, null, null, null), actor("root"))
                        .items()).extracting("displayName").containsExactly("张三");
        // 工号只做精确匹配。
        assertThat(service.page(new AdministratorQuery(1, 20, "E10", null, null, null, null, null), actor("root"))
                        .total()).isZero();
        assertThat(service.page(new AdministratorQuery(1, 20, null, null, null, null, null, true), actor("root"))
                        .items()).extracting("employeeNo").containsExactly("root");
        assertThat(service.page(new AdministratorQuery(1, 20, null, null, null, null, true, false), actor("root"))
                        .total()).isEqualTo(2);
        // 每页一次批量读取租户名称（空页不读取），与人数无关；详情读取单个租户名称。
        verify(profiles, times(4)).tenantNames(anyList());
        when(profiles.tenantName("tenant")).thenReturn("测试租户");
        assertThat(service.detail("member", actor("root")).tenantName()).isEqualTo("测试租户");
    }

    @Test
    void concurrentSelfDemotionsAlwaysLeaveOneEnabledSuperAdministrator() throws Exception {
        seed(
                List.of(
                        administrator("root", true, Set.of()),
                        administrator("second", true, Set.of())));
        CountDownLatch verified = new CountDownLatch(2);
        for (String number : List.of("root", "second")) {
            when(employees.find("tenant", number))
                    .thenAnswer(
                            invocation -> {
                                verified.countDown();
                                if (!verified.await(5, TimeUnit.SECONDS))
                                    throw new IllegalStateException("并发核验未就绪");
                                return identity(number);
                            });
        }
        try (ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor()) {
            Future<Boolean> first = executor.submit(() -> demote("root"));
            Future<Boolean> second = executor.submit(() -> demote("second"));
            assertThat(List.of(first.get(10, TimeUnit.SECONDS), second.get(10, TimeUnit.SECONDS)))
                    .containsExactlyInAnyOrder(true, false);
        }
        assertThat(
                        jdbc.queryForObject(
                                "SELECT COUNT(*) FROM platform_administrator WHERE enabled = TRUE"
                                    + " AND super_administrator = TRUE",
                                Long.class))
                .isEqualTo(1);
        assertThat(
                        jdbc.queryForObject(
                                "SELECT COUNT(*) FROM platform_administrator_audit WHERE action ="
                                    + " 'UPDATE'",
                                Long.class))
                .isEqualTo(1);
    }

    @Test
    void revokedActorIsRecheckedAfterExternalLookupBeforeWrite() {
        seed(
                List.of(
                        administrator("root", true, Set.of()),
                        administrator("second", true, Set.of())));
        when(employees.find("tenant", "member"))
                .thenAnswer(
                        invocation -> {
                            service.update(
                                    "root", 1, Set.of(), false, false, "撤销旧操作人", actor("second"));
                            return identity("member");
                        });
        assertThatThrownBy(
                        () ->
                                service.create(
                                        "tenant",
                                        "member",
                                        "user-member",
                                        "employee-member",
                                        Set.of(),
                                        false,
                                        "过期会话写入",
                                        actor("root")))
                .hasMessageContaining("总管理员");
        assertThat(
                        jdbc.queryForObject(
                                "SELECT COUNT(*) FROM platform_administrator WHERE employee_no ="
                                    + " 'member'",
                                Long.class))
                .isZero();
    }

    @Test
    void staleRevisionAndAuditFailureDoNotChangeAuthorization() {
        seed(List.of(administrator("root", true, Set.of())));
        assertThatThrownBy(
                        () ->
                                service.update(
                                        "root",
                                        2,
                                        Set.of(AdminPermission.VIEW_AUDIT),
                                        true,
                                        true,
                                        "过期修订",
                                        actor("root")))
                .hasMessageContaining("已变更");
        clearInvocations(audits);
        doThrow(new IllegalStateException("审计不可用")).when(audits).insertAll(anyList());
        assertThatThrownBy(
                        () ->
                                service.update(
                                        "root",
                                        1,
                                        Set.of(AdminPermission.VIEW_AUDIT),
                                        true,
                                        true,
                                        "授权与审计同时提交",
                                        actor("root")))
                .isInstanceOfSatisfying(
                        PlatformException.class,
                        failure ->
                                assertThat(failure.getErrorCode())
                                        .isEqualTo(ErrorCode.DEPENDENCY_UNAVAILABLE));
        verify(audits).insertAll(anyList());
        Administrator current = service.authenticate(identity("root"));
        assertThat(current.revision()).isEqualTo(1);
        assertThat(current.permissions()).isEmpty();
        assertThat(
                        jdbc.queryForObject(
                                "SELECT COUNT(*) FROM platform_administrator_audit", Long.class))
                .isZero();
    }

    @Test
    void databaseFailureFailsClosedAsUnavailable() {
        seed(List.of(administrator("root", true, Set.of())));
        jdbc.execute("DROP TABLE platform_administrator_permission");
        assertThatThrownBy(() -> service.authenticate(identity("root")))
                .isInstanceOfSatisfying(
                        PlatformException.class,
                        failure ->
                                assertThat(failure.getErrorCode())
                                        .isEqualTo(ErrorCode.DEPENDENCY_UNAVAILABLE));
    }

    private void seed(List<Administrator> administrators) {
        new TransactionTemplate(new DataSourceTransactionManager(source))
                .executeWithoutResult(transaction -> {
                    repository.lockControl();
                    repository.createAll(administrators);
                });
    }

    private boolean demote(String employeeNo) {
        try {
            service.update(employeeNo, 1, Set.of(), true, false, "并发取消本人总管理员", actor(employeeNo));
            return true;
        } catch (PlatformException exception) {
            assertThat(exception.getErrorCode()).isEqualTo(ErrorCode.CONFLICT);
            return false;
        }
    }

    private Administrator administrator(
            String employeeNo, boolean superAdministrator, Set<AdminPermission> permissions) {
        return new Administrator(
                employeeNo,
                "tenant",
                "user-" + employeeNo,
                "employee-" + employeeNo,
                employeeNo,
                employeeNo,
                true,
                superAdministrator,
                1,
                permissions);
    }

    private EmployeeIdentity identity(String employeeNo) {
        return new EmployeeIdentity(
                "tenant",
                "user-" + employeeNo,
                "employee-" + employeeNo,
                employeeNo,
                employeeNo,
                true,
                EmployeeStatus.PERMANENT);
    }

    private AdministratorActor actor(String employeeNo) {
        return new AdministratorActor(employeeNo, "tenant", employeeNo, "administrator-test");
    }
}
