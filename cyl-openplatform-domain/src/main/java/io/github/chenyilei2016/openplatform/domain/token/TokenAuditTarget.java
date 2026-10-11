package io.github.chenyilei2016.openplatform.domain.token;

public record TokenAuditTarget(String tokenId, String applicationId, String appKey, String tenantId, String userId) {
    public static TokenAuditTarget from(StoredToken token) {
        return new TokenAuditTarget(token.id(), token.subject().applicationId(), token.subject().appKey(),
                token.subject().tenantId(), token.subject().userId());
    }
}
