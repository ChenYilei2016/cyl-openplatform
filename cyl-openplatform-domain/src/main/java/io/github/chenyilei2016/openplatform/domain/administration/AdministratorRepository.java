package io.github.chenyilei2016.openplatform.domain.administration;

import io.github.chenyilei2016.openplatform.domain.common.PageResult;

import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/** 管理授权持久化端口。所有写操作必须在持有全局控制行锁的同一事务中执行。 */
public interface AdministratorRepository {
    Optional<Administrator> find(String id);

    Optional<Administrator> findByIdentity(String tenantId, String employeeNo);

    PageResult<Administrator> page(AdministratorQuery query);

    /** 当前列表页涉及的操作人展示姓名；最多300项，未登记的操作人不出现在结果中。 */
    Map<OperatorRef, String> displayNames(Collection<OperatorRef> operators);

    PageResult<AdministratorAudit> audit(AdministratorAuditQuery query);

    AdministratorStatus status();

    void lockControl();

    long countEnabledSuperAdministrators();

    void createAll(List<Administrator> administrators);

    void update(Administrator administrator, long expectedRevision);

    void appendAudits(List<AdministratorAudit> audits);
}
