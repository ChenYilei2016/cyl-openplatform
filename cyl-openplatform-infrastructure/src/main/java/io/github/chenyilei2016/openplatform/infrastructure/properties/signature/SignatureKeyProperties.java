package io.github.chenyilei2016.openplatform.infrastructure.properties.signature;

import io.github.chenyilei2016.openplatform.infrastructure.signature.SignatureKeySettings;
import java.util.LinkedHashMap;
import java.util.Map;
import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;

@Getter @Setter
@ConfigurationProperties("open-platform.signature")
public class SignatureKeyProperties implements SignatureKeySettings {
    private String activeWrappingKeyId;
    private Map<String, String> wrappingKeys = new LinkedHashMap<>();
}
