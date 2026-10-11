package io.github.chenyilei2016.openplatform.application.token;

import io.github.chenyilei2016.openplatform.domain.token.TokenContext;
import java.time.Instant;

public record TokenResponse(String accessToken, String tokenType, Instant expiresAt, long expiresIn, TokenContext context) {
    @Override public String toString() { return "TokenResponse[tokenId=" + context.tokenId() + "]"; }
}
