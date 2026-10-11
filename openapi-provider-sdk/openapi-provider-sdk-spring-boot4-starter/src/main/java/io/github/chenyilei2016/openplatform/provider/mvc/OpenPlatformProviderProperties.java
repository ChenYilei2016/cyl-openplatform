package io.github.chenyilei2016.openplatform.provider.mvc;

import org.springframework.boot.context.properties.ConfigurationProperties;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** 提供方只有环境公钥，无网关私钥；不依赖自身HTTP域名或端口配置。 */
@ConfigurationProperties(prefix = "open-platform.provider")
public class OpenPlatformProviderProperties {
    private String environmentId;
    private Map<String, String> publicKeys = new LinkedHashMap<>();
    private List<String> protectedPaths = new ArrayList<>();

    public String getEnvironmentId() { return environmentId; }
    public void setEnvironmentId(String environmentId) { this.environmentId = environmentId; }
    public Map<String, String> getPublicKeys() { return publicKeys; }
    public void setPublicKeys(Map<String, String> publicKeys) { this.publicKeys = publicKeys; }
    public List<String> getProtectedPaths() { return protectedPaths; }
    public void setProtectedPaths(List<String> protectedPaths) { this.protectedPaths = protectedPaths; }
}
