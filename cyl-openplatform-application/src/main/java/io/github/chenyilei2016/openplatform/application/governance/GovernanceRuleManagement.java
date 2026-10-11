package io.github.chenyilei2016.openplatform.application.governance;

import io.github.chenyilei2016.openplatform.domain.governance.GovernanceRule;
import java.time.Instant;
import java.util.List;
import java.util.Set;

/** 治理管理稿与不可变发布记录；运行时身份和版本由服务端生成。 */
public final class GovernanceRuleManagement {
    private GovernanceRuleManagement() {}

    public record Config(GovernanceRule.Target target, boolean enabled, GovernanceRule.Mode mode, GovernanceRule.Rate rate,
                         long dailyQuota, GovernanceRule.IpMode ipMode, List<String> ipAddresses) {
        public Config {
            ipAddresses = new GovernanceRule("validation", 0, target, enabled, mode, rate, dailyQuota, ipMode, ipAddresses).ipAddresses();
        }
        public GovernanceRule runtime(long version) {
            return new GovernanceRule(target.stableId(), version, target, enabled, mode, rate, dailyQuota, ipMode, ipAddresses);
        }
        public static Config from(GovernanceRule rule) {
            return new Config(rule.target(), rule.enabled(), rule.mode(), rule.rate(), rule.dailyQuota(), rule.ipMode(), rule.ipAddresses());
        }
    }

    public record Draft(String id, String name, Config config, long draftRevision, long stateVersion,
                        String liveReleaseId, GovernanceRule liveRule, TargetDisplay targetDisplay, String liveName) {}
    /** 只读展示资料，不参与目标身份、授权或发布摘要。 */
    public record TargetDisplay(String applicationName, String appKey, String apiName, String service, String version, String method) {}
    /** 列表当前页可见的关联配置数，包含草稿及停用规则，不代表本次调用命中数。 */
    public record AssociationCount(String targetId, long ruleCount) {}
    public record Release(String id, String ruleId, GovernanceRule rule, String name, Instant publishedAt,
                          String sourceReleaseId, String operatorTenantId, String operatorEmployeeNo, String previewDigest) {}
    public record Preview(String id, long draftRevision, long stateVersion, String sourceReleaseId, String digest,
                          String name, String beforeName, GovernanceRule before, GovernanceRule after, boolean change, List<String> warnings) {
        public Preview { warnings = List.copyOf(warnings); }
    }
    public record Query(int page, int pageSize, String nameContains, GovernanceRule.Type type, String tenantId,
                        String appKey, String apiId, GovernanceRule.Mode mode, Set<GovernanceRule.Type> allowedTypes) {
        public Query {
            nameContains = nameContains == null || nameContains.isBlank() ? null : nameContains.strip();
            tenantId = tenantId == null || tenantId.isBlank() ? null : tenantId.strip();
            appKey = appKey == null || appKey.isBlank() ? null : appKey.strip();
            apiId = apiId == null || apiId.isBlank() ? null : apiId.strip();
            allowedTypes = Set.copyOf(allowedTypes);
        }
    }
}
