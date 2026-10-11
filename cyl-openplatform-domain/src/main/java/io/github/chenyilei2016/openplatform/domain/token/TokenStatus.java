package io.github.chenyilei2016.openplatform.domain.token;

public enum TokenStatus {
    ACTIVE, REVOKED, EXPIRED, INVALIDATED;

    public TokenStatus effective(boolean expired, boolean authorizationValid) {
        if (this == REVOKED) return REVOKED;
        if (expired) return EXPIRED;
        return authorizationValid ? ACTIVE : INVALIDATED;
    }
}
