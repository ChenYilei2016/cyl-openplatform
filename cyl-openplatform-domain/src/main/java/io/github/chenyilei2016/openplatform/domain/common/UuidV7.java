package io.github.chenyilei2016.openplatform.domain.common;

import java.util.UUID;

/**
 * RFC 9562 UUIDv7底层生成器，输出36位小写UUID；业务对象统一经ObjectIdType添加类型前缀。
 * 同一毫秒的随机尾部、时钟回拨及多节点时钟差不保证严格递增。
 * 记录ID不是授权凭据，不用于生成Token、Secret或nonce。
 */
public final class UuidV7 {
    private static final long TIMESTAMP_MASK = 0xFFFFFFFFFFFFL;
    private static final long VERSION_BITS = 0x7000L;
    private static final long RANDOM_A_MASK = 0xFFFL;

    private UuidV7() {
    }

    public static String nextId() {
        // 复用JDK的安全随机源；UUIDv4的最低64位已包含RFC标准variant。
        UUID random = UUID.randomUUID();
        long timestamp = System.currentTimeMillis() & TIMESTAMP_MASK;
        long mostSignificantBits = (timestamp << 16) | VERSION_BITS
                | (random.getMostSignificantBits() & RANDOM_A_MASK);
        return new UUID(mostSignificantBits, random.getLeastSignificantBits()).toString();
    }
}
