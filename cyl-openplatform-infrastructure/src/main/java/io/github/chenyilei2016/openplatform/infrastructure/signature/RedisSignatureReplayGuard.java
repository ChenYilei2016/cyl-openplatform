package io.github.chenyilei2016.openplatform.infrastructure.signature;

import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.github.chenyilei2016.openplatform.domain.signature.SignatureReplayGuard;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Component;

@Component
@RequiredArgsConstructor
public class RedisSignatureReplayGuard implements SignatureReplayGuard {
    // ponytail: 单集合最多10万项；测量达到单Redis槽吞吐边界后再按应用分片。
    private static final DefaultRedisScript<Long> CONSUME = new DefaultRedisScript<>("""
            local now = tonumber(redis.call('TIME')[1])
            local timestamp = tonumber(ARGV[2])
            if timestamp < now - 300 or timestamp > now + 300 then return -1 end
            local initialized = redis.call('ZSCORE', KEYS[1], '!initialized')
            if not initialized then
              redis.call('ZADD', KEYS[1], now, '!initialized')
              redis.call('PERSIST', KEYS[1])
              return -3
            end
            if now < tonumber(initialized) + 601 then return -3 end
            local expired = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', now, 'LIMIT', 0, 1001)
            local removable = {}
            for _, member in ipairs(expired) do
              if member ~= '!initialized' and #removable < 1000 then table.insert(removable, member) end
            end
            if #removable > 0 then redis.call('ZREM', KEYS[1], unpack(removable)) end
            local previous = redis.call('ZSCORE', KEYS[1], ARGV[1])
            if previous and tonumber(previous) > now then return 0 end
            if not previous and redis.call('ZCARD', KEYS[1]) >= 100001 then return -2 end
            redis.call('ZADD', KEYS[1], timestamp + 301, ARGV[1])
            return 1
            """, Long.class);
    private final StringRedisTemplate redis;

    @Override public void consume(String keyId, String nonce, long timestamp) {
        Long result;
        try {
            result = redis.execute(CONSUME, List.of("szopen:{request-signature}:nonces"),
                    keyId + ":" + nonce, Long.toString(timestamp));
        } catch (RuntimeException failure) {
            throw new PlatformException(ErrorCode.DEPENDENCY_UNAVAILABLE, "共享签名验证暂不可用", failure);
        }
        if (result != null && result == 1) return;
        if (result != null && result == -3) throw new PlatformException(ErrorCode.DEPENDENCY_UNAVAILABLE, "签名防重放状态恢复中，请等待601秒后重试");
        if (result != null && result == -2) throw new PlatformException(ErrorCode.RATE_LIMITED, "签名防重放容量已满，请稍后重新发起业务请求");
        if (result != null && (result == 0 || result == -1)) {
            throw new PlatformException(ErrorCode.INVALID_SIGNATURE, "签名请求已使用或超出有效时间窗");
        }
        throw new PlatformException(ErrorCode.DEPENDENCY_UNAVAILABLE, "共享签名验证暂不可用");
    }
}
