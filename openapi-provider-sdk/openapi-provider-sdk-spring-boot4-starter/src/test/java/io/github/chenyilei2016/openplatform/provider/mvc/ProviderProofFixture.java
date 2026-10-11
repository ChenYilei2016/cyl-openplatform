package io.github.chenyilei2016.openplatform.provider.mvc;

import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.time.Clock;
import java.util.Collections;
import io.github.chenyilei2016.openplatform.provider.*;

final class ProviderProofFixture {
    static final KeyPair KEYS = keys();
    static final OpenPlatformSigner SIGNER = new OpenPlatformSigner("local", "test", KEYS.getPrivate(), Clock.systemUTC());
    static OpenPlatformVerifier verifier() {
        return new OpenPlatformVerifier("local", Collections.singletonMap("test", KEYS.getPublic()), Clock.systemUTC());
    }
    private static KeyPair keys() {
        try {
            KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
            generator.initialize(2048);
            return generator.generateKeyPair();
        } catch (java.security.GeneralSecurityException failure) { throw new IllegalStateException(failure); }
    }
}
