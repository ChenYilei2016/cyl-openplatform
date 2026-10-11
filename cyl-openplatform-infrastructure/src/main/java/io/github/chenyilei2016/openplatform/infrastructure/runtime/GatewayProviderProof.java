package io.github.chenyilei2016.openplatform.infrastructure.runtime;

import io.github.chenyilei2016.openplatform.domain.runtime.InvocationContext;
import io.github.chenyilei2016.openplatform.infrastructure.properties.gateway.GatewayProviderProperties;
import io.github.chenyilei2016.openplatform.provider.OpenPlatformKeys;
import io.github.chenyilei2016.openplatform.provider.OpenPlatformSigner;
import io.github.chenyilei2016.openplatform.provider.OpenPlatformTarget;
import java.time.Clock;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.stereotype.Component;
import org.springframework.beans.factory.annotation.Value;

/** 唯一的可信身份到线协议适配；HTTP/Dubbo不再各自维护凭据和身份附件。 */
@Component
public final class GatewayProviderProof {
    private static final String PREFIX = "x-open-platform-";
    private final OpenPlatformSigner signer;

    public GatewayProviderProof(GatewayProviderProperties properties,
                                @Value("${open-platform.environment-release.environment-id:}") String environmentId) {
        signer = new OpenPlatformSigner(environmentId, properties.getKeyId(),
                OpenPlatformKeys.privateKey(properties.getPrivateKey()), Clock.systemUTC());
    }

    public Map<String, String> headers(InvocationContext context, OpenPlatformTarget target, String requestId) {
        Map<String, String> identity = new LinkedHashMap<>();
        identity.put(PREFIX + "application-id", context.applicationId());
        identity.put(PREFIX + "app-key", context.appKey());
        identity.put(PREFIX + "tenant-id", context.tenantId());
        identity.put("x-request-id", requestId);
        if (context.userId() != null || context.employeeId() != null || context.employeeNo() != null) {
            context.requireEmployee();
            identity.put(PREFIX + "user-id", context.userId());
            identity.put(PREFIX + "employee-id", context.employeeId());
            identity.put(PREFIX + "employee-no", context.employeeNo());
        }
        return signer.sign(identity, target);
    }
}
