package io.github.chenyilei2016.openplatform.provider;

import java.security.KeyFactory;
import java.security.PrivateKey;
import java.security.PublicKey;
import java.security.interfaces.RSAKey;
import java.security.spec.PKCS8EncodedKeySpec;
import java.security.spec.X509EncodedKeySpec;
import java.util.Base64;

/** 部署时解析标准PEM或Base64 DER，调用链只复用已解析密钥。 */
public final class OpenPlatformKeys {
    private OpenPlatformKeys() {}

    public static PrivateKey privateKey(String encoded) {
        try {
            PrivateKey key = KeyFactory.getInstance("RSA").generatePrivate(new PKCS8EncodedKeySpec(decode(encoded, "PRIVATE KEY")));
            requireRsa(key);
            return key;
        } catch (Exception invalid) { throw new IllegalArgumentException("网关须配置至少2048位的PKCS#8 RSA私钥"); }
    }

    public static PublicKey publicKey(String encoded) {
        try {
            PublicKey key = KeyFactory.getInstance("RSA").generatePublic(new X509EncodedKeySpec(decode(encoded, "PUBLIC KEY")));
            requireRsa(key);
            return key;
        } catch (Exception invalid) { throw new IllegalArgumentException("提供方须配置至少2048位的X.509 RSA公钥"); }
    }

    static void requireRsa(Object key) {
        if (!(key instanceof RSAKey) || ((RSAKey) key).getModulus().bitLength() < 2048)
            throw new IllegalArgumentException("RSA密钥至少2048位");
    }

    private static byte[] decode(String encoded, String label) {
        if (encoded == null || encoded.length() > 16384) throw new IllegalArgumentException("缺少或非法密钥");
        String base64 = encoded.replace("-----BEGIN " + label + "-----", "")
                .replace("-----END " + label + "-----", "").replaceAll("\\s", "");
        return Base64.getDecoder().decode(base64);
    }
}
