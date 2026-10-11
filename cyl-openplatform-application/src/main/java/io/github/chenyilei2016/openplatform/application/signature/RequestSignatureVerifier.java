package io.github.chenyilei2016.openplatform.application.signature;

import io.github.chenyilei2016.openplatform.application.access.ApplicationAuthorizationService;
import io.github.chenyilei2016.openplatform.domain.access.ApplicationKind;
import io.github.chenyilei2016.openplatform.domain.access.ApplicationRepository;
import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.github.chenyilei2016.openplatform.domain.runtime.InvocationContext;
import io.github.chenyilei2016.openplatform.domain.signature.SignatureReplayGuard;
import io.github.chenyilei2016.openplatform.domain.signature.SignedRequest;
import io.github.chenyilei2016.openplatform.domain.signature.SigningKeyRepository;
import io.github.chenyilei2016.openplatform.domain.signature.SigningKeyStatus;
import java.util.Arrays;
import java.util.concurrent.Semaphore;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

/** 独立凭据验证后复用当前授权；远程人员核验在事务外，之后重核所有授权与密钥。 */
@Service
@RequiredArgsConstructor
public class RequestSignatureVerifier {
    private final SigningKeyRepository keys;
    private final SigningKeyService secrets;
    private final ApplicationRepository applications;
    private final ApplicationAuthorizationService authorizations;
    private final SignatureReplayGuard replays;
    private final Semaphore inFlight = new Semaphore(32);

    public InvocationContext verify(SignedRequest request) {
        if (!inFlight.tryAcquire()) throw new PlatformException(ErrorCode.RATE_LIMITED, "签名验证并发已满");
        try {
            var key = keys.findByKeyId(request.keyId()).orElseThrow(this::invalid);
            if (key.status() != SigningKeyStatus.ACTIVE) throw invalid();
            byte[] secret = secrets.requireSecret(key);
            try { if (!request.verifies(secret)) throw invalid(); }
            finally { Arrays.fill(secret, (byte) 0); }
            // 普通签名入口只接受 STANDARD 凭据；MCP 网关凭据的密钥在此按签名无效拒绝。
            var app = applications.find(key.applicationId())
                    .filter(found -> found.kind() == ApplicationKind.STANDARD).orElseThrow(this::invalid);
            var authorization = authorizations.forTarget(app, request.tenantId(), request.employeeNo());
            authorizations.verifyEmployee(authorization);
            var current = authorizations.current(authorization.subject());
            if (!current.matches(authorization.subject(), authorization.versions(), authorization.scopeCodes())
                    || !keys.findByKeyId(key.keyId()).filter(key::equals).isPresent()) throw invalid();
            replays.consume(key.keyId(), request.nonce(), request.timestamp());
            return current.invocationContext();
        } catch (PlatformException failure) {
            if (failure.getErrorCode() == ErrorCode.INVALID_CREDENTIALS || failure.getErrorCode() == ErrorCode.INVALID_TOKEN) throw invalid();
            throw failure;
        } catch (RuntimeException failure) {
            throw new PlatformException(ErrorCode.DEPENDENCY_UNAVAILABLE, "签名或授权依赖暂不可用", failure);
        } finally { inFlight.release(); }
    }

    private PlatformException invalid() { return new PlatformException(ErrorCode.INVALID_SIGNATURE, "签名无效或密钥已失效"); }
}
