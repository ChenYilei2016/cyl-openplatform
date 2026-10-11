package io.github.chenyilei2016.openplatform.web.openapi.token;

import io.github.chenyilei2016.openplatform.web.shared.token.BearerToken;
import io.github.chenyilei2016.openplatform.application.token.TokenIssueCommand;
import io.github.chenyilei2016.openplatform.application.token.TokenLifecycleService;
import io.github.chenyilei2016.openplatform.application.token.TokenResponse;
import io.github.chenyilei2016.openplatform.application.token.TokenVerifier;
import io.github.chenyilei2016.openplatform.common.ApiResponse;
import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.github.chenyilei2016.openplatform.domain.token.TokenContext;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import lombok.RequiredArgsConstructor;
import org.slf4j.MDC;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import java.util.Map;

/** 面向接入应用的Token生命周期入口，采用应用凭据或Bearer，不使用后台Cookie建立身份。 */
@RestController
@RequestMapping("/api/token")
@RequiredArgsConstructor
public class TokenController {
    private final TokenLifecycleService lifecycle;
    private final TokenVerifier verifier;

    public record IssueRequest(@NotBlank @Pattern(regexp = "[a-f0-9]{32}") String appKey,
                               @NotBlank @Size(max = 128) String appSecret, @NotBlank @Size(max = 64) String tenantId,
                               @Size(min = 1, max = 64) @Pattern(regexp = ".*\\S.*") String employeeNo,
                               @Size(max = 128) String existingToken) {
        @Override public String toString() { return "IssueRequest[appKey=" + appKey + ",tenantId=" + tenantId + "]"; }
    }
    public record RefreshRequest(@NotBlank @Pattern(regexp = "[a-f0-9]{32}") String appKey,
                                 @NotBlank @Size(max = 128) String appSecret) {
        @Override public String toString() { return "RefreshRequest[appKey=" + appKey + "]"; }
    }

    @PostMapping
    public ApiResponse<TokenResponse> issue(@Valid @RequestBody IssueRequest body, HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store");
        return ApiResponse.success(lifecycle.issue(new TokenIssueCommand(body.appKey(), body.appSecret(), body.tenantId(),
                body.employeeNo(), body.existingToken()), MDC.get("requestId")));
    }

    @PostMapping("/refresh")
    public ApiResponse<TokenResponse> refresh(@Valid @RequestBody RefreshRequest body, HttpServletRequest request, HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store");
        return ApiResponse.success(lifecycle.refresh(BearerToken.read(request), body.appKey(), body.appSecret(), MDC.get("requestId")));
    }

    @PostMapping("/introspect")
    public ApiResponse<TokenContext> introspect(@RequestBody(required = false) Map<String, Object> body,
                                               HttpServletRequest request, HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store");
        if (body != null && !body.isEmpty()) throw new PlatformException(ErrorCode.INVALID_REQUEST, "校验请求不能覆盖Token上下文");
        return ApiResponse.success(verifier.verify(BearerToken.read(request)));
    }

    @PostMapping("/revoke")
    public ApiResponse<Void> revoke(@RequestBody(required = false) Map<String, Object> body,
                                   HttpServletRequest request, HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store");
        if (body != null && !body.isEmpty()) throw new PlatformException(ErrorCode.INVALID_REQUEST, "撤销请求不能指定其他Token或身份");
        lifecycle.revokeSelf(BearerToken.read(request), MDC.get("requestId"));
        return ApiResponse.success(null);
    }


}
