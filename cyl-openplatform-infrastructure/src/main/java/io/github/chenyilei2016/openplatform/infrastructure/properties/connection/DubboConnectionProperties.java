package io.github.chenyilei2016.openplatform.infrastructure.properties.connection;

import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.github.chenyilei2016.openplatform.domain.connection.DubboConnectionConfig;
import io.github.chenyilei2016.openplatform.infrastructure.connection.DubboConnectionSettings;
import java.util.List;
import java.util.Map;
import lombok.Getter;
import lombok.Setter;
import org.springframework.beans.factory.InitializingBean;
import org.springframework.boot.context.properties.ConfigurationProperties;

/** 凭据只留在部署配置；HTTP仅能获得引用名称。服务验证使用环境统一签名。 */
@Getter
@Setter
@ConfigurationProperties("open-platform.dubbo-connections")
public class DubboConnectionProperties implements DubboConnectionSettings, InitializingBean {
    private Map<String, Credential> credentials = Map.of();

    @Override
    public void afterPropertiesSet() {
        if (credentials == null || credentials.size() > 100)
            throw new IllegalArgumentException("Dubbo中心凭据引用最多100项");
        if (credentials.entrySet().stream().anyMatch(entry -> !validRef(entry.getKey()) || entry.getValue() == null
                || entry.getValue().username() != null && entry.getValue().username().length() > 256
                || entry.getValue().password() != null && entry.getValue().password().length() > 512))
            throw new IllegalArgumentException("Dubbo连接凭据引用配置不合法");
        credentials = Map.copyOf(credentials);
    }

    @Override
    public void validateConfiguration(DubboConnectionConfig config) {
        config.validate();
        if (config.registry().credentialRef() != null && !credentials.containsKey(config.registry().credentialRef())
                || config.metadata().credentialRef() != null && !credentials.containsKey(config.metadata().credentialRef()))
            throw new PlatformException(ErrorCode.INVALID_REQUEST, "凭据引用未配置，请从可用引用中选择或联系平台维护者");
    }

    @Override
    public Credential resolveCredential(String reference) {
        if (reference == null || reference.isBlank()) return new Credential(null, null);
        Credential credential = credentials.get(reference);
        if (credential == null) throw new PlatformException(ErrorCode.DEPENDENCY_UNAVAILABLE, "连接中心凭据引用不可用");
        return credential;
    }

    @Override public List<String> registryCredentialRefs() { return credentials.keySet().stream().sorted().toList(); }
    @Override public List<String> metadataCredentialRefs() { return registryCredentialRefs(); }
    @Override public String toString() { return "DubboConnectionProperties[redacted]"; }
    private static boolean validRef(String value) { return value != null && value.matches("[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}"); }
}
