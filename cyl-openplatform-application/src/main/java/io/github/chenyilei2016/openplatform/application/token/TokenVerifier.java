package io.github.chenyilei2016.openplatform.application.token;

import io.github.chenyilei2016.openplatform.application.access.ApplicationAuthorizationService;
import io.github.chenyilei2016.openplatform.domain.access.ApplicationAuthorization;
import io.github.chenyilei2016.openplatform.domain.common.CredentialSecrets;
import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.github.chenyilei2016.openplatform.domain.token.StoredToken;
import io.github.chenyilei2016.openplatform.domain.token.TokenContext;
import io.github.chenyilei2016.openplatform.domain.token.TokenRepository;
import io.github.chenyilei2016.openplatform.domain.token.TokenStatus;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import java.time.Clock;

/** 网关与公开校验端点使用同一入口，无缓存，每次读取数据库及必要的平台人员身份。 */
@Service
@RequiredArgsConstructor
public class TokenVerifier {
    private final TokenRepository tokens;
    private final ApplicationAuthorizationService authorizations;
    private final Clock tokenClock;

    public TokenContext verify(String rawToken) {
        try {
            return TokenContext.from(verifyToken(rawToken));
        } catch (RuntimeException failure) {
            throw TokenDependencyFailures.translate(failure);
        }
    }

    StoredToken verifyToken(String rawToken) {
        if (rawToken == null || !rawToken.matches("[A-Za-z0-9_-]{43}")) throw invalidToken();
        StoredToken token = tokens.findByDigest(CredentialSecrets.digest(rawToken)).orElseThrow(this::invalidToken);
        ApplicationAuthorization authorization = verifyCurrent(token);
        // 应用Token没有人员RPC；已核验当前事实，无需紧接着重复整组查询。
        // 人员Token仍在RPC前后复核，阻断身份查询期间发生的撤销或授权变化。
        if (authorization.user() == null) return token;
        try {
            // 不在数据库事务或写锁内发起RPC。
            authorizations.verifyEmployee(authorization);
        } catch (PlatformException exception) {
            if (exception.getErrorCode() == ErrorCode.FORBIDDEN) throw invalidToken();
            throw exception;
        }
        verifyCurrent(token);
        return token;
    }

    ApplicationAuthorization verifyCurrent(StoredToken token) {
        StoredToken current = tokens.find(token.id()).orElseThrow(this::invalidToken);
        ApplicationAuthorization authorization;
        try {
            authorization = authorizations.current(token.subject());
        } catch (PlatformException exception) {
            if (exception.getErrorCode() == ErrorCode.FORBIDDEN) throw invalidToken();
            throw exception;
        }
        if (!current.equals(token) || token.effectiveStatus(tokenClock.instant(), authorization.matches(token.subject(), token.versions(), token.scopeCodes())) != TokenStatus.ACTIVE) {
            throw invalidToken();
        }
        return authorization;
    }

    private PlatformException invalidToken() { return new PlatformException(ErrorCode.INVALID_TOKEN, "Token无效或已失效"); }
}
