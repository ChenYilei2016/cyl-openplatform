package io.github.chenyilei2016.openplatform.infrastructure.access.dal.impl;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import io.github.chenyilei2016.openplatform.domain.access.AccessAudit;
import io.github.chenyilei2016.openplatform.domain.access.AccessAuditRepository;
import io.github.chenyilei2016.openplatform.domain.access.AccessPageQuery;
import io.github.chenyilei2016.openplatform.domain.common.PageResult;
import io.github.chenyilei2016.openplatform.infrastructure.access.dal.dataobject.AccessAuditDO;
import io.github.chenyilei2016.openplatform.infrastructure.access.dal.mapper.AccessAuditMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Repository;

@Repository
@RequiredArgsConstructor
public class AccessAuditRepositoryImpl implements AccessAuditRepository {
    private final AccessAuditMapper mapper;

    @Override
    public void append(AccessAudit audit) {
        mapper.insert(new AccessAuditDO(audit.id(), audit.applicationId(), audit.action(), audit.operatorTenantId(),
                audit.operatorEmployeeNo(), audit.targetTenantId(), audit.targetId(), audit.outcome(), audit.summary(),
                audit.requestId(), audit.occurredAt(), audit.operatorUserId(), audit.operatorEmployeeId(),
                audit.tenantGrantId(), audit.targetUserId(), audit.targetEmployeeId(), audit.targetEmployeeNo()));
    }

    @Override
    public PageResult<AccessAudit> page(String applicationId, AccessPageQuery query) {
        var page = mapper.selectPage(new Page<>(query.page(), query.pageSize()), Wrappers.<AccessAuditDO>lambdaQuery()
                .eq(AccessAuditDO::getApplicationId, applicationId).orderByDesc(AccessAuditDO::getOccurredAt, AccessAuditDO::getId));
        return new PageResult<>(page.getRecords().stream().map(row -> new AccessAudit(row.getId(), row.getApplicationId(),
                        row.getAction(), row.getOperatorTenantId(), row.getOperatorEmployeeNo(), row.getTargetTenantId(),
                        row.getTargetId(), row.getOutcome(), row.getSummary(), row.getRequestId(), row.getOccurredAt(), row.getOperatorUserId(), row.getOperatorEmployeeId(),
                        row.getTenantGrantId(), row.getTargetUserId(), row.getTargetEmployeeId(), row.getTargetEmployeeNo())).toList(),
                page.getTotal(), query.page(), query.pageSize());
    }
}
