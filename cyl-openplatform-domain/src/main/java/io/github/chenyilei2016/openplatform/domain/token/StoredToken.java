package io.github.chenyilei2016.openplatform.domain.token;

import io.github.chenyilei2016.openplatform.domain.access.AuthorizationSubject;
import io.github.chenyilei2016.openplatform.domain.access.AuthorizationVersions;
import java.time.Instant;
import java.util.List;

/** 不持有原始Token或摘要，摘要只用于仓储写入和查找。 */
public record StoredToken(String id, AuthorizationSubject subject, AuthorizationVersions versions, List<String> scopeCodes,
                          TokenStatus status, Instant issuedAt, Instant expiresAt) {
    public StoredToken { scopeCodes = List.copyOf(scopeCodes); }
    public TokenStatus effectiveStatus(Instant now, boolean authorizationValid) {
        return status.effective(!now.isBefore(expiresAt), authorizationValid);
    }
}
