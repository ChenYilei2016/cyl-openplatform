package io.github.chenyilei2016.openplatform.application.signature;

import io.github.chenyilei2016.openplatform.application.access.AccessAuditService;
import io.github.chenyilei2016.openplatform.domain.access.AccessOperator;
import io.github.chenyilei2016.openplatform.domain.access.ApplicationKind;
import io.github.chenyilei2016.openplatform.domain.access.ApplicationRepository;
import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.github.chenyilei2016.openplatform.domain.signature.*;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.Arrays;
import java.util.Base64;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class SigningKeyService {
    private final SigningKeyRepository keys;
    private final SigningSecretCipher cipher;
    private final ApplicationRepository applications;
    private final AccessAuditService audits;
    private final SecureRandom random = new SecureRandom();

    public record KeyView(boolean configured, SigningKey key) {}
    public record IssuedKey(SigningKey key, String signingSecret) {
        @Override public String toString() { return "IssuedKey[key=" + key + ", signingSecret=REDACTED]"; }
    }

    public boolean configured() {
        return cipher.configured();
    }

    /** kind 为调用入口所管理的凭据类型：普通凭据页与“MCP 接入”页互不能操作对方的密钥。 */
    public KeyView get(String applicationId, ApplicationKind kind) {
        applications.find(applicationId).orElseThrow(() -> new PlatformException(ErrorCode.NOT_FOUND, "应用不存在")).requireKind(kind);
        return new KeyView(cipher.configured(), keys.findByApplication(applicationId).orElse(null));
    }

    public IssuedKey issue(String applicationId, ApplicationKind kind, long expectedRevision, boolean rotate, AccessOperator operator) {
        return audits.change(rotate ? "ROTATE_SIGNING_KEY" : "CREATE_SIGNING_KEY", applicationId, null, applicationId, operator, () -> {
            applications.lock(applicationId).requireKind(kind);
            var previous = keys.findByApplication(applicationId).orElse(null);
            checkRevision(previous, expectedRevision);
            boolean active = previous != null && previous.status() == SigningKeyStatus.ACTIVE;
            if (rotate != active) throw new PlatformException(ErrorCode.CONFLICT, rotate ? "当前没有可轮换的签名密钥" : "签名密钥已存在，请使用轮换操作");
            if (!cipher.configured()) throw new PlatformException(ErrorCode.DEPENDENCY_UNAVAILABLE, "签名密钥服务尚未配置");
            var now = Instant.now();
            var key = new SigningKey(UUID.randomUUID().toString().replace("-", ""), applicationId,
                    expectedRevision + 1, SigningKeyStatus.ACTIVE, previous == null ? now : previous.createdAt(), now);
            byte[] secret = new byte[32];
            random.nextBytes(secret);
            try {
                keys.save(key, cipher.encrypt(key, secret));
                return new IssuedKey(key, Base64.getUrlEncoder().withoutPadding().encodeToString(secret));
            } finally { Arrays.fill(secret, (byte) 0); }
        });
    }

    public SigningKey revoke(String applicationId, ApplicationKind kind, long expectedRevision, AccessOperator operator) {
        return audits.change("REVOKE_SIGNING_KEY", applicationId, null, applicationId, operator, () -> {
            applications.lock(applicationId).requireKind(kind);
            var current = keys.findByApplication(applicationId).orElse(null);
            checkRevision(current, expectedRevision);
            if (current == null) throw new PlatformException(ErrorCode.CONFLICT, "当前没有可撤销的签名密钥");
            if (current.status() == SigningKeyStatus.REVOKED) return current;
            var revoked = new SigningKey(current.keyId(), applicationId, current.revision() + 1,
                    SigningKeyStatus.REVOKED, current.createdAt(), Instant.now());
            keys.save(revoked, null);
            return revoked;
        });
    }

    /** 每次按当前版本重读密文，调用方用完后清空返回的字节数组。 */
    public byte[] requireSecret(SigningKey key) {
        if (key.status() != SigningKeyStatus.ACTIVE) throw new PlatformException(ErrorCode.INVALID_CREDENTIALS, "签名密钥无效");
        var secret = keys.findSecret(key).orElseThrow(() -> new PlatformException(ErrorCode.INVALID_CREDENTIALS, "签名密钥无效"));
        return cipher.decrypt(key, secret);
    }

    private void checkRevision(SigningKey current, long expectedRevision) {
        if (expectedRevision < 0 || expectedRevision > 9007199254740990L)
            throw new PlatformException(ErrorCode.INVALID_REQUEST, "签名密钥版本不合法");
        if ((current == null ? 0 : current.revision()) != expectedRevision)
            throw new PlatformException(ErrorCode.CONFLICT, "签名密钥已变更，请重新读取后操作");
    }
}
