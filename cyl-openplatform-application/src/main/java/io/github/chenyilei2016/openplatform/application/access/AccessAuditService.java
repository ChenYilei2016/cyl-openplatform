package io.github.chenyilei2016.openplatform.application.access;

import io.github.chenyilei2016.openplatform.domain.common.ObjectIdType;
import io.github.chenyilei2016.openplatform.domain.access.AccessAudit;
import io.github.chenyilei2016.openplatform.domain.access.AccessAudit.EmployeeTarget;
import io.github.chenyilei2016.openplatform.domain.access.AccessAuditRepository;
import io.github.chenyilei2016.openplatform.domain.access.AccessOperator;
import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;
import java.time.Instant;
import java.util.function.Supplier;

/** 成功变更与审计同一事务；失败先回滚，再以独立事务记录白名单元数据。 */
@Slf4j
@Service
public class AccessAuditService {
    private final AccessAuditRepository repository;
    private final TransactionTemplate changes;
    private final TransactionTemplate failures;

    public AccessAuditService(AccessAuditRepository repository, PlatformTransactionManager transactionManager) {
        this.repository = repository;
        this.changes = new TransactionTemplate(transactionManager);
        this.failures = new TransactionTemplate(transactionManager);
        this.failures.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    public <T> T change(String action, String applicationId, String targetTenantId, String targetId,
                        AccessOperator operator, Supplier<T> mutation) {
        return changePersonnel(action, applicationId, targetTenantId, targetId, operator, null, mutation);
    }

    public <T> T changePersonnel(String action, String applicationId, String targetTenantId, String targetId,
                                AccessOperator operator, EmployeeTarget verifiedTarget, Supplier<T> mutation) {
        try {
            return changes.execute(status -> {
                T result = mutation.get();
                String affectedId = switch (result) {
                    case TenantGrantView grant -> grant.id();
                    case UserGrantView grant -> grant.id();
                    case null, default -> targetId;
                };
                repository.append(entry(action, applicationId, targetTenantId, affectedId, operator, "SUCCESS", "操作成功", result instanceof UserGrantView grant ? new EmployeeTarget(grant.tenantGrantId(), grant.userId(), grant.employeeId(), grant.employeeNo()) : verifiedTarget));
                return result;
            });
        } catch (RuntimeException exception) {
            PlatformException failure = exception instanceof PlatformException known ? known :
                    new PlatformException(exception instanceof DataIntegrityViolationException ? ErrorCode.CONFLICT : ErrorCode.INTERNAL_ERROR,
                            exception instanceof DataIntegrityViolationException ? "资源已存在或关联状态冲突" : "操作失败", exception);
            try {
                failures.executeWithoutResult(status -> repository.append(entry(action, applicationId, targetTenantId,
                        targetId, operator, "FAILURE", failure.getErrorCode().getMessage(), verifiedTarget)));
            } catch (RuntimeException auditFailure) {
                log.error("授权失败审计未落库 requestId={}", operator.requestId(), auditFailure);
            }
            throw failure;
        }
    }

    public void rejected(String action, String applicationId, String tenantId, String targetId,
                         AccessOperator operator, PlatformException failure) {
        rejectedPersonnel(action, applicationId, tenantId, targetId, operator, null, failure);
    }

    public void rejectedPersonnel(String action, String applicationId, String tenantId, String targetId,
                                  AccessOperator operator, EmployeeTarget verifiedTarget, PlatformException failure) {
        failures.executeWithoutResult(status -> repository.append(entry(action, applicationId, tenantId, targetId,
                operator, "FAILURE", failure.getErrorCode().getMessage(), verifiedTarget)));
    }

    private AccessAudit entry(String action, String applicationId, String tenantId, String targetId,
                              AccessOperator operator, String outcome, String summary, EmployeeTarget target) {
        return new AccessAudit(ObjectIdType.ACCESS_AUDIT.nextId(), applicationId, action, operator.tenantId(),
                operator.employeeNo(), tenantId, targetId, outcome, summary, operator.requestId(), Instant.now(), operator.userId(), operator.employeeId(),
                target == null ? null : target.tenantGrantId(), target == null ? null : target.userId(),
                target == null ? null : target.employeeId(), target == null ? null : target.employeeNo());
    }
}
