package io.github.chenyilei2016.openplatform.application.token;

import io.github.chenyilei2016.openplatform.domain.common.ObjectIdType;
import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.github.chenyilei2016.openplatform.domain.token.TokenAction;
import io.github.chenyilei2016.openplatform.domain.token.TokenAudit;
import io.github.chenyilei2016.openplatform.domain.token.TokenAuditActor;
import io.github.chenyilei2016.openplatform.domain.token.TokenAuditRepository;
import io.github.chenyilei2016.openplatform.domain.token.TokenAuditTarget;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;
import java.time.Clock;

/** 成功事实由调用方同事务写入；失败审计不复用已回滚的业务事务。 */
@Slf4j
@Service
public class TokenAuditService {
    private final TokenAuditRepository repository;
    private final TransactionTemplate failures;
    private final Clock clock;

    public TokenAuditService(TokenAuditRepository repository, PlatformTransactionManager transactionManager, Clock tokenClock) {
        this.repository = repository;
        this.clock = tokenClock;
        this.failures = new TransactionTemplate(transactionManager);
        this.failures.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    public void success(TokenAction action, TokenAuditActor actor, TokenAuditTarget target, String requestId) {
        repository.append(new TokenAudit(ObjectIdType.TOKEN_AUDIT.nextId(), action, actor, target, "SUCCESS", "SUCCESS", requestId, clock.instant()));
    }

    public PlatformException failure(TokenAction action, TokenAuditActor actor, TokenAuditTarget target, String requestId, RuntimeException cause) {
        RuntimeException classified = TokenDependencyFailures.translate(cause);
        ErrorCode code = classified instanceof PlatformException known ? known.getErrorCode()
                : classified instanceof DataIntegrityViolationException ? ErrorCode.CONFLICT : ErrorCode.INTERNAL_ERROR;
        try {
            failures.executeWithoutResult(status -> repository.append(new TokenAudit(ObjectIdType.TOKEN_AUDIT.nextId(), action,
                    actor, target, "FAILURE", code.name(), requestId, clock.instant())));
        } catch (RuntimeException auditFailure) {
            log.error("Token失败审计未落库 requestId={}", requestId, auditFailure);
        }
        return new PlatformException(code, code.getMessage(),
                classified instanceof PlatformException known ? known.getCause() : classified);
    }
}
