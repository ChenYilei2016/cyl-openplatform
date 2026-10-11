package io.github.chenyilei2016.openplatform.infrastructure.governance;

import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.github.chenyilei2016.openplatform.domain.governance.GovernanceDecision;
import io.github.chenyilei2016.openplatform.domain.governance.GovernanceGuard;
import io.github.chenyilei2016.openplatform.domain.governance.GovernanceRequest;
import io.github.chenyilei2016.openplatform.domain.governance.GovernanceRule;
import io.github.chenyilei2016.openplatform.domain.governance.GovernanceRuleRepository;
import io.github.chenyilei2016.openplatform.domain.observability.CallMode;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.springframework.core.io.ClassPathResource;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.RedisScript;
import org.springframework.stereotype.Component;

/** 五维治理共用一次Lua；令牌桶、日配额原子准入，影子与草稿空间独立。 */
@Component
public class RedisGovernanceGuard implements GovernanceGuard {
    private static final String PREFIX = "szopen:{gateway-governance}:v2:";
    private static final RedisScript<List> ACQUIRE = RedisScript.of(new ClassPathResource("governance/acquire.lua"), List.class);
    private final GovernanceRuleRepository policies;
    private final StringRedisTemplate redis;

    public RedisGovernanceGuard(GovernanceRuleRepository policies, StringRedisTemplate redis) {
        this.policies = policies;
        this.redis = redis;
    }

    @Override
    public GovernanceDecision evaluate(GovernanceRequest request) {
        try {
            // 较早修订不能覆盖已应用的新配置；最多重读一次，不递归重试。
            for (int attempt = 0; attempt < 2; attempt++) {
                List<GovernanceRule> rules = new ArrayList<>(policies.findApplicable(request));
                if (rules.size() > 5) throw unavailable();
                Set<GovernanceRule.Type> dimensions = new HashSet<>();
                Set<String> identities = new HashSet<>();
                for (GovernanceRule rule : rules) {
                    if (!rule.target().matches(request) || !rule.id().equals(rule.target().stableId())
                            || !dimensions.add(rule.target().type()) || !identities.add(rule.id())) throw unavailable();
                }
                if (request.mode() == CallMode.DRAFT_DEBUG) {
                    rules.add(new GovernanceRule("DRAFT_DEBUG_LIMIT:" + request.apiId(), 0,
                            new GovernanceRule.Target(GovernanceRule.Type.API, null, null, request.apiId()), true,
                            GovernanceRule.Mode.ENFORCE, new GovernanceRule.Rate(GovernanceRule.Algorithm.TOKEN_BUCKET, 1, 60),
                            1000, GovernanceRule.IpMode.UNRESTRICTED, List.of()));
                }
                if (rules.isEmpty()) return new GovernanceDecision(true, GovernanceDecision.Reason.NONE, 0, List.of());
                List<String> keys = new ArrayList<>(rules.size() * 3);
                List<String> arguments = new ArrayList<>(rules.size() * 7);
                for (GovernanceRule rule : rules) {
                    String lane = request.mode() == CallMode.DRAFT_DEBUG ? "debug:" : "";
                    if (rule.mode() == GovernanceRule.Mode.OBSERVE) lane += "shadow:";
                    String prefix = PREFIX + lane;
                    keys.add(prefix + "day:" + rule.id());
                    keys.add(prefix + "bucket:" + rule.id());
                    keys.add(PREFIX + "version:" + rule.id());
                    arguments.add(Long.toString(rule.version()));
                    arguments.add(rule.enabled() ? "1" : "0");
                    arguments.add(rule.mode() == GovernanceRule.Mode.OBSERVE ? "2" : "1");
                    arguments.add(Integer.toString(rule.rate().perSecond()));
                    arguments.add(Integer.toString(rule.rate().burst()));
                    arguments.add(Long.toString(rule.dailyQuota()));
                    arguments.add(!rule.enabled() || rule.allowsIp(request.clientIp()) ? "1" : "0");
                }
                List<?> result = redis.execute(ACQUIRE, keys, arguments.toArray());
                if (result == null || result.isEmpty()) throw unavailable();
                long status = ((Number) result.getFirst()).longValue();
                if (status == -1) continue;
                if ((status != 0 && status != 1) || result.size() != 4 + rules.size() * 3
                        || ((Number) result.get(3)).intValue() != rules.size()) throw unavailable();
                List<GovernanceDecision.Hit> hits = new ArrayList<>(rules.size());
                for (int index = 0; index < rules.size(); index++) {
                    GovernanceRule rule = rules.get(index);
                    int offset = 4 + index * 3;
                    hits.add(new GovernanceDecision.Hit(rule.id(), rule.version(), rule.target().type(), rule.mode(),
                            GovernanceRule.Algorithm.fromWireCode(((Number) result.get(offset + 2)).intValue()),
                            GovernanceDecision.Reason.fromWireCode(((Number) result.get(offset)).intValue()),
                            ((Number) result.get(offset + 1)).longValue()));
                }
                return new GovernanceDecision(status == 1,
                        GovernanceDecision.Reason.fromWireCode(((Number) result.get(1)).intValue()),
                        ((Number) result.get(2)).longValue(), hits);
            }
            throw unavailable();
        } catch (RuntimeException failure) {
            throw new PlatformException(ErrorCode.DEPENDENCY_UNAVAILABLE, "治理策略或共享限流状态暂不可用", failure);
        }
    }

    private static PlatformException unavailable() {
        return new PlatformException(ErrorCode.DEPENDENCY_UNAVAILABLE, "治理策略或共享限流状态暂不可用");
    }
}
