package io.github.chenyilei2016.openplatform.web.openapi.signature;

import io.github.chenyilei2016.openplatform.application.runtime.GatewayInvocationService;
import io.github.chenyilei2016.openplatform.common.ApiResponse;
import io.github.chenyilei2016.openplatform.web.shared.observability.CallObservation;
import io.github.chenyilei2016.openplatform.web.shared.runtime.GatewayRequestReader;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import lombok.RequiredArgsConstructor;
import org.slf4j.MDC;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

/** 独立HMAC认证的正式调用；生效API与后续治理、权限、提供方执行复用原链。 */
@RestController
@RequiredArgsConstructor
public class SignatureGatewayController {
    private final GatewayInvocationService gateway;
    private final SignatureRequestReader signatures;
    private final GatewayRequestReader requests;

    @PostMapping(value = "/api/sign/{service}/{version}/{method}", consumes = "application/json")
    public ApiResponse<Object> invoke(@PathVariable String service, @PathVariable String version,
                                     @PathVariable String method, HttpServletRequest request,
                                     HttpServletResponse response) throws IOException {
        response.setHeader("Cache-Control", "no-store");
        var signed = signatures.read(request, service, version, method);
        var observation = CallObservation.current(request);
        return ApiResponse.success(gateway.invokeSigned(service, version, method, signed,
                requests.parseObject(signed.body()), MDC.get("requestId"), observation.build().clientIp(), observation));
    }
}
