package io.github.chenyilei2016.openplatform.domain.governance;

public interface GovernanceGuard {
    GovernanceDecision evaluate(GovernanceRequest request);
}
