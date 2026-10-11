package io.github.chenyilei2016.openplatform.testing;

import io.github.chenyilei2016.openplatform.provider.*;
import io.github.chenyilei2016.openplatform.infrastructure.runtime.GatewayProviderProof;
import io.github.chenyilei2016.openplatform.infrastructure.properties.gateway.GatewayProviderProperties;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.GeneralSecurityException;
import java.util.Base64;
import java.time.Clock;
import java.util.Collections;

/** 每个测试JVM临时生成RSA密钥，不在源码中保存私钥。 */
public final class ProviderProofTestSupport {
    private static final KeyPair KEYS = generateKeys();
    public static final String PRIVATE_KEY = Base64.getEncoder().encodeToString(KEYS.getPrivate().getEncoded());
    public static final String PUBLIC_KEY = Base64.getEncoder().encodeToString(KEYS.getPublic().getEncoded());
    public static final OpenPlatformSigner SIGNER = new OpenPlatformSigner("local", "test", OpenPlatformKeys.privateKey(PRIVATE_KEY), Clock.systemUTC());
    public static OpenPlatformVerifier verifier() {
        return new OpenPlatformVerifier("local", Collections.singletonMap("test", OpenPlatformKeys.publicKey(PUBLIC_KEY)), Clock.systemUTC());
    }
    public static GatewayProviderProof gateway() {
        GatewayProviderProperties properties = new GatewayProviderProperties();
        properties.setKeyId("test"); properties.setPrivateKey(PRIVATE_KEY);
        return new GatewayProviderProof(properties, "local");
    }
    private static KeyPair generateKeys() {
        try {
            KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
            generator.initialize(2048);
            return generator.generateKeyPair();
        } catch (GeneralSecurityException failure) {
            throw new IllegalStateException("测试JVM不支持RSA", failure);
        }
    }
}
