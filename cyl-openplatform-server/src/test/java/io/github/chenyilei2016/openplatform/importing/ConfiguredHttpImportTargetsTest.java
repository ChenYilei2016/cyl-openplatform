package io.github.chenyilei2016.openplatform.importing;

import io.github.chenyilei2016.openplatform.application.importing.HttpImportTargetPolicy.Decision;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiBinding;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiDefinition;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiLifecycle;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiProtocol;
import io.github.chenyilei2016.openplatform.domain.catalog.SchemaNode;
import io.github.chenyilei2016.openplatform.domain.catalog.SchemaType;
import io.github.chenyilei2016.openplatform.infrastructure.importing.ConfiguredHttpImportTargets;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.assertThat;

class ConfiguredHttpImportTargetsTest {
    @Test void acceptsSavedHttpAddressesWithoutDeploymentRegistration() {
        ConfiguredHttpImportTargets policy = new ConfiguredHttpImportTargets();
        for (String address : List.of("http://one.example/orders", "https://two.example:444/query?region=cn", "https://two.example/orders/{id}")) {
            assertThat(policy.check(null, http(address))).isEqualTo(Decision.PERMITTED);
            assertThat(policy.check(http("http://old.example"), http(address))).isEqualTo(Decision.PERMITTED);
        }
        for (String address : List.of("http://provider:0/query", "http://provider:65536/query", "file:///etc/passwd", "https://user:password@internal.example/orders", "https://internal.example/orders#fragment"))
            assertThat(policy.check(null, http(address))).isEqualTo(Decision.REJECTED);
        assertThat(Decision.REJECTED.error()).doesNotContain("password", "获准");
    }

    private ApiDefinition http(String url) {
        SchemaNode schema = new SchemaNode(SchemaType.OBJECT, null, false, Map.of(), null, List.of(), null, null, false);
        return new ApiDefinition("api-1", "orders", "v1", "query", "订单", "测试", "测试", ApiProtocol.HTTP, 1,
                List.of(), schema, schema, List.of(), new ApiBinding(ApiProtocol.HTTP, 3000, new ApiBinding.Http(url, "POST"), null),
                List.of(), ApiLifecycle.DEFAULT, null, false, null, null, null, null);
    }
}
