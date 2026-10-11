package io.github.chenyilei2016.openplatform.governance;

import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.github.chenyilei2016.openplatform.domain.governance.GovernanceDecision;
import io.github.chenyilei2016.openplatform.domain.governance.GovernanceRequest;
import io.github.chenyilei2016.openplatform.domain.governance.GovernanceRule;
import io.github.chenyilei2016.openplatform.domain.observability.CallMode;
import io.github.chenyilei2016.openplatform.infrastructure.governance.RedisGovernanceGuard;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfSystemProperty;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.RedisScript;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** 仅访问显式端口且带独占标记的本机临时Redis；不使用Spring应用配置或公司数据源。 */
@EnabledIfSystemProperty(named = "task50.redis.port", matches = "[0-9]+")
class GovernanceRuntimeRedisTest {
    private static final String PREFIX = "szopen:{gateway-governance}:v2:";
    private final AtomicReference<List<GovernanceRule>> rules = new AtomicReference<>(List.of());
    private LettuceConnectionFactory connection;
    private StringRedisTemplate redis;
    private RedisGovernanceGuard guard;
    private GovernanceRequest request;

    @BeforeEach
    void connectOnlyToOwnedRedis() {
        int port = Integer.parseInt(System.getProperty("task50.redis.port"));
        assertThat(port).isBetween(1, 65535);
        connection = new LettuceConnectionFactory("127.0.0.1", port);
        connection.afterPropertiesSet(); connection.start();
        redis = new StringRedisTemplate(connection);
        assertThat(redis.opsForValue().get("szopen:task50-owned-redis")).isEqualTo("runtime50-test-only");
        request = new GovernanceRequest(UUID.randomUUID().toString(), "tenant-" + UUID.randomUUID(), UUID.randomUUID().toString(), "127.0.0.1", CallMode.PRODUCTION);
        guard = new RedisGovernanceGuard(ignored -> rules.get(), redis);
    }

    @AfterEach
    void closeOwnedConnections() { if (connection != null) connection.destroy(); }

    private GovernanceRule rule(GovernanceRule.Type type, long version, boolean enabled, GovernanceRule.Mode mode, GovernanceRule.Rate rate, long quota) {
        GovernanceRule.Target target = switch (type) {
            case APPLICATION -> new GovernanceRule.Target(type, null, request.applicationId(), null);
            case API -> new GovernanceRule.Target(type, null, null, request.apiId());
            case TENANT -> new GovernanceRule.Target(type, request.tenantId(), null, null);
            case TENANT_API -> new GovernanceRule.Target(type, request.tenantId(), null, request.apiId());
            case APPLICATION_API -> new GovernanceRule.Target(type, null, request.applicationId(), request.apiId());
        };
        return new GovernanceRule(target.stableId(), version, target, enabled, mode, rate, quota, GovernanceRule.IpMode.UNRESTRICTED, List.of());
    }

    private GovernanceRule limited(GovernanceRule.Type type, long version, int limit, long quota) {
        return rule(type, version, true, GovernanceRule.Mode.ENFORCE, new GovernanceRule.Rate(GovernanceRule.Algorithm.TOKEN_BUCKET, 1, limit), quota);
    }

    private long now() {
        return redis.execute(RedisScript.of("local t=redis.call('TIME'); return tonumber(t[1])*1000+math.floor(tonumber(t[2])/1000)", Long.class), List.of());
    }

    private String daily(GovernanceRule rule) { return PREFIX + "day:" + rule.id(); }
    private String bucket(GovernanceRule rule) { return PREFIX + "bucket:" + rule.id(); }

    @Test
    void fiveDimensionsAdmitAtomicallyAndRejectionDoesNotConsumeOtherQuotas() {
        List<GovernanceRule> configured = new ArrayList<>();
        for (GovernanceRule.Type type : GovernanceRule.Type.values()) configured.add(limited(type, 0, 100, type == GovernanceRule.Type.API ? 2 : 5));
        rules.set(configured);
        assertThat(guard.evaluate(request).allowed()).isTrue();
        assertThat(guard.evaluate(request).allowed()).isTrue();
        assertThat(guard.evaluate(request).denialReason()).isEqualTo(GovernanceDecision.Reason.DAILY_QUOTA);
        for (GovernanceRule rule : configured) assertThat(redis.opsForHash().get(daily(rule), "count")).isEqualTo("2");
    }

    @Test
    void quotaZeroStillCountsAndDisableEnableRollbackCannotResetTheDay() {
        GovernanceRule.Rate none = new GovernanceRule.Rate(GovernanceRule.Algorithm.NONE, 0, 0);
        GovernanceRule original = rule(GovernanceRule.Type.APPLICATION, 0, true, GovernanceRule.Mode.ENFORCE, none, 0);
        rules.set(List.of(original));
        for (int i = 0; i < 3; i++) assertThat(guard.evaluate(request).allowed()).isTrue();
        rules.set(List.of(rule(GovernanceRule.Type.APPLICATION, 1, false, GovernanceRule.Mode.ENFORCE, none, 2)));
        assertThat(guard.evaluate(request).allowed()).isTrue();
        assertThat(redis.opsForHash().get(daily(original), "count")).isEqualTo("3");
        for (long revision = 2; revision <= 3; revision++) {
            rules.set(List.of(rule(GovernanceRule.Type.APPLICATION, revision, true, GovernanceRule.Mode.ENFORCE, none, 2)));
            GovernanceDecision result = guard.evaluate(request);
            assertThat(result.denialReason()).isEqualTo(GovernanceDecision.Reason.DAILY_QUOTA);
            assertThat(result.retryAfterSeconds()).isBetween(1L, 86400L);
        }
        assertThat(redis.opsForHash().get(daily(original), "count")).isEqualTo("3");
    }

    @Test
    void tokenBucketStartsFullRefillsAndClampsCapacityWithoutGivingFreeTokens() {
        GovernanceRule rule = rule(GovernanceRule.Type.API, 1, true, GovernanceRule.Mode.ENFORCE,
                new GovernanceRule.Rate(GovernanceRule.Algorithm.TOKEN_BUCKET, 1, 3), 0);
        rules.set(List.of(rule));
        for (int i = 0; i < 3; i++) assertThat(guard.evaluate(request).allowed()).isTrue();
        assertThat(guard.evaluate(request).denialReason()).isEqualTo(GovernanceDecision.Reason.TOKEN_BUCKET_LIMIT);
        rules.set(List.of(rule(GovernanceRule.Type.API, 2, true, GovernanceRule.Mode.ENFORCE,
                new GovernanceRule.Rate(GovernanceRule.Algorithm.TOKEN_BUCKET, 1, 10), 0)));
        assertThat(guard.evaluate(request).allowed()).isFalse();
        String previousAdmission = Long.toString(now() - 5000);
        redis.opsForHash().putAll(bucket(rule), Map.of("at", previousAdmission, "lastAdmission", previousAdmission));
        rules.set(List.of(rule(GovernanceRule.Type.API, 3, true, GovernanceRule.Mode.ENFORCE,
                new GovernanceRule.Rate(GovernanceRule.Algorithm.TOKEN_BUCKET, 1, 1), 0)));
        assertThat(guard.evaluate(request).allowed()).isTrue();
        assertThat(Long.parseLong(redis.opsForHash().get(bucket(rule), "tokens").toString())).isLessThan(1000);
    }

    @Test
    void disablingDoesNotResetExistingTokenBalance() {
        GovernanceRule rule = limited(GovernanceRule.Type.API, 1, 1, 0);
        rules.set(List.of(rule));
        assertThat(guard.evaluate(request).allowed()).isTrue();
        redis.opsForHash().put(bucket(rule), "at", Long.toString(now() + 60000));
        rules.set(List.of(rule(GovernanceRule.Type.API, 2, false, GovernanceRule.Mode.ENFORCE, rule.rate(), 0)));
        assertThat(guard.evaluate(request).allowed()).isTrue();
        rules.set(List.of(limited(GovernanceRule.Type.API, 3, 1, 0)));
        assertThat(guard.evaluate(request).denialReason()).isEqualTo(GovernanceDecision.Reason.TOKEN_BUCKET_LIMIT);
    }

    @Test
    void observationsUseShadowQuotaAndNeverConsumeOrRefillFormalQuota() {
        GovernanceRule formal = limited(GovernanceRule.Type.APPLICATION, 1, 10, 1);
        rules.set(List.of(formal)); assertThat(guard.evaluate(request).allowed()).isTrue();
        GovernanceRule shadow = rule(GovernanceRule.Type.APPLICATION, 2, true, GovernanceRule.Mode.OBSERVE, formal.rate(), 1);
        rules.set(List.of(shadow)); assertThat(guard.evaluate(request).allowed()).isTrue();
        GovernanceDecision observed = guard.evaluate(request);
        assertThat(observed.allowed()).isTrue();
        assertThat(observed.hits().getFirst().reason()).isEqualTo(GovernanceDecision.Reason.DAILY_QUOTA);
        assertThat(redis.opsForHash().get(daily(formal), "count")).isEqualTo("1");
        assertThat(redis.opsForHash().get(PREFIX + "shadow:day:" + shadow.id(), "count")).isEqualTo("1");
        rules.set(List.of(limited(GovernanceRule.Type.APPLICATION, 3, 10, 1)));
        assertThat(guard.evaluate(request).denialReason()).isEqualTo(GovernanceDecision.Reason.DAILY_QUOTA);
    }

    @Test
    void shadowCanObserveCandidatesRejectedByOtherExecutingPolicies() {
        GovernanceRule formal = limited(GovernanceRule.Type.APPLICATION, 0, 10, 1);
        GovernanceRule shadow = rule(GovernanceRule.Type.API, 1, true, GovernanceRule.Mode.OBSERVE, formal.rate(), 10);
        rules.set(List.of(formal, shadow));
        assertThat(guard.evaluate(request).allowed()).isTrue();
        assertThat(guard.evaluate(request).allowed()).isFalse();
        assertThat(redis.opsForHash().get(daily(formal), "count")).isEqualTo("1");
        assertThat(redis.opsForHash().get(PREFIX + "shadow:day:" + shadow.id(), "count")).isEqualTo("2");
    }

    @Test
    void draftsHaveSeparateUsageAndAnAdditionalPerApiHardLimit() {
        GovernanceRule formal = limited(GovernanceRule.Type.APPLICATION, 0, 100, 0);
        rules.set(List.of(formal)); assertThat(guard.evaluate(request).allowed()).isTrue();
        GovernanceRequest debug = new GovernanceRequest(request.applicationId(), request.tenantId(), request.apiId(), request.clientIp(), CallMode.DRAFT_DEBUG);
        for (int i = 0; i < 60; i++) assertThat(guard.evaluate(debug).allowed()).isTrue();
        assertThat(guard.evaluate(debug).denialReason()).isEqualTo(GovernanceDecision.Reason.TOKEN_BUCKET_LIMIT);
        assertThat(redis.opsForHash().get(daily(formal), "count")).isEqualTo("1");
        String debugDay = PREFIX + "debug:day:DRAFT_DEBUG_LIMIT:" + request.apiId();
        redis.opsForHash().put(debugDay, "count", "1000");
        assertThat(guard.evaluate(debug).denialReason()).isEqualTo(GovernanceDecision.Reason.DAILY_QUOTA);
    }

    @Test
    void ipRejectionConsumesNothingAndUtcRolloverUsesRedisDay() {
        GovernanceRule allowed = limited(GovernanceRule.Type.APPLICATION, 0, 5, 2);
        GovernanceRule blocked = new GovernanceRule(allowed.id(), 1, allowed.target(), true, allowed.mode(), allowed.rate(), 2,
                GovernanceRule.IpMode.ALLOWLIST, List.of("198.51.100.0/24"));
        rules.set(List.of(blocked));
        assertThat(guard.evaluate(request).denialReason()).isEqualTo(GovernanceDecision.Reason.IP_DENIED);
        assertThat(redis.hasKey(daily(allowed))).isFalse();
        assertThat(redis.hasKey(PREFIX + allowed.id())).isFalse();
        rules.set(List.of(limited(GovernanceRule.Type.APPLICATION, 2, 5, 2)));
        long day = now() / 86400000;
        redis.opsForHash().putAll(daily(allowed), Map.of("day", Long.toString(day - 1), "count", "200"));
        assertThat(guard.evaluate(request).allowed()).isTrue();
        assertThat(redis.opsForHash().get(daily(allowed), "day")).isEqualTo(Long.toString(day));
        assertThat(redis.opsForHash().get(daily(allowed), "count")).isEqualTo("1");
        assertThat(redis.getExpire(daily(allowed), TimeUnit.SECONDS)).isBetween(1L, 86400L);
    }

    @Test
    void staleVersionsReloadOnceAndModeOrDisableWatermarksCannotBeDowngraded() {
        GovernanceRule current = limited(GovernanceRule.Type.API, 3, 10, 0);
        rules.set(List.of(current)); guard.evaluate(request);
        AtomicInteger reads = new AtomicInteger();
        RedisGovernanceGuard reload = new RedisGovernanceGuard(ignored -> List.of(reads.incrementAndGet() == 1 ? limited(GovernanceRule.Type.API, 2, 10, 0) : current), redis);
        assertThat(reload.evaluate(request).allowed()).isTrue(); assertThat(reads.get()).isEqualTo(2);
        rules.set(List.of(rule(GovernanceRule.Type.API, 4, false, GovernanceRule.Mode.OBSERVE, current.rate(), 0)));
        guard.evaluate(request);
        rules.set(List.of(current));
        assertThatThrownBy(() -> guard.evaluate(request)).isInstanceOfSatisfying(PlatformException.class,
                failure -> assertThat(failure.getErrorCode()).isEqualTo(ErrorCode.DEPENDENCY_UNAVAILABLE));
        assertThat(redis.opsForHash().get(daily(current), "count")).isEqualTo("2");
        assertThat(redis.opsForValue().get(PREFIX + "version:" + current.id())).isEqualTo("4");
    }

    @Test
    void policyAndRedisStateFailuresFailClosedWithoutPartialQuotaChanges() {
        GovernanceRule application = limited(GovernanceRule.Type.APPLICATION, 0, 5, 0);
        GovernanceRule api = limited(GovernanceRule.Type.API, 0, 5, 0);
        rules.set(List.of(application, api));
        redis.opsForValue().set(bucket(api), "invalid-type", Duration.ofSeconds(60));
        assertThatThrownBy(() -> guard.evaluate(request)).isInstanceOfSatisfying(PlatformException.class,
                failure -> assertThat(failure.getErrorCode()).isEqualTo(ErrorCode.DEPENDENCY_UNAVAILABLE));
        assertThat(redis.hasKey(daily(application))).isFalse();
        redis.delete(bucket(api));
        redis.opsForHash().put(daily(api), "count", "3");
        assertThatThrownBy(() -> guard.evaluate(request)).isInstanceOf(PlatformException.class);
        assertThat(redis.hasKey(daily(application))).isFalse();
        RedisGovernanceGuard failedRepository = new RedisGovernanceGuard(ignored -> { throw new IllegalStateException("dependency"); }, redis);
        assertThatThrownBy(() -> failedRepository.evaluate(request)).isInstanceOfSatisfying(PlatformException.class,
                failure -> assertThat(failure.getErrorCode()).isEqualTo(ErrorCode.DEPENDENCY_UNAVAILABLE));
        connection.destroy();
        assertThatThrownBy(() -> guard.evaluate(request)).isInstanceOfSatisfying(PlatformException.class,
                failure -> assertThat(failure.getErrorCode()).isEqualTo(ErrorCode.DEPENDENCY_UNAVAILABLE));
    }

    @Test
    void damagedDailyStateCannotResetQuotaOrPartiallyConsumeOtherRules() {
        GovernanceRule application = limited(GovernanceRule.Type.APPLICATION, 0, 5, 2);
        GovernanceRule api = limited(GovernanceRule.Type.API, 0, 5, 2);
        rules.set(List.of(application, api));
        long day = now() / 86400000;
        List<Map<String, String>> damagedStates = List.of(
                Map.of("count", "3"),
                Map.of("day", Long.toString(day)),
                Map.of("day", day + ".5", "count", "3"),
                Map.of("day", Long.toString(day + 1), "count", "3"));
        for (Map<String, String> damaged : damagedStates) {
            redis.delete(daily(api));
            redis.opsForHash().putAll(daily(api), damaged);
            assertThatThrownBy(() -> guard.evaluate(request)).as("damaged daily state %s", damaged)
                    .isInstanceOfSatisfying(PlatformException.class,
                            failure -> assertThat(failure.getErrorCode()).isEqualTo(ErrorCode.DEPENDENCY_UNAVAILABLE));
            assertThat(redis.hasKey(daily(application))).isFalse();
            assertThat(redis.hasKey(PREFIX + application.id())).isFalse();
            assertThat(redis.hasKey(PREFIX + api.id())).isFalse();
            assertThat(redis.opsForHash().entries(daily(api))).isEqualTo(damaged);
        }
    }

    @Test
    void damagedTokenBalanceCannotPartiallyConsumeOtherRules() {
        GovernanceRule application = limited(GovernanceRule.Type.APPLICATION, 1, 10, 10);
        GovernanceRule api = limited(GovernanceRule.Type.API, 1, 10, 10);
        rules.set(List.of(application, api));
        for (String tokens : List.of("-1", "2001", "1.5")) {
            Map<String, String> damaged = Map.of("tokens", tokens, "at", Long.toString(now()), "rate", "1", "capacity", "2000");
            redis.opsForHash().putAll(bucket(api), damaged);
            assertThatThrownBy(() -> guard.evaluate(request)).isInstanceOf(PlatformException.class);
            assertThat(redis.hasKey(daily(application))).isFalse();
            assertThat(redis.opsForHash().entries(bucket(api))).isEqualTo(damaged);
        }
    }

    @Test
    void foreignTargetsAndMoreThanFiveBusinessRulesAreRejected() {
        GovernanceRule.Target foreign = new GovernanceRule.Target(GovernanceRule.Type.TENANT, "another-tenant", null, null);
        rules.set(List.of(new GovernanceRule(foreign.stableId(), 1, foreign, true, GovernanceRule.Mode.ENFORCE,
                new GovernanceRule.Rate(GovernanceRule.Algorithm.NONE, 0, 0), 0, GovernanceRule.IpMode.UNRESTRICTED, List.of())));
        assertThatThrownBy(() -> guard.evaluate(request)).isInstanceOf(PlatformException.class);
        GovernanceRule same = limited(GovernanceRule.Type.API, 1, 10, 0);
        rules.set(java.util.Collections.nCopies(6, same));
        assertThatThrownBy(() -> guard.evaluate(request)).isInstanceOf(PlatformException.class);
        assertThat(redis.hasKey(PREFIX + same.id())).isFalse();
    }

    @Test
    void boundedConcurrentRequestsShareOneAtomicBudget() throws Exception {
        GovernanceRule rule = limited(GovernanceRule.Type.TENANT_API, 1, 7, 7);
        rules.set(List.of(rule));
        CountDownLatch start = new CountDownLatch(1);
        try (ExecutorService callers = Executors.newFixedThreadPool(8)) {
            List<Future<Boolean>> results = new ArrayList<>();
            for (int i = 0; i < 24; i++) results.add(callers.submit(() -> { start.await(); return guard.evaluate(request).allowed(); }));
            start.countDown();
            int accepted = 0;
            for (Future<Boolean> result : results) if (result.get(5, TimeUnit.SECONDS)) accepted++;
            assertThat(accepted).isEqualTo(7);
        }
        assertThat(redis.opsForHash().get(daily(rule), "count")).isEqualTo("7");
    }
}
