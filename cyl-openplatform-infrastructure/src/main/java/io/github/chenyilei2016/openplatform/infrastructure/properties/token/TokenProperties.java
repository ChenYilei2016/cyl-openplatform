package io.github.chenyilei2016.openplatform.infrastructure.properties.token;

import io.github.chenyilei2016.openplatform.application.token.TokenSettings;
import java.time.Duration;
import lombok.Getter;
import org.springframework.boot.context.properties.ConfigurationProperties;

@Getter
@ConfigurationProperties("open-platform.token")
public class TokenProperties implements TokenSettings {
    private volatile Duration ttl = Duration.ofDays(7);

    public void setTtl(Duration ttl) {
        Duration value = ttl == null ? Duration.ofDays(7) : ttl;
        if (value.compareTo(Duration.ofMinutes(1)) < 0 || value.compareTo(Duration.ofDays(30)) > 0) {
            throw new IllegalArgumentException("open-platform.token.ttl必须在1分钟至30天之间");
        }
        this.ttl = value;
    }

    @Override
    public Duration ttl() { return ttl; }
}
