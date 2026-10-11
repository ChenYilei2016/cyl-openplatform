package io.github.chenyilei2016.openplatform.application.token;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import java.time.Clock;

@Configuration(proxyBeanMethods = false)
public class TokenTimeConfiguration {
    @Bean
    public Clock tokenClock() { return Clock.systemUTC(); }
}
