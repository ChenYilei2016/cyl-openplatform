package io.github.chenyilei2016.openplatform.identity;

import io.github.chenyilei2016.openplatform.application.identity.AccountAuthentication;
import io.github.chenyilei2016.openplatform.application.administration.AdministratorLoginService;
import io.github.chenyilei2016.openplatform.application.administration.AdministratorTenantPolicy;
import io.github.chenyilei2016.openplatform.domain.access.EmployeeIdentity;
import io.github.chenyilei2016.openplatform.domain.administration.Administrator;
import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.HandlerInterceptor;

/** 认证SPI与数据库授权在请求边界组合，不依赖外部登录SDK。 */
@Component
@RequiredArgsConstructor
public class PlatformLoginInterceptor implements HandlerInterceptor {
    private final BrowserIdentityProvider identities;
    private final AdministratorLoginService adminAccess;
    private final AdministratorTenantPolicy adminTenants;

    @Override public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        response.setHeader("Cache-Control", "no-store");
        AccountAuthentication.Account account = identities.current(request);
        if (account == null) throw new PlatformException(ErrorCode.UNAUTHENTICATED, "请使用平台账号登录");
        EmployeeIdentity employee = account.employee();
        if (employee == null || employee.userId() == null || employee.tenantId() == null || employee.employeeNo() == null)
            throw new PlatformException(ErrorCode.UNAUTHENTICATED, "登录身份信息不完整");
        employee.requireGrantable(employee.tenantId(), employee.employeeNo());
        if (!Set.of("GET", "HEAD", "OPTIONS").contains(request.getMethod())) identities.verifyMutation(request);
        request.setAttribute(VerifiedEmployeeSession.REQUEST_ATTRIBUTE, employee);
        request.setAttribute(VerifiedEmployeeSession.TENANT_NAME_ATTRIBUTE, account.tenantName());
        String path = request.getRequestURI().substring(request.getContextPath().length());
        if (path.startsWith("/portal-api/")) {
            request.setAttribute(PortalSession.REQUEST_ATTRIBUTE, new PortalSession(employee.tenantId(), employee.userId(),
                    employee.employeeId(), employee.employeeNo(), employee.displayName()));
        } else {
            if (!adminTenants.allows(employee.tenantId()))
                throw new PlatformException(ErrorCode.FORBIDDEN, "当前租户不允许进入管理后台");
            AdministratorLoginService.AuthenticatedAdministrator authenticated =
                    adminAccess.authenticate(
                            employee.tenantId(),
                            employee.userId(),
                            employee.employeeNo(),
                            employee);
            Administrator administrator = authenticated.administrator();
            request.setAttribute(
                    VerifiedEmployeeSession.REQUEST_ATTRIBUTE, authenticated.employee());
            AdminSession session =
                    new AdminSession(
                            administrator.id(),
                            administrator.tenantId(),
                            administrator.userId(),
                            administrator.employeeId(),
                            administrator.employeeNo(),
                            administrator.displayName(),
                            administrator.superAdministrator(),
                            administrator.permissions());
            request.setAttribute(AdminSession.REQUEST_ATTRIBUTE, session);
            if (!(handler instanceof HandlerMethod method))
                throw new PlatformException(ErrorCode.FORBIDDEN, "后台入口未声明访问策略");
            AdminAuthorization.authorize(method, session);
        }
        return true;
    }
}
