package io.github.chenyilei2016.openplatform.domain.operations;

import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.github.chenyilei2016.openplatform.domain.observability.CallMode;
import io.github.chenyilei2016.openplatform.domain.observability.CallIdentityKind;
import java.time.Duration;
import java.time.Instant;
import java.util.stream.Stream;

public record OperationsQuery(Instant from, Instant to, CallMode mode, StatisticsBucket bucket,
                              String apiId, String applicationId, String tenantId, String employeeId,
                              CallIdentityKind identityKind, String ruleId, Long ruleVersion,
                              StatisticsDimension dimension, StatisticsSort sort, int top) {
    public OperationsQuery(Instant from, Instant to, CallMode mode, StatisticsBucket bucket, String apiId, String applicationId) {
        this(from, to, mode, bucket, apiId, applicationId, null, null, null, null, null, null, null, 10);
    }

    public OperationsQuery {
        if (mode == null) mode = CallMode.PRODUCTION;
        if (bucket == null) bucket = StatisticsBucket.FIVE_MINUTES;
        if (dimension == null) dimension = StatisticsDimension.TENANT;
        if (sort == null) sort = StatisticsSort.REQUESTS;
        if (Stream.of(tenantId, employeeId).anyMatch(id -> id != null && (id.isBlank() || id.length() > 64 || id.chars().anyMatch(Character::isISOControl)))
                || employeeId != null && tenantId == null || ruleId != null && !ruleId.matches("[A-Za-z0-9:_-]{1,240}")
                || ruleVersion != null && (ruleId == null || ruleVersion < 0 || ruleVersion > 9_007_199_254_740_991L)
                || top != 10 && top != 20 && top != 50)
            throw new PlatformException(ErrorCode.INVALID_REQUEST, "统计人员须在租户范围定位，规则版本和Top10/20/50须有效");
        if (from == null || to == null || !from.isBefore(to) || from.getNano() != 0 || to.getNano() != 0
                || from.getEpochSecond() % 60 != 0 || to.getEpochSecond() % 60 != 0
                || Duration.between(from, to).compareTo(Duration.ofDays(31)) > 0
                || bucket.index(to.minusNanos(1)) - bucket.index(from) + 1 > 1440
                || Stream.of(apiId, applicationId).anyMatch(id -> id != null
                    && (id.isBlank() || id.length() > 36 || id.chars().anyMatch(Character::isISOControl)))) {
            throw new PlatformException(ErrorCode.INVALID_REQUEST, "统计时间须分钟对齐且在31天及1440桶内，ID最多36字符");
        }
    }
}
