package io.github.chenyilei2016.openplatform.identity;

import static io.github.chenyilei2016.openplatform.domain.administration.AdminPermission.*;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import io.github.chenyilei2016.openplatform.domain.administration.AdminPermission;
import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;

import org.junit.jupiter.api.Test;
import org.springframework.aop.framework.ProxyFactory;
import org.springframework.beans.factory.support.StaticListableBeanFactory;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.mvc.method.RequestMappingInfo;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;
import java.util.Set;

class AdminAuthorizationTest {
    @Test
    void anyAndAllHaveDistinctPermissionSemantics() throws Exception {
        HandlerMethod any = new HandlerMethod(new Policies(), "any");
        HandlerMethod all = new HandlerMethod(new Policies(), "all");
        assertThatCode(() -> AdminAuthorization.authorize(any, session(false, MANAGE_APIS)))
                .doesNotThrowAnyException();
        assertThatCode(
                        () ->
                                AdminAuthorization.authorize(
                                        all, session(false, MANAGE_APIS, PUBLISH_APIS)))
                .doesNotThrowAnyException();
        assertThatThrownBy(() -> AdminAuthorization.authorize(all, session(false, MANAGE_APIS)))
                .isInstanceOf(PlatformException.class)
                .hasMessageContaining("全部");
        assertThatThrownBy(() -> AdminAuthorization.authorize(any, session(false, VIEW_AUDIT)))
                .isInstanceOf(PlatformException.class)
                .hasMessageContaining("任一");
    }

    @Test
    void methodOnlyTightensClassAndSessionOnlyCannotOverrideClass() throws Exception {
        HandlerMethod tightened = new HandlerMethod(new ClassPolicy(), "write");
        HandlerMethod sessionMethod = new HandlerMethod(new ClassPolicy(), "session");
        assertThatCode(
                        () ->
                                AdminAuthorization.authorize(
                                        tightened, session(false, MANAGE_APIS, PUBLISH_APIS)))
                .doesNotThrowAnyException();
        assertThatThrownBy(
                        () -> AdminAuthorization.authorize(tightened, session(false, PUBLISH_APIS)))
                .isInstanceOf(PlatformException.class);
        assertThatThrownBy(
                        () -> AdminAuthorization.authorize(tightened, session(false, MANAGE_APIS)))
                .isInstanceOf(PlatformException.class);
        assertThatThrownBy(() -> AdminAuthorization.authorize(sessionMethod, session(true)))
                .isInstanceOf(PlatformException.class);
    }

    @Test
    void superAdministratorDoesNotImplyBusinessPermissions() throws Exception {
        HandlerMethod restricted = new HandlerMethod(new Policies(), "superAndBusiness");
        assertThatThrownBy(() -> AdminAuthorization.authorize(restricted, session(true)))
                .isInstanceOf(PlatformException.class);
        assertThatThrownBy(
                        () -> AdminAuthorization.authorize(restricted, session(false, MANAGE_APIS)))
                .isInstanceOf(PlatformException.class)
                .hasMessageContaining("总管理员身份");
        assertThatCode(() -> AdminAuthorization.authorize(restricted, session(true, MANAGE_APIS)))
                .doesNotThrowAnyException();
        assertThatCode(
                        () ->
                                AdminAuthorization.authorize(
                                        new HandlerMethod(new Policies(), "session"),
                                        session(true)))
                .doesNotThrowAnyException();
    }

    @Test
    void missingEmptyAndAmbiguousDeclarationsFailClosed() throws Exception {
        for (String name : Set.of("missing", "empty", "ambiguous")) {
            HandlerMethod handler = new HandlerMethod(new Policies(), name);
            assertThat(AdminAuthorization.hasDeclaration(handler)).as(name).isFalse();
            assertThatThrownBy(
                            () ->
                                    AdminAuthorization.authorize(
                                            handler, session(true, AdminPermission.values())))
                    .isInstanceOfSatisfying(
                            PlatformException.class,
                            failure ->
                                    assertThat(failure.getErrorCode())
                                            .isEqualTo(ErrorCode.FORBIDDEN));
        }
    }

    @Test
    void composedAnnotationsAndBothProxyTypesRetainClassAndMethodPolicies() throws Exception {
        for (boolean subclassProxy : Set.of(false, true)) {
            ProxyFactory factory = new ProxyFactory(new ProxiedController());
            factory.setProxyTargetClass(subclassProxy);
            HandlerMethod handler =
                    new HandlerMethod(factory.getProxy(), Endpoint.class.getMethod("write"));
            assertThat(AdminAuthorization.hasDeclaration(handler)).isTrue();
            assertThatCode(
                            () ->
                                    AdminAuthorization.authorize(
                                            handler, session(false, MANAGE_APIS, PUBLISH_APIS)))
                    .doesNotThrowAnyException();
            assertThatThrownBy(
                            () ->
                                    AdminAuthorization.authorize(
                                            handler, session(false, PUBLISH_APIS)))
                    .isInstanceOf(PlatformException.class);
            assertThatThrownBy(
                            () ->
                                    AdminAuthorization.authorize(
                                            handler, session(false, MANAGE_APIS)))
                    .isInstanceOf(PlatformException.class);
        }
    }

    @Test
    void startupCoverageChecksManagementRoutesWithoutRestrictingPublicRoutes() throws Exception {
        RequestMappingHandlerMapping mapping = new RequestMappingHandlerMapping();
        Policies controller = new Policies();
        mapping.registerMapping(
                RequestMappingInfo.paths("/public/ping").build(),
                controller,
                Policies.class.getMethod("missing"));
        mapping.registerMapping(
                RequestMappingInfo.paths("/admin-api/declared").build(),
                controller,
                Policies.class.getMethod("any"));
        StaticListableBeanFactory beans = new StaticListableBeanFactory();
        beans.addBean("mapping", mapping);
        AdminRouteAuthorizationCheck check =
                new AdminRouteAuthorizationCheck(
                        beans.getBeanProvider(RequestMappingHandlerMapping.class));
        assertThatCode(check::afterSingletonsInstantiated).doesNotThrowAnyException();
        mapping.registerMapping(
                RequestMappingInfo.paths("/admin-api/missing").build(),
                controller,
                Policies.class.getMethod("missing"));
        assertThatThrownBy(check::afterSingletonsInstantiated)
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("/admin-api/missing");
    }

    private AdminSession session(boolean superAdministrator, AdminPermission... permissions) {
        return new AdminSession(
                "admin-1",
                "tenant-1",
                "user-1",
                "employee-1",
                "E1",
                "测试管理员",
                superAdministrator,
                Set.of(permissions));
    }

    static class Policies {
        @RequireAdmin(
                permissions = {MANAGE_APIS, PUBLISH_APIS},
                match = RequireAdmin.Match.ANY)
        public void any() {}

        @RequireAdmin(
                permissions = {MANAGE_APIS, PUBLISH_APIS},
                match = RequireAdmin.Match.ALL)
        public void all() {}

        @RequireAdmin(permissions = MANAGE_APIS, superAdministrator = true)
        public void superAndBusiness() {}

        @RequireAdmin(sessionOnly = true)
        public void session() {}

        @RequireAdmin
        public void empty() {}

        @RequireAdmin(sessionOnly = true, permissions = MANAGE_APIS)
        public void ambiguous() {}

        public void missing() {}
    }

    @RequireAdmin(permissions = MANAGE_APIS)
    static class ClassPolicy {
        @RequireAdmin(permissions = PUBLISH_APIS)
        public void write() {}

        @RequireAdmin(sessionOnly = true)
        public void session() {}
    }

    @Retention(RetentionPolicy.RUNTIME)
    @Target(ElementType.TYPE)
    @RequireAdmin(permissions = MANAGE_APIS)
    @interface ApiMaintainer {}

    interface Endpoint {
        @RequireAdmin(permissions = PUBLISH_APIS)
        void write();
    }

    @ApiMaintainer
    static class ProxiedController implements Endpoint {
        @Override
        public void write() {}
    }
}
