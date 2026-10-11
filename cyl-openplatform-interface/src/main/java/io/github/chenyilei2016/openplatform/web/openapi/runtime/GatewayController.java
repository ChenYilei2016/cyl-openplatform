package io.github.chenyilei2016.openplatform.web.openapi.runtime;

import io.github.chenyilei2016.openplatform.web.shared.runtime.GatewayRequestReader;
import io.github.chenyilei2016.openplatform.application.runtime.GatewayInvocationService;
import io.github.chenyilei2016.openplatform.common.ApiResponse;
import io.github.chenyilei2016.openplatform.web.shared.observability.CallObservation;
import io.github.chenyilei2016.openplatform.web.shared.token.BearerToken;
import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import java.util.Collections;
import java.util.Locale;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import lombok.RequiredArgsConstructor;
import org.slf4j.MDC;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

/** 面向外部应用的生效API调用；可信身份只取Token，治理与调用记录覆盖两种协议。 */
@RestController
@RequiredArgsConstructor
public class GatewayController {
    private final GatewayInvocationService gateway;
    private final GatewayRequestReader requests;

    @PostMapping(value = "/api/oauth/{service}/{version}/{method}", consumes = "application/json")
    public ApiResponse<Object> invoke(@PathVariable String service, @PathVariable String version,
                                      @PathVariable String method, HttpServletRequest request,
                                      HttpServletResponse response) throws IOException {
        response.setHeader("Cache-Control", "no-store");
        var authentication = Collections.list(request.getHeaders("Authorization"));
        if (authentication.size() > 1 || authentication.stream().anyMatch(value -> value.contains(",") || value.startsWith("SZ-HMAC-SHA256 "))
                || Collections.list(request.getHeaderNames()).stream().anyMatch(header -> header.toLowerCase(Locale.ROOT).startsWith("x-sz-"))) {
            throw new PlatformException(
                    ErrorCode.INVALID_REQUEST, "不能混合或重复提供认证信息");
        }
        var observation = CallObservation.current(request);
        return ApiResponse.success(gateway.invoke(service, version, method, BearerToken.read(request),
                requests.readObject(request), MDC.get("requestId"), observation.build().clientIp(), observation));
    }
}
