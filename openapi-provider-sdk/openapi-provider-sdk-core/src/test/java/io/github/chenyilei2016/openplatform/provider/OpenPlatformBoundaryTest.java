package io.github.chenyilei2016.openplatform.provider;

import static org.junit.jupiter.api.Assertions.*;

import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.*;

class OpenPlatformBoundaryTest {
    private static final java.security.KeyPair KEYS = keys();
    private static final java.time.Clock CLOCK = java.time.Clock.systemUTC();
    private static final OpenPlatformTarget TARGET = OpenPlatformTarget.http(java.net.URI.create("http://orders/query"), "POST");
    private final OpenPlatformSigner signer = new OpenPlatformSigner("local", "current", KEYS.getPrivate(), CLOCK);
    private final OpenPlatformVerifier verifier = new OpenPlatformVerifier("local", java.util.Collections.singletonMap("current", KEYS.getPublic()), CLOCK);

    private static java.security.KeyPair keys() {
        try {
            java.security.KeyPairGenerator generator = java.security.KeyPairGenerator.getInstance("RSA");
            generator.initialize(2048);
            return generator.generateKeyPair();
        } catch (java.security.GeneralSecurityException failure) { throw new IllegalStateException(failure); }
    }

    private Map<String, String> headers(String tenant) {
        Map<String, String> values = new HashMap<>();
        values.put("x-open-platform-application-id", "application");
        values.put("x-open-platform-app-key", "app-key");
        values.put("x-open-platform-tenant-id", tenant);
        values.put("x-request-id", "request");
        return signer.sign(values, TARGET);
    }

    @Test
    void validatesIdentityCompletenessBoundsAndEmployeeRequirement() {
        Map<String, String> values = headers("tenant");
        assertThrows(OpenPlatformException.class, () -> verifier.authenticate(values::get, TARGET).requireEmployee());
        values.put("x-open-platform-user-id", "user");
        assertThrows(OpenPlatformException.class, () -> verifier.authenticate(values::get, TARGET));
        values.put("x-open-platform-employee-id", "employee");
        values.put("x-open-platform-employee-no", "E1001");
        Map<String, String> delegated = signer.sign(values, TARGET);
        assertEquals("E1001", verifier.authenticate(delegated::get, TARGET).requireEmployee().getEmployeeNo());
        for (String malformed : new String[] {"", " tenant", "tenant,other", "tenant\n",
                String.join("", java.util.Collections.nCopies(129, "x"))}) {
            values.put("x-open-platform-tenant-id", malformed);
            assertThrows(OpenPlatformException.class, () -> verifier.authenticate(values::get, TARGET));
        }
    }

    @Test
    void scopesRestoreNestedFailuresAndRejectOutOfOrderClose() {
        assertThrows(OpenPlatformException.class, OpenPlatformContext::requireIdentity);
        OpenPlatformIdentity outer = verifier.authenticate(headers("outer")::get, TARGET);
        try (OpenPlatformContext.Scope scope = OpenPlatformContext.open(outer)) {
            OpenPlatformContext.Scope nested =
                    OpenPlatformContext.open(verifier.authenticate(headers("nested")::get, TARGET));
            assertThrows(IllegalStateException.class, scope::close);
            nested.close();
            assertSame(outer, OpenPlatformContext.requireIdentity());
            assertThrows(
                    IllegalStateException.class,
                    () -> {
                        try (OpenPlatformContext.Scope ignored =
                                OpenPlatformContext.open(
                                        verifier.authenticate(headers("failure")::get, TARGET))) {
                            throw new IllegalStateException("business");
                        }
                    });
            assertSame(outer, OpenPlatformContext.requireIdentity());
        }
        assertFalse(OpenPlatformContext.current().isPresent());
    }

    @Test
    void explicitSnapshotsIsolateConcurrentReusedWorkersAndEmptySnapshot() throws Exception {
        ExecutorService workers = Executors.newFixedThreadPool(2);
        OpenPlatformContext.Snapshot empty = OpenPlatformContext.snapshot();
        try {
            java.util.List<Future<String>> results = new java.util.ArrayList<>();
            for (int index = 0; index < 40; index++) {
                String tenant = "tenant-" + index;
                try (OpenPlatformContext.Scope ignored =
                        OpenPlatformContext.open(verifier.authenticate(headers(tenant)::get, TARGET))) {
                    OpenPlatformContext.Snapshot snapshot = OpenPlatformContext.snapshot();
                    results.add(
                            workers.submit(
                                    snapshot.wrap(
                                            (Callable<String>)
                                                    () -> {
                                                        String current =
                                                                OpenPlatformContext
                                                                        .requireIdentity()
                                                                        .getTenantId();
                                                        try (OpenPlatformContext.Scope absent =
                                                                empty.open()) {
                                                            assertFalse(
                                                                    OpenPlatformContext.current()
                                                                            .isPresent());
                                                        }
                                                        assertEquals(
                                                                current,
                                                                OpenPlatformContext
                                                                        .requireIdentity()
                                                                        .getTenantId());
                                                        return current;
                                                    })));
                }
            }
            for (int index = 0; index < results.size(); index++)
                assertEquals("tenant-" + index, results.get(index).get(5, TimeUnit.SECONDS));
            assertFalse(workers.submit(() -> OpenPlatformContext.current().isPresent()).get());
        } finally {
            workers.shutdownNow();
            assertTrue(workers.awaitTermination(5, TimeUnit.SECONDS));
        }
    }

    interface Contract {
        @OpenPlatformApi
        String query();
    }

    static class Implementation implements Contract {
        @RequireOpenPlatformEmployee
        public String query() {
            return "";
        }
    }

    @Test
    void interfaceAndImplementationPoliciesChooseStrongerRequirement() throws Exception {
        assertEquals(
                OpenPlatformEndpointPolicy.EMPLOYEE,
                OpenPlatformEndpointPolicy.resolve(
                        Implementation.class, Contract.class.getMethod("query")));
    }
}
