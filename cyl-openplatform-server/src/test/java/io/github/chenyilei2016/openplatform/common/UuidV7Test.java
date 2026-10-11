package io.github.chenyilei2016.openplatform.common;

import io.github.chenyilei2016.openplatform.domain.common.UuidV7;
import java.util.HashSet;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.assertThat;

class UuidV7Test {
    @Test
    void idsPreserveUuidContractAndMillisecondOrdering() {
        long before = System.currentTimeMillis();
        HashSet<String> ids = new HashSet<>();
        String previous = null;
        long previousTimestamp = -1;
        for (int index = 0; index < 4096; index++) {
            String id = UuidV7.nextId();
            UUID uuid = UUID.fromString(id);
            long timestamp = uuid.getMostSignificantBits() >>> 16;
            assertThat(id).hasSize(36).isEqualTo(uuid.toString());
            assertThat(uuid.version()).isEqualTo(7);
            assertThat(uuid.variant()).isEqualTo(2);
            assertThat(timestamp).isBetween(before, System.currentTimeMillis());
            assertThat(ids.add(id)).isTrue();
            // 只要求不同毫秒的时间排序，不对同毫秒随机值作单调假设。
            if (previous != null && timestamp > previousTimestamp) {
                assertThat(id.compareTo(previous)).isPositive();
            }
            previous = id;
            previousTimestamp = timestamp;
        }
    }
}
