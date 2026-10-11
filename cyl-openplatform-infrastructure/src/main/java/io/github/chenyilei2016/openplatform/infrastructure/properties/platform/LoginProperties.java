package io.github.chenyilei2016.openplatform.infrastructure.properties.platform;

import java.util.List;
import java.util.Set;
import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;
import jakarta.validation.constraints.NotEmpty;

/** 平台平台会话入口与管理租户边界；客户Token调用不经过此配置。 */
@Getter
@Setter
@Validated
@ConfigurationProperties("open-platform.login")
public class LoginProperties implements io.github.chenyilei2016.openplatform.application.administration.AdministratorTenantPolicy {
    @NotEmpty
    private List<String> requiredPathPatterns = List.of("/admin-api/**", "/portal-api/**");
    @jakarta.validation.constraints.NotNull
    @jakarta.validation.constraints.Size(max = 100)
    private Set<@jakarta.validation.constraints.Pattern(regexp = "[A-Za-z0-9_-]{1,64}") String> adminTenantIds = Set.of();
    @Override public boolean allows(String tenantId) { return adminTenantIds.isEmpty() || adminTenantIds.contains(tenantId); }
}
