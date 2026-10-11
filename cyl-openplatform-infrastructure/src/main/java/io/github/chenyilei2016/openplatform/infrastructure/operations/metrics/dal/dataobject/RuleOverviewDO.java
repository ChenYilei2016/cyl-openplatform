package io.github.chenyilei2016.openplatform.infrastructure.operations.metrics.dal.dataobject;

import lombok.Data;
import lombok.EqualsAndHashCode;

@Data
@EqualsAndHashCode(callSuper = true)
public class RuleOverviewDO extends CallMinuteDO {
    private String ruleId;
    private long ruleVersion;
}
