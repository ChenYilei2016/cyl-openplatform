package io.github.chenyilei2016.openplatform.runtime;

import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.github.chenyilei2016.openplatform.domain.runtime.IdempotencyGuard.Reservation;
import io.github.chenyilei2016.openplatform.infrastructure.runtime.RedisIdempotencyGuard;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfSystemProperty;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** 显式端口和独占标记的本机Redis；不读取公司配置，不访问共享Redis。 */
@EnabledIfSystemProperty(named = "mcp.redis.port", matches = "[0-9]+")
class IdempotencyRedisTest {
    @Test
    void atomicClaimExpiresInThreeHoursAndReleaseCannotRemoveAnotherRequest() throws Exception {
        LettuceConnectionFactory connection = new LettuceConnectionFactory("127.0.0.1", Integer.parseInt(System.getProperty("mcp.redis.port")));
        connection.afterPropertiesSet();
        connection.start();
        try {
            StringRedisTemplate redis = new StringRedisTemplate(connection);
            assertThat(redis.opsForValue().get("szopen:mcp-owned-redis")).isEqualTo("mcp-regression-only");
            RedisIdempotencyGuard guard = new RedisIdempotencyGuard(redis);
            String tenant = "tenant-" + UUID.randomUUID();
            CountDownLatch start = new CountDownLatch(1);
            List<Future<Reservation>> attempts = new ArrayList<>();
            Reservation winner = null;
            int admitted = 0;
            try (ExecutorService pool = Executors.newFixedThreadPool(6)) {
                for (int index = 0; index < 6; index++) {
                    Reservation claim = new Reservation(tenant, "api-1", "a".repeat(64), "request-" + index);
                    attempts.add(pool.submit(() -> {
                        start.await();
                        try { guard.reserve(claim); return claim; }
                        catch (PlatformException failure) {
                            assertThat(failure.getErrorCode()).isEqualTo(ErrorCode.IDEMPOTENT_REPLAY);
                            return null;
                        }
                    }));
                }
                start.countDown();
                for (Future<Reservation> attempt : attempts) {
                    Reservation accepted = attempt.get();
                    if (accepted != null) { admitted++; winner = accepted; }
                }
            }
            assertThat(admitted).isEqualTo(1);
            Reservation other = new Reservation(tenant, "api-1", "a".repeat(64), "other-request");
            guard.release(other);
            assertThatThrownBy(() -> guard.reserve(other)).isInstanceOfSatisfying(PlatformException.class,
                    failure -> assertThat(failure.getErrorCode()).isEqualTo(ErrorCode.IDEMPOTENT_REPLAY));
            String key = "szopen:invocation-idempotency:" + tenant.length() + ":" + tenant + ":5:api-1:" + "a".repeat(64);
            assertThat(redis.getExpire(key)).isBetween(10790L, 10800L);
            assertThat(redis.opsForValue().get(key)).isEqualTo(winner.requestId());
            guard.release(winner);
            guard.reserve(other);
            guard.release(winner);
            assertThat(redis.opsForValue().get(key)).isEqualTo(other.requestId());
            guard.reserve(new Reservation(tenant + "2", "api-1", "a".repeat(64), "different-tenant"));
            guard.reserve(new Reservation(tenant, "api-2", "a".repeat(64), "different-api"));
        } finally { connection.destroy(); }
    }
}
