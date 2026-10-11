package io.github.chenyilei2016.openplatform.application.catalog;

import io.github.chenyilei2016.openplatform.application.access.EmployeeProfileService;
import io.github.chenyilei2016.openplatform.application.access.EmployeeProfileService.EmployeeProfileOption;
import io.github.chenyilei2016.openplatform.domain.access.*;
import io.github.chenyilei2016.openplatform.domain.common.*;

import lombok.RequiredArgsConstructor;

import org.springframework.stereotype.Service;

import java.util.List;

/** 负责人是展示及维护关系，不授予管理或调用权限。选择后保存现有人员档案的稳定ID。 */
@Service
@RequiredArgsConstructor
public class ApiOwnerService {
    private final EmployeeProfileRepository profiles;
    private final EmployeeProfileService registration;
    private final EmployeeDirectory directory;

    public EmployeeProfileOption find(String id) {
        EmployeeProfile profile = profiles.findByIds(List.of(id)).get(id);
        if (profile == null) throw new PlatformException(ErrorCode.NOT_FOUND, "尚未关联人员档案，请重新选择负责人");
        return EmployeeProfileOption.from(profile);
    }

    public EmployeeProfileOption current(EmployeeIdentity identity, String tenantName) {
        if (profiles.find(identity.tenantId(), identity.employeeId()).isEmpty())
            registration.remember(identity, tenantName);
        return registered(identity.tenantId(), identity.employeeId());
    }

    private EmployeeProfileOption registered(String tenantId, String employeeId) {
        return profiles.find(tenantId, employeeId)
                .map(EmployeeProfileOption::from)
                .orElseThrow(
                        () ->
                                new PlatformException(
                                        ErrorCode.DEPENDENCY_UNAVAILABLE, "当前人员档案暂不可用，请重新核验人员"));
    }

    public EmployeeProfileOption verify(
            String tenantId, String employeeNo, String expectedEmployeeId) {
        EmployeeIdentity identity = directory.find(tenantId, employeeNo);
        if (identity == null)
            throw new PlatformException(ErrorCode.INVALID_REQUEST, "未找到该工号对应的有效员工");
        identity.requireGrantable(tenantId, employeeNo);
        if (expectedEmployeeId != null && !expectedEmployeeId.equals(identity.employeeId()))
            throw new PlatformException(ErrorCode.CONFLICT, "该工号对应的人员已变化，请重新选择");
        registration.remember(identity, null);
        EmployeeProfileOption result = registered(tenantId, identity.employeeId());
        if (!result.employeeId().equals(identity.employeeId()))
            throw new PlatformException(ErrorCode.DEPENDENCY_UNAVAILABLE, "人员资料尚未更新，请重试核验");
        return result;
    }
}
