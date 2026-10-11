package io.github.chenyilei2016.openplatform.common;

import io.github.chenyilei2016.openplatform.domain.common.ObjectIdType;
import java.util.HashSet;
import java.util.Set;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.assertThat;

class ObjectIdTypeTest {
    @Test
    void everyObjectTypeHasADistinctFixedWidthPrefixAndPreservesUuidV7Bits() {
        Set<String> prefixes = new HashSet<>();
        for (ObjectIdType type : ObjectIdType.values()) {
            String id = type.nextId();
            assertThat(id).hasSizeLessThanOrEqualTo(64).matches("[A-Z]{3,16}_[0-9a-f]{12}7[0-9a-f]{3}[89ab][0-9a-f]{15}");
            assertThat(prefixes.add(id.substring(0, id.indexOf('_') + 1))).as(type.name()).isTrue();
            assertThat(type.accepts(id)).isTrue();
            assertThat(type.accepts("01a0e1ff-9279-772e-880e-dbe826ebd8fd")).isTrue();
            assertThat(type.accepts(null)).isFalse();
            assertThat(type.accepts("../" + id)).isFalse();
            for (ObjectIdType other : ObjectIdType.values()) {
                if (type != other) assertThat(other.accepts(id)).isFalse();
            }
        }
    }
}
