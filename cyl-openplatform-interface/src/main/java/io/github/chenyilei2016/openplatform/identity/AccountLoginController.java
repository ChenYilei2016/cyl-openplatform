package io.github.chenyilei2016.openplatform.identity;

import io.github.chenyilei2016.openplatform.application.identity.AccountAuthentication;
import io.github.chenyilei2016.openplatform.common.ApiResponse;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.RequiredArgsConstructor;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

/** 本地账号入口；租户、员工与管理权限均由服务端身份与授权SPI决定。 */
@org.springframework.boot.autoconfigure.condition.ConditionalOnProperty(name = "open-platform.identity.provider", havingValue = "local", matchIfMissing = true)
@RestController
@RequiredArgsConstructor
public class AccountLoginController {
    private final AccountAuthentication accounts;
    public record LoginRequest(@NotBlank @Size(max = 64) String username, @NotBlank @Size(max = 256) String password) {}
    public record CsrfToken(String token) {}

    @GetMapping("/auth/csrf")
    public ResponseEntity<ApiResponse<CsrfToken>> csrf(HttpServletRequest request) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(ApiResponse.success(new CsrfToken(BrowserSession.csrf(request))));
    }

    @PostMapping("/auth/login")
    public ResponseEntity<ApiResponse<Void>> login(@Valid @RequestBody LoginRequest body, HttpServletRequest request) {
        BrowserSession.requireCsrf(request);
        AccountAuthentication.Account account = accounts.authenticate(body.username(), body.password());
        request.getSession(false).invalidate();
        request.getSession(true).setAttribute(BrowserSession.ACCOUNT, account.username());
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(ApiResponse.success(null));
    }

    @PostMapping("/auth/logout")
    public ResponseEntity<ApiResponse<Void>> logout(HttpServletRequest request) {
        BrowserSession.requireCsrf(request);
        request.getSession(false).invalidate();
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(ApiResponse.success(null));
    }
}
