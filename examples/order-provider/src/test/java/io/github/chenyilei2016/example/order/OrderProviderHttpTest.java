package io.github.chenyilei2016.example.order;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {"open-platform.provider.environment-id=local", "example.order.dubbo.port=-1"})
class OrderProviderHttpTest {
    @org.springframework.test.context.DynamicPropertySource
    static void proofProperties(org.springframework.test.context.DynamicPropertyRegistry properties) {
        properties.add("open-platform.provider.public-keys.test", () -> java.util.Base64.getEncoder().encodeToString(ProviderProofFixture.KEYS.getPublic().getEncoded()));
    }
    @LocalServerPort
    int port;

    @Test
    void sharedFeignContractProtectsImplementedPathQueryAndBody() throws Exception {
        String path = "/internal/orders/COMMON-001/lookup?tenantId=101";
        try (HttpClient client = HttpClient.newHttpClient()) {
            assertThat(client.send(signedRequest(path, "101", "COMMON-001", true).build(), HttpResponse.BodyHandlers.ofString()).statusCode()).isEqualTo(200);
            assertThat(client.send(signedRequest(path, "101", "COMMON-001", false).build(), HttpResponse.BodyHandlers.ofString()).statusCode()).isEqualTo(403);
            assertThat(client.send(signedRequest(path, "101", "PRIVATE-002", true).build(), HttpResponse.BodyHandlers.ofString()).statusCode()).isEqualTo(400);
            assertThat(client.send(HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path)).header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString("{}" )).build(), HttpResponse.BodyHandlers.ofString()).statusCode()).isEqualTo(403);
        }
    }

    @Test
    void sameOrderNumberIsResolvedWithinTrustedTenant() throws Exception {
        try (HttpClient client = HttpClient.newHttpClient()) {
            var firstTenant = client.send(request("101", "COMMON-001").build(), HttpResponse.BodyHandlers.ofString());
            assertThat(firstTenant.statusCode()).isEqualTo(200);
            assertThat(firstTenant.body()).contains("\"amount\":101.25", "\"tenantId\":\"101\"");
            var secondTenant = client.send(request("202", "COMMON-001").build(), HttpResponse.BodyHandlers.ofString());
            assertThat(secondTenant.statusCode()).isEqualTo(200);
            assertThat(secondTenant.body()).contains("\"amount\":202.50", "\"tenantId\":\"202\"");
        }
    }

    @Test
    void credentialsAreVerifiedBeforeTrustingIdentityOrParsingBody() throws Exception {
        try (HttpClient client = HttpClient.newHttpClient()) {
            for (var builder : java.util.List.of(
                    request("101", "COMMON-001").setHeader("X-Open-Platform-Signature", "wrong-key"),
                    request("101", "COMMON-001").header("X-Open-Platform-Signature", "duplicate"),
                    HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + "/internal/orders/query"))
                            .header("Content-Type", "application/json").POST(HttpRequest.BodyPublishers.ofString("invalid JSON")))) {
                var response = client.send(builder.build(), HttpResponse.BodyHandlers.ofString());
                assertThat(response.statusCode()).isEqualTo(403);
                assertThat(response.body()).doesNotContain("wrong-key");
            }
        }
    }

    @Test
    void identitiesMustBeSingleBoundedAndComplete() throws Exception {
        try (HttpClient client = HttpClient.newHttpClient()) {
            for (var builder : java.util.List.of(
                    request("101", "COMMON-001").header("X-Open-Platform-Tenant-Id", "202"),
                    request("101", "COMMON-001").setHeader("X-Open-Platform-Tenant-Id", ""),
                    request("101", "COMMON-001").setHeader("X-Open-Platform-App-Key", "x".repeat(129)),
                    request("101", "COMMON-001").header("X-Open-Platform-User-Id", "user101"),
                    request("101", "COMMON-001").header("X-Open-Platform-Employee-No", "E101"))) {
                assertThat(client.send(builder.build(), HttpResponse.BodyHandlers.ofString()).statusCode()).isEqualTo(403);
            }
        }
    }

    @Test
    void delegatedUserCannotAccessOtherEmployeesOrTenants() throws Exception {
        try (HttpClient client = HttpClient.newHttpClient()) {
            var own = signedRequest("/internal/orders/query", "101", "COMMON-001", true);
            assertThat(client.send(own.build(), HttpResponse.BodyHandlers.ofString()).statusCode()).isEqualTo(200);
            var anotherOwner = signedRequest("/internal/orders/query", "101", "PRIVATE-002", true);
            assertThat(client.send(anotherOwner.build(), HttpResponse.BodyHandlers.ofString()).statusCode()).isEqualTo(403);
            var anotherTenant = request("101", "COMMON-001")
                    .setHeader("X-Open-Platform-Tenant-Id", "202");
            assertThat(client.send(anotherTenant.build(), HttpResponse.BodyHandlers.ofString()).statusCode()).isEqualTo(403);
            assertThat(client.send(request("202", "PRIVATE-002").build(), HttpResponse.BodyHandlers.ofString()).statusCode()).isEqualTo(404);
            assertThat(client.send(request("101", "PRIVATE-002").build(), HttpResponse.BodyHandlers.ofString()).statusCode()).isEqualTo(200);
        }
    }

    @Test
    void invalidOrAmbiguousBodiesAreRejected() throws Exception {
        try (HttpClient client = HttpClient.newHttpClient()) {
            for (String body : java.util.List.of(
                    "{\"tenantId\":\"101\",\"orderNo\":\"\"}",
                    "{\"tenantId\":\"101\"}",
                    "{\"tenantId\":\"101\",\"orderNo\":\"COMMON-001\",\"employeeNo\":\"E102\"}",
                    "{\"tenantId\":\"101\",\"tenantId\":\"101\",\"orderNo\":\"COMMON-001\"}")) {
                assertThat(client.send(request("101", "COMMON-001")
                        .POST(HttpRequest.BodyPublishers.ofString(body)).build(), HttpResponse.BodyHandlers.ofString()).statusCode()).isEqualTo(400);
            }
        }
    }

    @Test
    void businessResponseKeepsNotFoundSeparateFromPermissionRejection() throws Exception {
        try (HttpClient client = HttpClient.newHttpClient()) {
            HttpResponse<String> found = client.send(signedRequest("/internal/orders/lookup", "101", "COMMON-001", false).build(), HttpResponse.BodyHandlers.ofString());
            assertThat(found.statusCode()).isEqualTo(200);
            assertThat(found.body()).contains("\"code\":0", "\"amount\":101.25");
            HttpResponse<String> absent = client.send(signedRequest("/internal/orders/lookup", "101", "MISSING", false).build(), HttpResponse.BodyHandlers.ofString());
            assertThat(absent.statusCode()).isEqualTo(200);
            assertThat(absent.body()).contains("\"code\":40401", "\"data\":null");
            assertThat(client.send(signedRequest("/internal/orders/lookup", "101", "PRIVATE-002", true).build(), HttpResponse.BodyHandlers.ofString()).statusCode()).isEqualTo(403);
        }
    }

    @Test
    void employeeEndpointRequiresSdkIdentityAndHealthIsOperationalOnly() throws Exception {
        try (HttpClient client = HttpClient.newHttpClient()) {
            assertThat(client.send(signedRequest("/internal/orders/mine", "101", "COMMON-001", false).build(), HttpResponse.BodyHandlers.ofString()).statusCode()).isEqualTo(403);
            assertThat(client.send(signedRequest("/internal/orders/mine", "101", "COMMON-001", true).build(), HttpResponse.BodyHandlers.ofString()).statusCode()).isEqualTo(200);
            assertThat(client.send(signedRequest("/internal/orders/mine", "101", "PRIVATE-002", true).build(), HttpResponse.BodyHandlers.ofString()).statusCode()).isEqualTo(403);
            HttpResponse<String> health = client.send(HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + "/actuator/health/readiness")).GET().build(), HttpResponse.BodyHandlers.ofString());
            assertThat(health.statusCode()).isEqualTo(200);
            assertThat(health.body()).contains("\"status\":\"UP\"");
        }
    }

    private HttpRequest.Builder request(String tenantId, String orderNo) {
        return signedRequest("/internal/orders/query", tenantId, orderNo, false);
    }

    private HttpRequest.Builder signedRequest(String endpoint, String tenantId, String orderNo, boolean employee) {
        java.util.Map<String, String> identity = new java.util.HashMap<>();
        identity.put("x-open-platform-application-id", "application-001");
        identity.put("x-open-platform-app-key", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
        identity.put("x-open-platform-tenant-id", tenantId);
        identity.put("x-request-id", "request-001");
        if (employee) {
            identity.put("x-open-platform-user-id", "user101");
            identity.put("x-open-platform-employee-id", "employee101");
            identity.put("x-open-platform-employee-no", "E101");
        }
        HttpRequest.Builder request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + endpoint))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString("{\"tenantId\":\"" + tenantId + "\",\"orderNo\":\"" + orderNo + "\"}"));
        ProviderProofFixture.SIGNER.sign(identity, io.github.chenyilei2016.openplatform.provider.OpenPlatformTarget.http(
                URI.create("http://provider" + endpoint), "POST")).forEach(request::header);
        return request;
    }
}
