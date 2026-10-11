package io.github.chenyilei2016.openplatform.governance;

import io.github.chenyilei2016.openplatform.domain.governance.GovernanceRule;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class GovernanceRuleTest {
    @Test
    void stableTargetsDistinguishDimensionsAndBoundCompositeAuditIds() {
        assertThat(new GovernanceRule.Target(GovernanceRule.Type.APPLICATION, null, "app-1", null).stableId()).isEqualTo("APPLICATION:app-1");
        assertThat(new GovernanceRule.Target(GovernanceRule.Type.API, null, null, "api-1").stableId()).isEqualTo("API:api-1");
        String tenantApi = new GovernanceRule.Target(GovernanceRule.Type.TENANT_API, "a".repeat(64), null, "api-1").stableId();
        assertThat(tenantApi).matches("[0-9a-f]{64}");
        assertThat(tenantApi).isNotEqualTo(new GovernanceRule.Target(GovernanceRule.Type.APPLICATION_API, null, "app-1", "api-1").stableId());
        assertThatThrownBy(() -> new GovernanceRule.Target(GovernanceRule.Type.TENANT_API, "tenant:api", null, "api-1")).isInstanceOf(RuntimeException.class);
        assertThatThrownBy(() -> new GovernanceRule.Target(GovernanceRule.Type.TENANT, "tenant", "app-1", null)).isInstanceOf(RuntimeException.class);
    }

    @Test
    void ratesRejectAmbiguousAlgorithmsAndUnboundedCapacity() {
        assertThatThrownBy(() -> new GovernanceRule.Rate(GovernanceRule.Algorithm.TOKEN_BUCKET, 0, 10)).isInstanceOf(RuntimeException.class);
        assertThatThrownBy(() -> new GovernanceRule.Rate(GovernanceRule.Algorithm.TOKEN_BUCKET, 10, 1_000_001)).isInstanceOf(RuntimeException.class);
    }
}
