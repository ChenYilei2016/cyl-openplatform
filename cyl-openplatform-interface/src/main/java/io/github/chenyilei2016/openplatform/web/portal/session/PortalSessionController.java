package io.github.chenyilei2016.openplatform.web.portal.session;


import io.github.chenyilei2016.openplatform.application.access.EmployeeProfileService;
import io.github.chenyilei2016.openplatform.common.ApiResponse;
import io.github.chenyilei2016.openplatform.identity.PortalSession;
import io.github.chenyilei2016.openplatform.identity.VerifiedEmployeeSession;

import jakarta.servlet.http.HttpServletRequest;
import io.github.chenyilei2016.openplatform.identity.BrowserSession;

import lombok.RequiredArgsConstructor;

import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/** 门户会话：返回经平台登录和本租户自助接入资格校验的当前人员。 */
@RestController
@RequiredArgsConstructor
public class PortalSessionController {
    private final EmployeeProfileService profiles;
    private final io.github.chenyilei2016.openplatform.identity.BrowserIdentityProvider identities;

    /** 会话展示投影：租户名称来自本次已核验的平台登录，仅供展示，不参与任何授权判断。 */
    public record PortalSessionView(
            String tenantId,
            String tenantName,
            String userId,
            String employeeId,
            String employeeNo,
            String displayName) {}

    @GetMapping("/portal-api/session")
    public ResponseEntity<ApiResponse<PortalSessionView>> portalSession(HttpServletRequest request) {
        PortalSession session = PortalSession.current(request);
        String tenantName = VerifiedEmployeeSession.tenantName(request);
        profiles.remember(VerifiedEmployeeSession.current(request), tenantName);
        String csrfProof =
                identities.csrfToken(request);
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .header(BrowserSession.CSRF_HEADER, csrfProof)
                .body(ApiResponse.success(new PortalSessionView(
                        session.tenantId(),
                        tenantName,
                        session.userId(),
                        session.employeeId(),
                        session.employeeNo(),
                        session.displayName())));
    }
}
