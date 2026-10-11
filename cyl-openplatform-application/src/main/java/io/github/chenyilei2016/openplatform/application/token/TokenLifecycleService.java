package io.github.chenyilei2016.openplatform.application.token;

import io.github.chenyilei2016.openplatform.domain.common.ObjectIdType;
import io.github.chenyilei2016.openplatform.application.access.ApplicationAuthorizationService;
import io.github.chenyilei2016.openplatform.domain.access.AccessOperator;
import io.github.chenyilei2016.openplatform.domain.access.ApplicationRepository;
import io.github.chenyilei2016.openplatform.domain.common.CredentialSecrets;
import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.github.chenyilei2016.openplatform.domain.token.StoredToken;
import io.github.chenyilei2016.openplatform.domain.token.TokenAction;
import io.github.chenyilei2016.openplatform.domain.token.TokenAuditActor;
import io.github.chenyilei2016.openplatform.domain.token.TokenAuditTarget;
import io.github.chenyilei2016.openplatform.domain.token.TokenContext;
import io.github.chenyilei2016.openplatform.domain.token.TokenRepository;
import io.github.chenyilei2016.openplatform.domain.token.TokenStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import java.time.Clock;
import java.time.Duration;
import java.time.temporal.ChronoUnit;
import java.util.Objects;

/** 签发、刷新及撤销的事务边界；身份RPC在事务外，事务内只重核事实和写入。 */
@Service
public class TokenLifecycleService {
    private final ApplicationRepository applications;
    private final TokenRepository tokens;
    private final ApplicationAuthorizationService authorizations;
    private final TokenVerifier verifier;
    private final TokenAuditService audit;
    private final Clock clock;
    private final TokenSettings settings;
    private final TransactionTemplate changes;

    public TokenLifecycleService(ApplicationRepository applications, TokenRepository tokens, ApplicationAuthorizationService authorizations,
                                 TokenVerifier verifier, TokenAuditService audit, Clock tokenClock,
                                 PlatformTransactionManager transactionManager, TokenSettings settings) {
        this.applications = applications;
        this.tokens = tokens;
        this.authorizations = authorizations;
        this.verifier = verifier;
        this.audit = audit;
        this.clock = tokenClock;
        this.settings = settings;
        this.changes = new TransactionTemplate(transactionManager);
    }

    public TokenResponse issue(TokenIssueCommand command, String requestId) {
        if (command.existingToken() != null && !command.existingToken().isEmpty()) {
            try {
                var app = authorizations.authenticate(command.appKey(), command.appSecret());
                StoredToken existing = verifier.verifyToken(command.existingToken());
                if (!existing.subject().applicationId().equals(app.id()) || !existing.subject().tenantId().equals(command.tenantId())
                        || !Objects.equals(existing.subject().employeeNo(), command.employeeNo())
                        || existing.versions().application() != app.authorizationVersion()) {
                    throw new PlatformException(ErrorCode.INVALID_TOKEN, "Token与请求的固定授权主体不一致");
                }
                return response(command.existingToken(), existing);
            } catch (RuntimeException failure) {
                throw TokenDependencyFailures.translate(failure);
            }
        }
        var actor = new TokenAuditActor(TokenAuditActor.Kind.APPLICATION_CREDENTIALS, null, null);
        TokenAuditTarget target = new TokenAuditTarget(null, null, command.appKey(), command.tenantId(), null);
        try {
            var app = authorizations.authenticate(command.appKey(), command.appSecret());
            target = new TokenAuditTarget(null, app.id(), app.appKey(), command.tenantId(), null);
            var authorization = authorizations.forTarget(app, command.tenantId(), command.employeeNo());
            authorizations.verifyEmployee(authorization);
            String rawToken = CredentialSecrets.generate();
            var issuedAt = clock.instant().truncatedTo(ChronoUnit.MILLIS);
            StoredToken token = new StoredToken(ObjectIdType.TOKEN_RECORD.nextId(), authorization.subject(), authorization.versions(),
                    authorization.scopeCodes(), TokenStatus.ACTIVE, issuedAt, issuedAt.plus(settings.ttl()));
            target = TokenAuditTarget.from(token);
            return changes.execute(status -> {
                applications.lock(app.id());
                if (!authorizations.current(token.subject()).matches(token.subject(), token.versions(), token.scopeCodes())) {
                    throw new PlatformException(ErrorCode.FORBIDDEN, "身份查询期间授权已变化，请重新取Token");
                }
                tokens.create(token, CredentialSecrets.digest(rawToken));
                audit.success(TokenAction.ISSUE, actor, TokenAuditTarget.from(token), requestId);
                return response(rawToken, token);
            });
        } catch (RuntimeException failure) {
            throw audit.failure(TokenAction.ISSUE, actor, target, requestId, failure);
        }
    }

    public TokenResponse refresh(String rawToken, String appKey, String appSecret, String requestId) {
        var actor = new TokenAuditActor(TokenAuditActor.Kind.APPLICATION_CREDENTIALS, null, null);
        TokenAuditTarget target = new TokenAuditTarget(null, null, appKey, null, null);
        try {
            var app = authorizations.authenticate(appKey, appSecret);
            StoredToken previous = verifier.verifyToken(rawToken);
            target = TokenAuditTarget.from(previous);
            if (!previous.subject().applicationId().equals(app.id()) || previous.versions().application() != app.authorizationVersion()) {
                throw new PlatformException(ErrorCode.INVALID_TOKEN, "Token不属于此应用或授权已失效");
            }
            String replacement = CredentialSecrets.generate();
            var issuedAt = clock.instant().truncatedTo(ChronoUnit.MILLIS);
            StoredToken next = new StoredToken(ObjectIdType.TOKEN_RECORD.nextId(), previous.subject(), previous.versions(), previous.scopeCodes(),
                    TokenStatus.ACTIVE, issuedAt, issuedAt.plus(settings.ttl()));
            return changes.execute(status -> {
                applications.lock(app.id());
                tokens.lock(previous.id());
                verifier.verifyCurrent(previous);
                tokens.create(next, CredentialSecrets.digest(replacement));
                tokens.revoke(previous.id());
                audit.success(TokenAction.REFRESH, actor, TokenAuditTarget.from(next), requestId);
                return response(replacement, next);
            });
        } catch (RuntimeException failure) {
            throw audit.failure(TokenAction.REFRESH, actor, target, requestId, failure);
        }
    }

    public void revokeSelf(String rawToken, String requestId) {
        var actor = new TokenAuditActor(TokenAuditActor.Kind.BEARER, null, null);
        TokenAuditTarget target = new TokenAuditTarget(null, null, null, null, null);
        try {
            StoredToken token = verifier.verifyToken(rawToken);
            target = TokenAuditTarget.from(token);
            changes.executeWithoutResult(status -> {
                applications.lock(token.subject().applicationId());
                tokens.lock(token.id());
                verifier.verifyCurrent(token);
                tokens.revoke(token.id());
                audit.success(TokenAction.REVOKE, actor, TokenAuditTarget.from(token), requestId);
            });
        } catch (RuntimeException failure) {
            throw audit.failure(TokenAction.REVOKE, actor, target, requestId, failure);
        }
    }

    public void revokeByAdmin(String id, AccessOperator operator) {
        var actor = new TokenAuditActor(TokenAuditActor.Kind.ADMIN, operator.tenantId(), operator.employeeNo());
        TokenAuditTarget target = new TokenAuditTarget(id, null, null, null, null);
        try {
            StoredToken token = tokens.find(id).orElseThrow(() -> new PlatformException(ErrorCode.NOT_FOUND, "Token记录不存在"));
            target = TokenAuditTarget.from(token);
            changes.executeWithoutResult(status -> {
                applications.lock(token.subject().applicationId());
                tokens.lock(id);
                tokens.revoke(id);
                audit.success(TokenAction.REVOKE, actor, TokenAuditTarget.from(token), operator.requestId());
            });
        } catch (RuntimeException failure) {
            throw audit.failure(TokenAction.REVOKE, actor, target, operator.requestId(), failure);
        }
    }

    private TokenResponse response(String rawToken, StoredToken token) {
        return new TokenResponse(rawToken, "Bearer", token.expiresAt(), Math.max(0, Duration.between(clock.instant(), token.expiresAt()).getSeconds()), TokenContext.from(token));
    }
}
