package io.github.chenyilei2016.openplatform.domain.signature;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.util.HexFormat;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/** 有界原始HTTP输入；签名按原始正文验算，不序列化回JSON。 */
public record SignedRequest(String path, String keyId, String tenantId, String employeeNo,
                            long timestamp, String nonce, String signature, byte[] body) {
    public SignedRequest { body = body.clone(); }
    @Override public byte[] body() { return body.clone(); }

    public boolean verifies(byte[] secret) {
        try {
            String bodyHash = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(body));
            String canonical = String.join("\n", "SZ-HMAC-SHA256", "POST", path, keyId, tenantId,
                    employeeNo == null ? "" : employeeNo, Long.toString(timestamp), nonce, bodyHash);
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret, "HmacSHA256"));
            return MessageDigest.isEqual(mac.doFinal(canonical.getBytes(StandardCharsets.UTF_8)),
                    HexFormat.of().parseHex(signature));
        } catch (GeneralSecurityException failure) {
            throw new IllegalStateException("JVM不支持请求签名算法");
        }
    }

    @Override public String toString() { return "SignedRequest[keyId=" + keyId + "]"; }
}
