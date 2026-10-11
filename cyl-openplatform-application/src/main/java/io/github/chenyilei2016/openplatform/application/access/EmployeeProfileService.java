package io.github.chenyilei2016.openplatform.application.access;

import io.github.chenyilei2016.openplatform.domain.access.*;
import io.github.chenyilei2016.openplatform.domain.common.PageResult;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.Instant;

/** 展示登记失败不改变已通过的认证或授权；不创建后台同步队列。 */
@Service
@RequiredArgsConstructor
@Slf4j
public class EmployeeProfileService {
    private static final Duration REFRESH_INTERVAL = Duration.ofMinutes(15);
    private final EmployeeProfileRepository profiles;

    public void remember(EmployeeIdentity identity, String verifiedTenantName) {
        try {
            identity.requireGrantable(identity.tenantId(), identity.employeeNo());
            String tenantName =
                    verifiedTenantName == null
                                    || verifiedTenantName.isBlank()
                                    || verifiedTenantName.length() > 100
                            ? profiles.tenantName(identity.tenantId())
                            : verifiedTenantName.strip();
            Instant now = Instant.now();
            profiles.remember(
                    new EmployeeProfile(null,
                            identity.tenantId(),
                            tenantName,
                            identity.employeeId(),
                            identity.userId(),
                            identity.employeeNo(),
                            identity.displayName(),
                            now),
                    now.minus(REFRESH_INTERVAL));
        } catch (RuntimeException failure) {
            // 不输出个人资料、SQL参数、Token或原异常消息。
            log.warn(
                    "Employee display profile registration failed: {}",
                    failure.getClass().getSimpleName());
        }
    }

    public PageResult<EmployeeProfileOption> page(EmployeeProfileQuery query) {
        PageResult<EmployeeProfile> page = profiles.page(query);
        return new PageResult<>(
                page.items().stream().map(EmployeeProfileOption::from).toList(),
                page.total(),
                page.page(),
                page.pageSize());
    }

    public record EmployeeProfileOption(
            String id,
            String tenantId,
            String tenantName,
            String employeeId,
            String employeeNo,
            String displayName,
            Instant lastSeenAt) {
        public static EmployeeProfileOption from(EmployeeProfile profile) {
            return new EmployeeProfileOption(
                    profile.id(),
                    profile.tenantId(),
                    profile.tenantName(),
                    profile.employeeId(),
                    profile.employeeNo(),
                    profile.displayName(),
                    profile.lastSeenAt());
        }
    }
}
