package io.github.chenyilei2016.openplatform.identity;

import io.github.chenyilei2016.openplatform.domain.administration.AdminPermission;
import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;

import org.springframework.aop.support.AopUtils;
import org.springframework.core.annotation.AnnotatedElementUtils;
import org.springframework.util.ClassUtils;
import org.springframework.web.method.HandlerMethod;

import java.lang.reflect.Method;
import java.util.Arrays;
import java.util.stream.Collectors;

/** 认证和CSRF校验之后执行；未声明或声明不合法的管理路由默认拒绝。 */
public final class AdminAuthorization {
    private AdminAuthorization() {}

    public static void authorize(HandlerMethod handler, AdminSession session) {
        Class<?> controller = controllerType(handler);
        Method method = AopUtils.getMostSpecificMethod(handler.getMethod(), controller);
        RequireAdmin classPolicy =
                AnnotatedElementUtils.findMergedAnnotation(controller, RequireAdmin.class);
        RequireAdmin methodPolicy =
                AnnotatedElementUtils.findMergedAnnotation(method, RequireAdmin.class);
        if (classPolicy == null && methodPolicy == null) {
            throw new PlatformException(ErrorCode.FORBIDDEN, "管理接口尚未声明授权策略，请联系总管理员");
        }
        if (classPolicy != null) require(classPolicy, session);
        if (methodPolicy != null) require(methodPolicy, session);
    }

    public static boolean hasDeclaration(HandlerMethod handler) {
        Class<?> controller = controllerType(handler);
        Method method = AopUtils.getMostSpecificMethod(handler.getMethod(), controller);
        RequireAdmin classPolicy =
                AnnotatedElementUtils.findMergedAnnotation(controller, RequireAdmin.class);
        RequireAdmin methodPolicy =
                AnnotatedElementUtils.findMergedAnnotation(method, RequireAdmin.class);
        return (classPolicy != null || methodPolicy != null)
                && (classPolicy == null || valid(classPolicy))
                && (methodPolicy == null || valid(methodPolicy));
    }

    private static Class<?> controllerType(HandlerMethod handler) {
        return ClassUtils.getUserClass(
                handler.getBean() instanceof String
                        ? handler.getBeanType()
                        : AopUtils.getTargetClass(handler.getBean()));
    }

    private static boolean valid(RequireAdmin policy) {
        return policy.sessionOnly()
                ? policy.permissions().length == 0 && !policy.superAdministrator()
                : policy.permissions().length > 0 || policy.superAdministrator();
    }

    private static void require(RequireAdmin policy, AdminSession session) {
        if (!valid(policy)) {
            throw new PlatformException(ErrorCode.FORBIDDEN, "管理接口授权策略不完整，请联系总管理员");
        }
        if (policy.superAdministrator() && !session.superAdministrator()) {
            throw new PlatformException(ErrorCode.FORBIDDEN, "此操作需要总管理员身份，请联系总管理员");
        }
        if (policy.permissions().length == 0) return;
        boolean allowed =
                policy.match() == RequireAdmin.Match.ANY
                        ? Arrays.stream(policy.permissions())
                                .anyMatch(session.permissions()::contains)
                        : Arrays.stream(policy.permissions())
                                .allMatch(session.permissions()::contains);
        if (!allowed) {
            String permissions =
                    Arrays.stream(policy.permissions())
                            .map(AdminPermission::displayName)
                            .collect(Collectors.joining("、"));
            String matching = policy.match() == RequireAdmin.Match.ANY ? "任一" : "全部";
            throw new PlatformException(
                    ErrorCode.FORBIDDEN, "此操作需要" + matching + "权限：" + permissions + "，请联系总管理员");
        }
    }
}
