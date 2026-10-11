package io.github.chenyilei2016.openplatform.infrastructure.signature;

import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.github.chenyilei2016.openplatform.domain.signature.*;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.Base64;
import java.util.HashMap;
import java.util.Map;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.stereotype.Component;

/** 版本化AES-GCM封装：v1 + Base64(12字节IV || 32字节密文 || 16字节认证标签)。 */
@Component
public class AesGcmSigningSecretCipher implements SigningSecretCipher {
    private final Map<String, SecretKeySpec> wrappingKeys;
    private final String activeKeyId;
    private final SecureRandom random = new SecureRandom();

    public AesGcmSigningSecretCipher(SignatureKeySettings properties) {
        var configured = properties.getWrappingKeys();
        this.activeKeyId = properties.getActiveWrappingKeyId();
        if (configured == null || configured.size() > 4) throw new IllegalArgumentException("签名主密钥配置不合法");
        Map<String, SecretKeySpec> decoded = new HashMap<>();
        try {
            for (var entry : configured.entrySet()) {
                if (!entry.getKey().matches("[a-zA-Z0-9_-]{1,32}")) throw new IllegalArgumentException();
                byte[] bytes = Base64.getDecoder().decode(entry.getValue());
                try {
                    if (bytes.length != 32) throw new IllegalArgumentException();
                    decoded.put(entry.getKey(), new SecretKeySpec(bytes, "AES"));
                } finally { Arrays.fill(bytes, (byte) 0); }
            }
            if (!(decoded.isEmpty() && (activeKeyId == null || activeKeyId.isBlank())) && !decoded.containsKey(activeKeyId))
                throw new IllegalArgumentException();
        } catch (RuntimeException invalid) { throw new IllegalArgumentException("签名主密钥配置不合法"); }
        this.wrappingKeys = Map.copyOf(decoded);
    }

    @Override public boolean configured() { return !wrappingKeys.isEmpty(); }

    @Override public SigningSecret encrypt(SigningKey key, byte[] secret) {
        if (!configured()) throw unavailable();
        if (secret.length != 32) throw new IllegalArgumentException("签名密钥必须为256位");
        byte[] iv = new byte[12]; random.nextBytes(iv);
        try {
            var cipher = cipher(Cipher.ENCRYPT_MODE, key, wrappingKeys.get(activeKeyId), iv);
            byte[] encrypted = cipher.doFinal(secret);
            return new SigningSecret(activeKeyId, "v1:" + Base64.getEncoder().encodeToString(
                    ByteBuffer.allocate(iv.length + encrypted.length).put(iv).put(encrypted).array()));
        } catch (GeneralSecurityException exception) { throw unavailable(); }
    }

    @Override public byte[] decrypt(SigningKey key, SigningSecret secret) {
        if (secret.wrappingKeyId() == null) throw unavailable();
        var wrappingKey = wrappingKeys.get(secret.wrappingKeyId());
        if (wrappingKey == null) throw unavailable();
        try {
            if (secret.encryptedSecret() == null || !secret.encryptedSecret().startsWith("v1:") || secret.encryptedSecret().length() != 83)
                throw unavailable();
            byte[] envelope = Base64.getDecoder().decode(secret.encryptedSecret().substring(3));
            if (envelope.length != 60) throw unavailable();
            return cipher(Cipher.DECRYPT_MODE, key, wrappingKey, Arrays.copyOf(envelope, 12)).doFinal(envelope, 12, 48);
        } catch (GeneralSecurityException | IllegalArgumentException invalid) { throw unavailable(); }
    }

    private Cipher cipher(int mode, SigningKey key, SecretKeySpec wrappingKey, byte[] iv) throws GeneralSecurityException {
        var cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(mode, wrappingKey, new GCMParameterSpec(128, iv));
        cipher.updateAAD(("sz-signing-key-v1\n" + key.applicationId() + "\n" + key.keyId()).getBytes(StandardCharsets.UTF_8));
        return cipher;
    }
    private PlatformException unavailable() { return new PlatformException(ErrorCode.DEPENDENCY_UNAVAILABLE, "签名密钥服务暂不可用"); }
}
