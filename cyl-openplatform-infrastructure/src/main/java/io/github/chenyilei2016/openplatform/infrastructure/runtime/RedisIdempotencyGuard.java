package io.github.chenyilei2016.openplatform.infrastructure.runtime;

import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.github.chenyilei2016.openplatform.domain.runtime.IdempotencyGuard;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Component;

/** 三小时固定窗口，不存请求/响应正文；Lua把占位与读取原请求号作为同一个原子操作。 */
@Component
@RequiredArgsConstructor
public class RedisIdempotencyGuard implements IdempotencyGuard {
    private static final DefaultRedisScript<String> RESERVE = new DefaultRedisScript<>("""
            local previous = redis.call('GET', KEYS[1])
            if previous then return previous end
            redis.call('SET', KEYS[1], ARGV[1], 'NX', 'EX', 10800)
            return ''
            """, String.class);
    private static final DefaultRedisScript<Long> RELEASE = new DefaultRedisScript<>("""
            if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
            return 0
            """, Long.class);
    private final StringRedisTemplate redis;

    @Override public void reserve(Reservation reservation) {
        String previous;
        try {
            previous = redis.execute(RESERVE, List.of(key(reservation)), reservation.requestId());
        } catch (RuntimeException failure) {
            throw unavailable(failure);
        }
        if (previous == null) throw unavailable(null);
        if (!previous.isEmpty()) throw new PlatformException(ErrorCode.IDEMPOTENT_REPLAY,
                "已提交过（原请求 requestId=" + previous + "）");
    }

    @Override public void release(Reservation reservation) {
        try {
            if (redis.execute(RELEASE, List.of(key(reservation)), reservation.requestId()) == null) throw unavailable(null);
        } catch (PlatformException failure) {
            throw failure;
        } catch (RuntimeException failure) {
            throw unavailable(failure);
        }
    }

    private static String key(Reservation reservation) {
        // 长度前缀避免租户标识中的分隔符造成命名歧义；业务唯一号只使用摘要。
        return "szopen:invocation-idempotency:" + reservation.tenantId().length() + ":" + reservation.tenantId()
                + ":" + reservation.apiId().length() + ":" + reservation.apiId() + ":" + reservation.valueDigest();
    }

    private static PlatformException unavailable(Throwable cause) {
        return new PlatformException(ErrorCode.DEPENDENCY_UNAVAILABLE, "幂等服务暂不可用，请稍后重试", cause);
    }
}
