package io.github.chenyilei2016.openplatform.provider;

import java.security.GeneralSecurityException;
import java.security.PrivateKey;
import java.security.Signature;
import java.time.Clock;
import java.util.Base64;
import java.util.Map;
import java.util.Objects;

/** 仅网关使用的环境签名器；提供方部署不持私钥。 */
public final class OpenPlatformSigner {
    private final String environmentId;
    private final String keyId;
    private final PrivateKey privateKey;
    private final Clock clock;

    public OpenPlatformSigner(String environmentId, String keyId, PrivateKey privateKey, Clock clock) {
        OpenPlatformProof.requireId(environmentId, 128);
        OpenPlatformProof.requireId(keyId, 64);
        OpenPlatformKeys.requireRsa(privateKey);
        this.environmentId = environmentId;
        this.keyId = keyId;
        this.privateKey = privateKey;
        this.clock = Objects.requireNonNull(clock, "clock");
    }

    public Map<String, String> sign(Map<String, String> identityHeaders, OpenPlatformTarget target) {
        Map<String, String> values = OpenPlatformProof.read(identityHeaders::get);
        OpenPlatformProof.identity(values, null);
        long issuedAt = clock.instant().getEpochSecond();
        values.put(OpenPlatformProof.PREFIX + "key-id", keyId);
        values.put(OpenPlatformProof.PREFIX + "environment-id", environmentId);
        values.put(OpenPlatformProof.PREFIX + "issued-at", Long.toString(issuedAt));
        values.put(OpenPlatformProof.PREFIX + "expires-at", Long.toString(issuedAt + OpenPlatformProof.LIFETIME_SECONDS));
        values.put(OpenPlatformProof.PREFIX + "proof-version", OpenPlatformProof.VERSION);
        try {
            Signature signer = Signature.getInstance(OpenPlatformProof.ALGORITHM);
            signer.initSign(privateKey);
            signer.update(OpenPlatformProof.encode(values, target));
            values.put(OpenPlatformProof.PREFIX + "signature", Base64.getUrlEncoder().withoutPadding().encodeToString(signer.sign()));
            return values;
        } catch (GeneralSecurityException failure) {
            throw new IllegalStateException("网关身份签名失败", failure);
        }
    }
}
