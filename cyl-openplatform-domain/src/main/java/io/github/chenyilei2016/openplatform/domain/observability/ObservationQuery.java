package io.github.chenyilei2016.openplatform.domain.observability;

import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.github.chenyilei2016.openplatform.domain.governance.GovernanceDecision;
import java.time.Duration;
import java.time.Instant;
import java.util.stream.Stream;
import java.util.Set;
import lombok.Builder;

/** 两类记录共享严格的元数据过滤与数据库分页边界。 */
@Builder
public record ObservationQuery(int page, int pageSize, Instant from, Instant to,
                               String requestId, String apiId, String applicationId, String tenantId,
                               Set<String> outcomes, Set<CallMode> modes, Set<AuditSource> sources,
                               String id, String employeeNo, String operatorEmployeeNo,
                               String targetId, String operatorTenantId, String employeeId, CallIdentityKind identityKind,
                               String ruleId, Long ruleVersion, GovernanceOutcome governanceOutcome, GovernanceDecision.Reason denialReason,
                               Long durationMin, Long durationMax, CallChannel channel, String toolName) {
    /** 耗时区间上限：一天的毫秒数，超出没有排障意义。 */
    private static final long MAX_DURATION_MILLIS = 86_400_000L;
    public enum GovernanceOutcome { REJECTED, OBSERVED }
    public ObservationQuery {
        outcomes = outcomes == null ? Set.of() : Set.copyOf(outcomes);
        modes = modes == null ? Set.of() : Set.copyOf(modes);
        sources = sources == null ? Set.of() : Set.copyOf(sources);
        if (to == null) to = Instant.now();
        if (from == null) from = to.minus(Duration.ofDays(1));
        if (page < 1 || pageSize < 1 || pageSize > 100 || (long) (page - 1) * pageSize > 100_000
                || !from.isBefore(to) || Duration.between(from, to).compareTo(Duration.ofDays(31)) > 0
                || employeeId != null && tenantId == null || ruleId != null && !ruleId.matches("[A-Za-z0-9:_-]{1,240}")
                || ruleVersion != null && (ruleId == null || ruleVersion < 0 || ruleVersion > 9_007_199_254_740_991L)
                || Stream.of(requestId, apiId, applicationId, tenantId, employeeNo, employeeId, operatorEmployeeNo, targetId, operatorTenantId).anyMatch(value -> value != null
                    && (value.isBlank() || value.length() > 64 || value.chars().anyMatch(Character::isISOControl)))
                || (id != null && (id.isBlank() || id.length() > 36 || id.chars().anyMatch(Character::isISOControl)))
                || durationMin != null && (durationMin < 0 || durationMin > MAX_DURATION_MILLIS)
                || durationMax != null && (durationMax < 0 || durationMax > MAX_DURATION_MILLIS)
                || durationMin != null && durationMax != null && durationMin > durationMax
                || !Set.of("SUCCESS", "FAILURE").containsAll(outcomes)) {
            throw new PlatformException(ErrorCode.INVALID_REQUEST, "检索需有效时间范围（最多31天），每页最多100条且偏移不超过100000");
        }
        if (toolName != null && !toolName.matches("[a-zA-Z0-9_]{1,64}"))
            throw new PlatformException(ErrorCode.INVALID_REQUEST, "工具名不合法");
    }
    public long offset() { return (long) (page - 1) * pageSize; }
}
