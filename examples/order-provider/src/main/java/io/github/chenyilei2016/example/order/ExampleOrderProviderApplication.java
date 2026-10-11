package io.github.chenyilei2016.example.order;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.jackson.autoconfigure.JsonMapperBuilderCustomizer;
import org.springframework.context.annotation.Bean;
import tools.jackson.core.StreamReadFeature;
import tools.jackson.databind.DeserializationFeature;

@SpringBootApplication(excludeName = "org.springframework.cloud.openfeign.FeignAutoConfiguration")
public class ExampleOrderProviderApplication {
    @Bean
    JsonMapperBuilderCustomizer strictOrderJson() {
        return builder -> builder.enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
                .enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION);
    }

    public static void main(String[] args) {
        SpringApplication.run(ExampleOrderProviderApplication.class, args);
    }
}
