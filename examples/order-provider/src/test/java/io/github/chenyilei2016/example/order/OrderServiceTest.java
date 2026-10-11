package io.github.chenyilei2016.example.order;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import io.github.chenyilei2016.openplatform.provider.OpenPlatformIdentity;
import io.github.chenyilei2016.openplatform.provider.OpenPlatformVerifier;

import org.junit.jupiter.api.Test;

import java.util.Map;

class OrderServiceTest {
    @Test
    void configuredTenantAndOwnersPreserveIsolation() {
        OrderService service = new OrderService("9007199254740993", "E1001", "E1002");
        io.github.chenyilei2016.openplatform.provider.OpenPlatformTarget target = io.github.chenyilei2016.openplatform.provider.OpenPlatformTarget.http(java.net.URI.create("http://provider/query"), "POST");
        Map<String, String> values = Map.of("x-open-platform-application-id", "application-1", "x-open-platform-app-key", "app-key",
                "x-open-platform-tenant-id", "9007199254740993", "x-request-id", "request-1",
                "x-open-platform-user-id", "user-1", "x-open-platform-employee-id", "employee-1", "x-open-platform-employee-no", "E1001");
        Map<String, String> proof = ProviderProofFixture.SIGNER.sign(values, target);
        OpenPlatformIdentity administrator = ProviderProofFixture.verifier().authenticate(proof::get, target);
        assertThat(
                        service.query("COMMON-001", administrator.getTenantId(), administrator)
                                .getTenantId())
                .isEqualTo(administrator.getTenantId());
        assertThatThrownBy(
                        () ->
                                service.query(
                                        "PRIVATE-002", administrator.getTenantId(), administrator))
                .isInstanceOfSatisfying(
                        OrderService.QueryRejected.class,
                        failure -> assertThat(failure.status()).isEqualTo(403));
        assertThatThrownBy(() -> service.query("COMMON-001", "202", administrator))
                .isInstanceOfSatisfying(
                        OrderService.QueryRejected.class,
                        failure -> assertThat(failure.status()).isEqualTo(403));
        assertThatThrownBy(() -> new OrderService("202", "E1001", "E1002"))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
