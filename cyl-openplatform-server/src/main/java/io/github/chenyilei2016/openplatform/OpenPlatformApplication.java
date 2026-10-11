package io.github.chenyilei2016.openplatform;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;

@SpringBootApplication
@ConfigurationPropertiesScan("io.github.chenyilei2016.openplatform.infrastructure.properties")
public class OpenPlatformApplication {
    public static void main(String[] args) {
        SpringApplication.run(OpenPlatformApplication.class, args);
    }
}
