package io.github.chenyilei2016.openplatform.provider;

import org.junit.jupiter.api.Test;
import java.net.URI;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;
import static org.junit.jupiter.api.Assertions.*;

class OpenPlatformProofTest {
    @Test
    void rotatesPublicKeysAndRejectsUnknownFutureOrRemovedProofs() throws Exception {
        KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
        generator.initialize(2048);
        KeyPair current = generator.generateKeyPair();
        KeyPair previous = generator.generateKeyPair();
        Clock now = Clock.fixed(Instant.ofEpochSecond(2_000), ZoneOffset.UTC);
        OpenPlatformTarget target = OpenPlatformTarget.dubbo("sample.OrderFacade", "1", "orders", "query", Collections.singletonList("java.lang.String"));
        Map<String, String> identity = new HashMap<>();
        identity.put("x-open-platform-application-id", "application");
        identity.put("x-open-platform-app-key", "key");
        identity.put("x-open-platform-tenant-id", "tenant");
        identity.put("x-request-id", "request");
        Map<String, java.security.PublicKey> keys = new HashMap<>();
        keys.put("current", current.getPublic()); keys.put("previous", previous.getPublic());
        OpenPlatformVerifier verifier = new OpenPlatformVerifier("local", keys, now);
        Map<String, String> oldProof = new OpenPlatformSigner("local", "previous", previous.getPrivate(), now).sign(identity, target);
        assertEquals("tenant", verifier.authenticate(oldProof::get, target).getTenantId());
        OpenPlatformVerifier rotated = new OpenPlatformVerifier("local", Collections.singletonMap("current", current.getPublic()), now);
        assertThrows(OpenPlatformException.class, () -> rotated.authenticate(oldProof::get, target));
        Map<String, String> future = new OpenPlatformSigner("local", "current", current.getPrivate(),
                Clock.offset(now, java.time.Duration.ofSeconds(6))).sign(identity, target);
        assertThrows(OpenPlatformException.class, () -> verifier.authenticate(future::get, target));
        Map<String, String> unknown = new OpenPlatformSigner("local", "unknown", current.getPrivate(), now).sign(identity, target);
        assertThrows(OpenPlatformException.class, () -> verifier.authenticate(unknown::get, target));
        assertThrows(IllegalArgumentException.class, () -> OpenPlatformKeys.privateKey("missing-key"));
        assertThrows(IllegalArgumentException.class, () -> new OpenPlatformVerifier("local", Collections.emptyMap(), now));
    }

    @Test
    void authenticatesBoundIdentityWithoutGivingProvidersSigningAuthority() throws Exception {
        KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
        generator.initialize(2048);
        KeyPair pair = generator.generateKeyPair();
        Clock now = Clock.fixed(Instant.ofEpochSecond(1_000), ZoneOffset.UTC);
        OpenPlatformTarget target = OpenPlatformTarget.http(URI.create("http://orders:8091/query?a=1"), "POST");
        OpenPlatformSigner signer = new OpenPlatformSigner("local", "key-1", pair.getPrivate(), now);
        OpenPlatformVerifier verifier = new OpenPlatformVerifier("local", Collections.singletonMap("key-1", pair.getPublic()), now);
        Map<String, String> identity = new HashMap<>();
        identity.put("x-open-platform-application-id", "application");
        identity.put("x-open-platform-app-key", "app-key");
        identity.put("x-open-platform-tenant-id", "tenant-101");
        identity.put("x-request-id", "request-1");
        Map<String, String> proof = signer.sign(identity, target);
        assertEquals("tenant-101", verifier.authenticate(proof::get, target).getTenantId());
        assertFalse(proof.containsKey("x-open-platform-credential"));
        Map<String, String> tampered = new HashMap<>(proof);
        tampered.put("x-open-platform-tenant-id", "tenant-202");
        assertThrows(OpenPlatformException.class, () -> verifier.authenticate(tampered::get, target));
        OpenPlatformTarget other = OpenPlatformTarget.http(URI.create("http://other:8091/query?a=1"), "POST");
        assertEquals("tenant-101", verifier.authenticate(proof::get, other).getTenantId());
        for (OpenPlatformTarget changed : new OpenPlatformTarget[]{
                OpenPlatformTarget.http(URI.create("http://other/query?a=2"), "POST"),
                OpenPlatformTarget.http(URI.create("http://other/another?a=1"), "POST"),
                OpenPlatformTarget.http(URI.create("http://other/query?a=1"), "GET")}) {
            assertThrows(OpenPlatformException.class, () -> verifier.authenticate(proof::get, changed));
        }
        Map<String, String> v2 = new HashMap<>(proof);
        v2.put("x-open-platform-proof-version", "2");
        assertThrows(OpenPlatformException.class, () -> verifier.authenticate(v2::get, target));
        OpenPlatformVerifier expired = new OpenPlatformVerifier("local", Collections.singletonMap("key-1", pair.getPublic()),
                Clock.offset(now, java.time.Duration.ofSeconds(36)));
        assertThrows(OpenPlatformException.class, () -> expired.authenticate(proof::get, target));
        OpenPlatformVerifier wrongEnvironment = new OpenPlatformVerifier("prod", Collections.singletonMap("key-1", pair.getPublic()), now);
        assertThrows(OpenPlatformException.class, () -> wrongEnvironment.authenticate(proof::get, target));
    }
}
