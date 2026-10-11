package io.github.chenyilei2016.openplatform.catalog;

import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.github.chenyilei2016.openplatform.domain.mcp.McpToolName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class McpToolNameTest {
    @Test
    void joinsIdentityAndNormalizesVersionSeparators() {
        assertThat(McpToolName.of("order", "query_detail", "V1.2-beta_3").value()).isEqualTo("order_query_detail_V1_2_beta_3");
        assertThat(McpToolName.of("order", "query", "1.0")).isEqualTo(McpToolName.of("order", "query", "1_0"));
    }

    @Test
    void rejectsNamesOverSixtyFourCharactersOrOutsideTheAllowedAlphabet() {
        String service = "s".repeat(30), method = "m".repeat(30);
        assertThat(McpToolName.of(service, method, "v1").value()).hasSize(64);
        assertThatThrownBy(() -> McpToolName.of(service, method, "v12")).isInstanceOf(PlatformException.class);
        assertThatThrownBy(() -> McpToolName.of("order", "query", "v1+1")).isInstanceOf(PlatformException.class);
        assertThatThrownBy(() -> McpToolName.of("order", null, "v1")).isInstanceOf(PlatformException.class);
    }
}
