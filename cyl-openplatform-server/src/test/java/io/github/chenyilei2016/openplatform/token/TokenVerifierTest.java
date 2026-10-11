package io.github.chenyilei2016.openplatform.token;

import io.github.chenyilei2016.openplatform.application.access.ApplicationAuthorizationService;
import io.github.chenyilei2016.openplatform.application.token.TokenVerifier;
import io.github.chenyilei2016.openplatform.domain.access.*;
import io.github.chenyilei2016.openplatform.domain.common.CredentialSecrets;
import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.github.chenyilei2016.openplatform.domain.token.*;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

/** 只验证公开校验入口：无人员RPC不重复读取；RPC期间撤销仍必须阻断。 */
class TokenVerifierTest {
    private static final Instant NOW = Instant.parse("2026-09-28T00:00:00Z");
    private static final String RAW = "a".repeat(43);
    private final TokenRepository tokens = mock(TokenRepository.class);
    private final ApplicationAuthorizationService authorizations = mock(ApplicationAuthorizationService.class);
    private final TokenVerifier verifier = new TokenVerifier(tokens, authorizations, Clock.fixed(NOW, ZoneOffset.UTC));

    @Test
    void applicationTokenReadsCurrentAuthorizationOnceWithoutEmployeeLookup() {
        ApplicationAuthorization authorization = authorization(false);
        StoredToken token = arrange(authorization);
        assertThat(verifier.verify(RAW).tokenId()).isEqualTo(token.id());
        verify(authorizations, times(1)).current(token.subject());
        verify(tokens, times(1)).find(token.id());
        verify(authorizations, never()).verifyEmployee(any());
    }

    @Test
    void personnelTokenRechecksCurrentFactsAfterEmployeeLookup() {
        ApplicationAuthorization authorization = authorization(true);
        StoredToken token = arrange(authorization);
        assertThat(verifier.verify(RAW).tokenId()).isEqualTo(token.id());
        var order = inOrder(authorizations);
        order.verify(authorizations).current(token.subject());
        order.verify(authorizations).verifyEmployee(authorization);
        order.verify(authorizations).current(token.subject());
        verify(tokens, times(2)).find(token.id());
    }

    @Test
    void revocationDuringEmployeeLookupInvalidatesThePersonnelToken() {
        ApplicationAuthorization authorization = authorization(true);
        StoredToken token = arrange(authorization);
        doAnswer(ignored -> {
            when(tokens.find(token.id())).thenReturn(Optional.of(new StoredToken(token.id(), token.subject(), token.versions(),
                    token.scopeCodes(), TokenStatus.REVOKED, token.issuedAt(), token.expiresAt())));
            return null;
        }).when(authorizations).verifyEmployee(authorization);
        assertInvalid();
        verify(authorizations, times(2)).current(token.subject());
    }

    @Test
    void applicationTokenDoesNotCacheAuthorizationAcrossCalls() {
        ApplicationAuthorization authorization = authorization(false);
        StoredToken token = arrange(authorization);
        verifier.verify(RAW);
        when(authorizations.current(token.subject())).thenThrow(new PlatformException(ErrorCode.FORBIDDEN, "授权已撤销"));
        assertInvalid();
    }

    private StoredToken arrange(ApplicationAuthorization authorization) {
        StoredToken token = new StoredToken("token", authorization.subject(), authorization.versions(), authorization.scopeCodes(),
                TokenStatus.ACTIVE, NOW.minusSeconds(60), NOW.plusSeconds(3600));
        when(tokens.findByDigest(CredentialSecrets.digest(RAW))).thenReturn(Optional.of(token));
        when(tokens.find(token.id())).thenReturn(Optional.of(token));
        when(authorizations.current(token.subject())).thenReturn(authorization);
        return token;
    }

    private ApplicationAuthorization authorization(boolean personnel) {
        ClientApplication application = new ClientApplication("app", "app-key", "测试应用", "tenant", ApplicationStatus.ENABLED, 1, List.of("orders.read"), ApplicationKind.STANDARD);
        TenantGrant tenant = new TenantGrant("grant", "app", "tenant", GrantStatus.ACTIVE, 1, "", 1);
        UserGrant user = personnel ? new UserGrant("user-grant", "grant", "tenant", "user", "employee", "E001", "测试人员", GrantStatus.ACTIVE, 1) : null;
        return new ApplicationAuthorization(application, tenant, user, application.scopeCodes());
    }

    private void assertInvalid() {
        assertThatThrownBy(() -> verifier.verify(RAW)).isInstanceOfSatisfying(PlatformException.class,
                failure -> assertThat(failure.getErrorCode()).isEqualTo(ErrorCode.INVALID_TOKEN));
    }
}
