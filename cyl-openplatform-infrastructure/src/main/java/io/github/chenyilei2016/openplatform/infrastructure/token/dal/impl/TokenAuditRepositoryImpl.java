package io.github.chenyilei2016.openplatform.infrastructure.token.dal.impl;

import io.github.chenyilei2016.openplatform.domain.token.TokenAudit;
import io.github.chenyilei2016.openplatform.domain.token.TokenAuditRepository;
import io.github.chenyilei2016.openplatform.infrastructure.token.dal.dataobject.TokenAuditDO;
import io.github.chenyilei2016.openplatform.infrastructure.token.dal.mapper.TokenAuditMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Repository;

@Repository
@RequiredArgsConstructor
public class TokenAuditRepositoryImpl implements TokenAuditRepository {
    private final TokenAuditMapper mapper;
    @Override public void append(TokenAudit audit) {
        TokenAuditDO row = new TokenAuditDO();
        row.setId(audit.id()); row.setAction(audit.action().name()); row.setActorKind(audit.actor().kind().name());
        row.setOperatorTenantId(audit.actor().operatorTenantId()); row.setOperatorEmployeeNo(audit.actor().operatorEmployeeNo());
        row.setTokenId(audit.target().tokenId()); row.setApplicationId(audit.target().applicationId()); row.setAppKey(audit.target().appKey());
        row.setTenantId(audit.target().tenantId()); row.setUserId(audit.target().userId());
        row.setOutcome(audit.outcome()); row.setReason(audit.reason()); row.setRequestId(audit.requestId()); row.setOccurredAt(audit.occurredAt());
        mapper.insert(row);
    }
}
