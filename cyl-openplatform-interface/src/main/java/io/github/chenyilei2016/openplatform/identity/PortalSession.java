package io.github.chenyilei2016.openplatform.identity;

import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;

import jakarta.servlet.http.HttpServletRequest;

/** 由平台登录及本租户自助资格共同验证的请求身份，不包含平台全局管理权限。 */
public record PortalSession(
        String tenantId, String userId, String employeeId, String employeeNo, String displayName) {
    static final String REQUEST_ATTRIBUTE = PortalSession.class.getName();

    public static PortalSession current(HttpServletRequest request) {
        if (request.getAttribute(REQUEST_ATTRIBUTE) instanceof PortalSession session)
            return session;
        throw new PlatformException(ErrorCode.UNAUTHENTICATED, "请先登录客户门户");
    }
}
