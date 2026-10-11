package io.github.chenyilei2016.openplatform.domain.governance;

import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import lombok.Getter;

/** 对外只携带稳定原因和等待时间，不携带目标、其他租户规则或内部配额。 */
@Getter
public final class GovernanceRejected extends PlatformException {
    private final GovernanceDecision.Reason reason;
    private final long retryAfterSeconds;

    public GovernanceRejected(GovernanceDecision.Reason reason, long retryAfterSeconds) {
        super(reason == GovernanceDecision.Reason.IP_DENIED ? ErrorCode.FORBIDDEN : ErrorCode.RATE_LIMITED,
                reason == GovernanceDecision.Reason.IP_DENIED ? "当前来源IP不允许调用" : "调用超过当前治理额度，请稍后重试");
        this.reason = reason;
        this.retryAfterSeconds = Math.max(1, retryAfterSeconds);
    }
}
