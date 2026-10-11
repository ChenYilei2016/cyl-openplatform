package io.github.chenyilei2016.openplatform.domain.token;

import io.github.chenyilei2016.openplatform.domain.access.AuthorizationSubject;
import io.github.chenyilei2016.openplatform.domain.runtime.InvocationContext;
import java.time.Instant;
import java.util.List;

/** Token公开校验响应，保留固定身份和有效期；业务执行仅使用转换后的可信调用上下文。 */
public record TokenContext(String tokenId, String applicationId, String appKey, String tenantId,
                           String userId, String employeeId, String employeeNo, List<String> scopeCodes, Instant expiresAt) {
    public TokenContext { scopeCodes = List.copyOf(scopeCodes); }
    public InvocationContext invocationContext() {
        return new InvocationContext(applicationId, appKey, tenantId, userId, employeeId, employeeNo, scopeCodes);
    }
    public static TokenContext from(StoredToken token) {
        AuthorizationSubject subject = token.subject();
        return new TokenContext(token.id(), subject.applicationId(), subject.appKey(), subject.tenantId(),
                subject.userId(), subject.employeeId(), subject.employeeNo(), token.scopeCodes(), token.expiresAt());
    }
}
