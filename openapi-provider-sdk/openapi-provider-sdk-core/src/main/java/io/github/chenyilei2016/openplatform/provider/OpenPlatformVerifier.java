package io.github.chenyilei2016.openplatform.provider;

import java.security.GeneralSecurityException;
import java.security.PublicKey;
import java.security.Signature;
import java.time.Clock;
import java.util.Base64;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;
import java.util.function.Function;
import java.util.regex.Pattern;

/** 环境公钥验证可信上下文；不持私钥、不在线查询、不改变提供方业务权限。 */
public final class OpenPlatformVerifier {
    private static final Pattern TRACE_PARENT = Pattern.compile("00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}");
    private final String environmentId;
    private final Map<String, PublicKey> publicKeys;
    private final Clock clock;

    public OpenPlatformVerifier(String environmentId, Map<String, PublicKey> publicKeys, Clock clock) {
        OpenPlatformProof.requireId(environmentId, 128);
        if (publicKeys == null || publicKeys.isEmpty() || publicKeys.size() > 2)
            throw new IllegalArgumentException("提供方须配置当前及可选过渡RSA公钥，最多两把");
        for (Map.Entry<String, PublicKey> entry : publicKeys.entrySet()) {
            OpenPlatformProof.requireId(entry.getKey(), 64);
            OpenPlatformKeys.requireRsa(entry.getValue());
        }
        this.environmentId = environmentId;
        this.publicKeys = Collections.unmodifiableMap(new LinkedHashMap<>(publicKeys));
        this.clock = Objects.requireNonNull(clock, "clock");
    }

    public OpenPlatformIdentity authenticate(Function<String, String> singleValues, OpenPlatformTarget target) {
        Map<String, String> headers;
        try {
            if (!OpenPlatformProof.VERSION.equals(singleValues.apply(OpenPlatformProof.PREFIX + "proof-version"))) throw OpenPlatformProof.rejected();
            headers = OpenPlatformProof.read(singleValues);
            if (!environmentId.equals(headers.get(OpenPlatformProof.PREFIX + "environment-id"))) throw OpenPlatformProof.rejected();
            PublicKey key = publicKeys.get(headers.get(OpenPlatformProof.PREFIX + "key-id"));
            if (key == null) throw OpenPlatformProof.rejected();
            String encoded = singleValues.apply(OpenPlatformProof.PREFIX + "signature");
            if (encoded == null || encoded.length() > 2048 || !encoded.matches("[a-zA-Z0-9_-]+")) throw OpenPlatformProof.rejected();
            byte[] signature = Base64.getUrlDecoder().decode(encoded);
            if (!encoded.equals(Base64.getUrlEncoder().withoutPadding().encodeToString(signature))) throw OpenPlatformProof.rejected();
            Signature verifier = Signature.getInstance(OpenPlatformProof.ALGORITHM);
            verifier.initVerify(key);
            verifier.update(OpenPlatformProof.encode(headers, target));
            if (!verifier.verify(signature)) throw OpenPlatformProof.rejected();
            requireCurrentProof(headers);
        } catch (GeneralSecurityException | IllegalArgumentException | OpenPlatformException failure) {
            throw OpenPlatformProof.rejected();
        }
        String traceParent = singleValues.apply("traceparent");
        String traceId = traceParent != null && TRACE_PARENT.matcher(traceParent).matches()
                && !traceParent.substring(3, 35).equals("00000000000000000000000000000000")
                && !traceParent.substring(36, 52).equals("0000000000000000") ? traceParent.substring(3, 35) : null;
        return OpenPlatformProof.identity(headers, traceId);
    }

    private void requireCurrentProof(Map<String, String> headers) {
        long issuedAt = timestamp(headers.get(OpenPlatformProof.PREFIX + "issued-at"));
        long expiresAt = timestamp(headers.get(OpenPlatformProof.PREFIX + "expires-at"));
        long now = clock.instant().getEpochSecond();
        if (expiresAt - issuedAt != OpenPlatformProof.LIFETIME_SECONDS
                || issuedAt > now + OpenPlatformProof.CLOCK_SKEW_SECONDS
                || expiresAt < now - OpenPlatformProof.CLOCK_SKEW_SECONDS) throw OpenPlatformProof.rejected();
    }

    private static long timestamp(String value) {
        if (value == null || !value.matches("0|[1-9][0-9]{0,18}")) throw OpenPlatformProof.rejected();
        return Long.parseLong(value);
    }
}
