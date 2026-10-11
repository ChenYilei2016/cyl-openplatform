package io.github.chenyilei2016.openplatform.identity;

import io.github.chenyilei2016.openplatform.domain.administration.AdminPermission;
import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;

import jakarta.servlet.http.HttpServletRequest;

import java.util.Set;

/** 本请求经本地账号身份核验及数据库授权的管理会话，不保存到浏览器作为权限事实。 */
public record AdminSession(
        String administratorId,
        String tenantId,
        String userId,
        String employeeId,
        String employeeNo,
        String displayName,
        boolean superAdministrator,
        Set<AdminPermission> permissions) {
    static final String REQUEST_ATTRIBUTE = AdminSession.class.getName();

    public AdminSession {
        permissions = Set.copyOf(permissions);
    }

    public void requirePermission(AdminPermission permission) {
        if (!permissions.contains(permission)) {
            throw new PlatformException(
                    ErrorCode.FORBIDDEN, "需要「" + permission.displayName() + "」权限，请联系总管理员");
        }
    }

    public static AdminSession current(HttpServletRequest request) {
        if (request.getAttribute(REQUEST_ATTRIBUTE) instanceof AdminSession session) return session;
        throw new PlatformException(ErrorCode.UNAUTHENTICATED, "请先登录管理后台");
    }
}
