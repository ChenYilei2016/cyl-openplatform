package io.github.chenyilei2016.openplatform.application.token;

import io.github.chenyilei2016.openplatform.domain.token.StoredToken;
import io.github.chenyilei2016.openplatform.domain.token.TokenStatus;
import java.time.Instant;
import java.util.List;

/** Token 非秘密元数据；tenantName 为展示名称（按页批量投影，取不到为空），不作为授权依据。 */
public record TokenSummary(String tokenId, String applicationId, String appKey, String tenantId, String tenantName, String userId,
                           String employeeId, String employeeNo, List<String> scopeCodes, Instant expiresAt, TokenStatus status) {
    public static TokenSummary from(StoredToken token, TokenStatus status, String tenantName) {
        var subject = token.subject();
        return new TokenSummary(token.id(), subject.applicationId(), subject.appKey(), subject.tenantId(), tenantName, subject.userId(),
                subject.employeeId(), subject.employeeNo(), token.scopeCodes(), token.expiresAt(), status);
    }
}
