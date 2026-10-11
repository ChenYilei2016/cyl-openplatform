package io.github.chenyilei2016.openplatform.web.admin.session;


import io.github.chenyilei2016.openplatform.application.access.EmployeeProfileService;
import io.github.chenyilei2016.openplatform.common.ApiResponse;
import io.github.chenyilei2016.openplatform.identity.AdminSession;
import io.github.chenyilei2016.openplatform.identity.RequireAdmin;
import io.github.chenyilei2016.openplatform.identity.VerifiedEmployeeSession;

import jakarta.servlet.http.HttpServletRequest;
import io.github.chenyilei2016.openplatform.identity.BrowserSession;

import lombok.RequiredArgsConstructor;

import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/** 后台会话：返回经平台登录和管理权限校验的当前人员。 */
@RestController
@RequiredArgsConstructor
public class AdminSessionController {
    private final EmployeeProfileService profiles;
    private final io.github.chenyilei2016.openplatform.identity.BrowserIdentityProvider identities;

    @RequireAdmin(sessionOnly = true)
    @GetMapping("/admin-api/session")
    public ResponseEntity<ApiResponse<AdminSession>> session(HttpServletRequest request) {
        AdminSession session = AdminSession.current(request);
        profiles.remember(
                VerifiedEmployeeSession.current(request),
                VerifiedEmployeeSession.tenantName(request));
        String csrfProof =
                identities.csrfToken(request);
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .header(BrowserSession.CSRF_HEADER, csrfProof)
                .body(ApiResponse.success(session));
    }
}
