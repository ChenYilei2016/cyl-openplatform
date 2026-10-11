package io.github.chenyilei2016.openplatform.infrastructure.properties.identity;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

/** 受控配置中的本地账号目录；账号规模限定为1000，变更后重启。 */
@Validated
@ConfigurationProperties("open-platform.accounts")
@lombok.Getter
@lombok.Setter
public class LocalAccountProperties {
    @Valid @Size(max = 1000)
    private List<User> users = List.of();
    public record User(
            @NotBlank @Pattern(regexp = "[a-zA-Z0-9._-]{1,64}") String username,
            @NotBlank @Pattern(regexp = "[a-fA-F0-9]{96}") String passwordHash,
            @NotBlank @Size(max = 64) String tenantId,
            @NotBlank @Size(max = 100) String tenantName,
            @NotBlank @Size(max = 64) String userId,
            @NotBlank @Size(max = 64) String employeeId,
            @NotBlank @Size(max = 64) String employeeNo,
            @NotBlank @Size(max = 100) String displayName,
            boolean enabled) {}
}
