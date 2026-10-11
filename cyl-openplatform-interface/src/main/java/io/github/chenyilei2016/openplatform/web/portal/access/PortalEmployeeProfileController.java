package io.github.chenyilei2016.openplatform.web.portal.access;

import io.github.chenyilei2016.openplatform.application.access.EmployeeProfileService;
import io.github.chenyilei2016.openplatform.application.access.EmployeeProfileService.EmployeeProfileOption;
import io.github.chenyilei2016.openplatform.common.ApiResponse;
import io.github.chenyilei2016.openplatform.domain.access.EmployeeProfileQuery;
import io.github.chenyilei2016.openplatform.domain.common.PageResult;
import io.github.chenyilei2016.openplatform.identity.PortalSession;

import jakarta.servlet.http.HttpServletRequest;

import lombok.RequiredArgsConstructor;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 门户仅展示当前可信租户的已登记人员，不接受客户端租户范围。 */
@RestController
@RequiredArgsConstructor
public class PortalEmployeeProfileController {
    private final EmployeeProfileService profiles;

    @GetMapping("/portal-api/employee-profiles")
    public ApiResponse<PageResult<EmployeeProfileOption>> page(
            HttpServletRequest request,
            @RequestParam(required = false) String employeeNo,
            @RequestParam(required = false) String name,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int pageSize) {
        return ApiResponse.success(
                profiles.page(
                        new EmployeeProfileQuery(
                                PortalSession.current(request).tenantId(),
                                employeeNo,
                                name,
                                page,
                                pageSize)));
    }
}
