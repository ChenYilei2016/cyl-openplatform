package io.github.chenyilei2016.openplatform.application.mcp;

import io.github.chenyilei2016.openplatform.application.signature.SigningKeyService;
import io.github.chenyilei2016.openplatform.domain.access.ClientApplication;
import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.github.chenyilei2016.openplatform.domain.signature.SignatureReplayGuard;
import io.github.chenyilei2016.openplatform.domain.signature.SignedRequest;
import io.github.chenyilei2016.openplatform.domain.signature.SigningKey;
import io.github.chenyilei2016.openplatform.domain.signature.SigningKeyRepository;
import io.github.chenyilei2016.openplatform.domain.signature.SigningKeyStatus;
import java.util.Arrays;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

/** MCP只验证网关机器凭据，不走普通应用的租户关联或人员委托；HMAC与跨实例防重放复用既有实现。 */
@Service
@RequiredArgsConstructor
public class McpSignatureVerifier {
    private final SigningKeyRepository keys;
    private final SigningKeyService secrets;
    private final McpGatewayCredentialService gateways;
    private final SignatureReplayGuard replays;

    public record VerifiedGateway(SigningKey key, ClientApplication application) {}

    public VerifiedGateway verify(SignedRequest request) {
        try {
            SigningKey key = keys.findByKeyId(request.keyId()).filter(value -> value.status() == SigningKeyStatus.ACTIVE)
                    .orElseThrow(McpSignatureVerifier::invalid);
            byte[] secret = secrets.requireSecret(key);
            try { if (!request.verifies(secret)) throw invalid(); }
            finally { Arrays.fill(secret, (byte) 0); }
            replays.consume(key.keyId(), request.nonce(), request.timestamp());
            return new VerifiedGateway(key, gateways.requireActiveGateway(key));
        } catch (PlatformException failure) {
            if (failure.getErrorCode() == ErrorCode.INVALID_CREDENTIALS) throw invalid();
            throw failure;
        } catch (RuntimeException failure) {
            throw new PlatformException(ErrorCode.DEPENDENCY_UNAVAILABLE, "MCP签名验证暂不可用", failure);
        }
    }

    /** 远程人员核验后重新读取密钥与网关状态，避免核验期间的轮换/停用被旧快照绕过。 */
    public ClientApplication current(VerifiedGateway verified) {
        SigningKey current = keys.findByKeyId(verified.key().keyId()).filter(verified.key()::equals)
                .orElseThrow(McpSignatureVerifier::invalid);
        return gateways.requireActiveGateway(current);
    }

    private static PlatformException invalid() { return new PlatformException(ErrorCode.INVALID_SIGNATURE, "签名无效或密钥已失效"); }
}
