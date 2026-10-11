package io.github.chenyilei2016.openplatform.domain.governance;

import java.util.List;

/** 管理记录保留有限命中事实；客户端响应只使用denialReason和retryAfterSeconds。 */
public record GovernanceDecision(boolean allowed, Reason denialReason, long retryAfterSeconds, List<Hit> hits) {
    public enum Reason {
        NONE(0), IP_DENIED(1), TOKEN_BUCKET_LIMIT(3), DAILY_QUOTA(4);
        private final int wireCode;
        Reason(int wireCode) { this.wireCode = wireCode; }
        public boolean violation() { return this != NONE; }
        public static Reason fromWireCode(int code) {
            return java.util.Arrays.stream(values()).filter(value -> value.wireCode == code).findFirst()
                    .orElseThrow(() -> new IllegalArgumentException("未知治理拒绝代码"));
        }
    }
    public record Hit(String ruleId, long version, GovernanceRule.Type targetType, GovernanceRule.Mode mode,
                      GovernanceRule.Algorithm algorithm, Reason reason, long retryAfterSeconds) {}
    public GovernanceDecision { hits = List.copyOf(hits); }
    public boolean observed() { return hits.stream().anyMatch(hit -> hit.mode() == GovernanceRule.Mode.OBSERVE && hit.reason().violation()); }
    public long violationCount() { return hits.stream().filter(hit -> hit.reason().violation()).map(hit -> hit.ruleId() + ":" + hit.version()).distinct().count(); }

}
