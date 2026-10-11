package io.github.chenyilei2016.openplatform.domain.token;

import java.util.Set;

/** 非秘密排障条件；类型按签发时的授权主体区分。 */
public record TokenFilter(String tokenId, String tenantId, String employeeNo,
                          Set<SubjectType> subjectTypes, Set<TokenStatus> statuses) {
    public enum SubjectType { APPLICATION, USER }
    public TokenFilter {
        subjectTypes = subjectTypes == null ? Set.of() : Set.copyOf(subjectTypes);
        statuses = statuses == null ? Set.of() : Set.copyOf(statuses);
    }
}
