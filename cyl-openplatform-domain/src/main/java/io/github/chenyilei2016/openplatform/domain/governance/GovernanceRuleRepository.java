package io.github.chenyilei2016.openplatform.domain.governance;

import java.util.List;

/** 按可信身份一次批量读取至多五个目标；包含停用快照以保留额度状态。 */
public interface GovernanceRuleRepository {
    List<GovernanceRule> findApplicable(GovernanceRequest request);
}
