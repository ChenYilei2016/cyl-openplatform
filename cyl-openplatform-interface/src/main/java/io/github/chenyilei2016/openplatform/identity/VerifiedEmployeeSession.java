package io.github.chenyilei2016.openplatform.identity;

import io.github.chenyilei2016.openplatform.domain.access.EmployeeIdentity;
import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;

import jakarta.servlet.http.HttpServletRequest;

/** 复用本请求已核验的平台人员事实；不从请求参数或登录缓存推测人员ID。 */
public final class VerifiedEmployeeSession {
    public static final String REQUEST_ATTRIBUTE = VerifiedEmployeeSession.class.getName();
    public static final String TENANT_NAME_ATTRIBUTE = REQUEST_ATTRIBUTE + ".tenantName";

    private VerifiedEmployeeSession() {}

    public static String tenantName(HttpServletRequest request) {
        return request.getAttribute(TENANT_NAME_ATTRIBUTE) instanceof String name ? name : null;
    }

    public static EmployeeIdentity current(HttpServletRequest request) {
        if (request.getAttribute(REQUEST_ATTRIBUTE) instanceof EmployeeIdentity employee)
            return employee;
        throw new PlatformException(ErrorCode.UNAUTHENTICATED, "缺少已核验的人员身份，请重新登录");
    }
}
