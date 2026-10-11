package io.github.chenyilei2016.openplatform.web.admin.token;

import io.github.chenyilei2016.openplatform.application.token.TokenLifecycleService;
import io.github.chenyilei2016.openplatform.application.token.TokenQueryService;
import io.github.chenyilei2016.openplatform.application.token.TokenSummary;
import io.github.chenyilei2016.openplatform.common.ApiResponse;
import io.github.chenyilei2016.openplatform.domain.access.AccessOperator;
import io.github.chenyilei2016.openplatform.domain.access.AccessPageQuery;
import io.github.chenyilei2016.openplatform.domain.common.PageResult;
import io.github.chenyilei2016.openplatform.domain.administration.AdminPermission;
import io.github.chenyilei2016.openplatform.identity.AdminSession;
import io.github.chenyilei2016.openplatform.identity.RequireAdmin;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.constraints.Size;
import jakarta.validation.constraints.Pattern;
import java.util.Set;
import io.github.chenyilei2016.openplatform.domain.token.TokenFilter;
import io.github.chenyilei2016.openplatform.domain.token.TokenStatus;
import lombok.RequiredArgsConstructor;
import org.slf4j.MDC;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Token后台仅展示非秘密元数据，并允许已验证的平台运维撤销记录。 */
@RequireAdmin(permissions = AdminPermission.MANAGE_APPLICATIONS)
@RestController
@RequestMapping("/admin-api")
@RequiredArgsConstructor
public class AdminTokenController {
    private final TokenQueryService query;
    private final TokenLifecycleService lifecycle;

    @GetMapping("/applications/{id}/tokens")
    public ApiResponse<PageResult<TokenSummary>> page(@PathVariable @Size(max = 36) String id,
            @RequestParam(defaultValue = "1") int page, @RequestParam(defaultValue = "20") int pageSize,
            @RequestParam(required = false) @Size(min = 1, max = 36) @Pattern(regexp = "\\S+") String tokenId,
            @RequestParam(required = false) @Size(min = 1, max = 64) @Pattern(regexp = "\\S+") String tenantId,
            @RequestParam(required = false) @Size(min = 1, max = 64) @Pattern(regexp = "\\S+") String employeeNo,
            @RequestParam(required = false) Set<TokenFilter.SubjectType> subjectType,
            @RequestParam(required = false) Set<TokenStatus> status,
            HttpServletRequest request, HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store");
        return ApiResponse.success(query.page(id, new AccessPageQuery(page, pageSize, null),
                new TokenFilter(tokenId, tenantId, employeeNo, subjectType, status)));
    }

    @DeleteMapping("/tokens/{id}")
    public ApiResponse<Void> revoke(@PathVariable @Size(max = 36) String id, HttpServletRequest request, HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store");
        AdminSession session = AdminSession.current(request);
        lifecycle.revokeByAdmin(id, new AccessOperator(session.tenantId(), session.employeeNo(), MDC.get("requestId"), session.userId(), session.employeeId()));
        return ApiResponse.success(null);
    }
}
