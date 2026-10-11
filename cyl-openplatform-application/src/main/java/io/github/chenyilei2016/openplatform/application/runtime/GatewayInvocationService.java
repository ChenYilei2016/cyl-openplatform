package io.github.chenyilei2016.openplatform.application.runtime;

import io.github.chenyilei2016.openplatform.application.publication.PublishedApiService;
import io.github.chenyilei2016.openplatform.application.token.TokenVerifier;
import io.github.chenyilei2016.openplatform.application.signature.RequestSignatureVerifier;
import io.github.chenyilei2016.openplatform.domain.signature.SignedRequest;
import io.github.chenyilei2016.openplatform.domain.runtime.InvocationContext;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.github.chenyilei2016.openplatform.domain.observability.CallRecord;
import io.github.chenyilei2016.openplatform.domain.observability.CallMode;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

/** 正式入口只能选择当前启用生效版本，再进入双协议共享执行链。 */
@Service
@RequiredArgsConstructor
public class GatewayInvocationService {
    private final TokenVerifier tokens;
    private final RequestSignatureVerifier signatures;
    private final PublishedApiService publications;
    private final ApiInvocationExecutor executor;

    public Object invoke(String service, String version, String method, String rawToken,
                         Map<String, Object> input, String requestId, String clientIp,
                         CallRecord.CallRecordBuilder observation) {
        try {
            return invokeAuthorized(service, version, method, tokens.verify(rawToken).invocationContext(), input, requestId, clientIp, observation);
        } catch (PlatformException failure) {
            observation.errorCode(failure.getErrorCode().getCode());
            throw failure;
        }
    }

    public Object invokeSigned(String service, String version, String method, SignedRequest signed,
                               Map<String, Object> input, String requestId, String clientIp,
                               CallRecord.CallRecordBuilder observation) {
        try {
            return invokeAuthorized(service, version, method, signatures.verify(signed), input, requestId, clientIp, observation);
        } catch (PlatformException failure) {
            observation.errorCode(failure.getErrorCode().getCode());
            throw failure;
        }
    }

    private Object invokeAuthorized(String service, String version, String method, InvocationContext context,
                                    Map<String, Object> input, String requestId, String clientIp,
                                    CallRecord.CallRecordBuilder observation) {
        observation.applicationId(context.applicationId()).tenantId(context.tenantId())
                .userId(context.userId()).employeeId(context.employeeId()).employeeNo(context.employeeNo());
        var release = publications.requireEnabled(service, version, method);
        observation.releaseId(release.releaseId());
        return executor.execute(release.snapshot(), context, input, requestId, clientIp, CallMode.PRODUCTION, observation).data();
    }
}
