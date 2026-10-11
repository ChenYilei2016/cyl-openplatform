package io.github.chenyilei2016.openplatform.infrastructure.operations.metrics.dal.dataobject;

import io.github.chenyilei2016.openplatform.domain.observability.CallIdentityKind;
import io.github.chenyilei2016.openplatform.domain.operations.StatisticsRank;
import lombok.Data;
import lombok.EqualsAndHashCode;

@Data
@EqualsAndHashCode(callSuper = true)
public class StatisticsRankDO extends CallMinuteDO {
    private String tenantId;
    private String employeeId;
    private CallIdentityKind identityKind;
    private String apiId;
    private String name;
    private String employeeNo;
    private String tenantName;

    public StatisticsRank rank() {
        return new StatisticsRank(tenantId, employeeId, identityKind, apiId, name, employeeNo, tenantName, totals());
    }
}
