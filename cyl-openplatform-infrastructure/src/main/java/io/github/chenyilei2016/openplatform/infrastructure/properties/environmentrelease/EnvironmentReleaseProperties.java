package io.github.chenyilei2016.openplatform.infrastructure.properties.environmentrelease;

import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.github.chenyilei2016.openplatform.domain.environmentrelease.EnvironmentReleaseModels.Target;
import io.github.chenyilei2016.openplatform.infrastructure.environmentrelease.EnvironmentReleaseSettings;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HashSet;
import java.util.List;
import lombok.Getter;
import lombok.Setter;
import org.springframework.beans.factory.InitializingBean;
import org.springframework.boot.context.properties.ConfigurationProperties;

/** 运维管理的传输目标及来源信任，配置凭据不参与toString或安全目标视图。 */
@Getter
@Setter
@ConfigurationProperties("open-platform.environment-release")
public class EnvironmentReleaseProperties implements EnvironmentReleaseSettings, InitializingBean {
    private String environmentId = "local";
    private String nodeId = "local";
    private List<RemoteTarget> targets = List.of();
    private List<TrustedSource> trustedSources = List.of();

    @Override public String environmentId() { return environmentId; }
    @Override public String nodeId() { return nodeId; }
    @Override public List<Target> targets() {
        return targets.stream().map(target -> new Target(target.id(), target.name(),
                target.nodes().stream().map(Node::id).toList())).toList();
    }

    @Override
    public void authenticate(String sourceEnvironment, String credential) {
        TrustedSource source = trustedSources.stream().filter(item -> item.id().equals(sourceEnvironment)).findFirst().orElse(null);
        byte[] expected = (source == null ? "0".repeat(32) : source.credential()).getBytes(StandardCharsets.US_ASCII);
        byte[] actual = credential == null || credential.length() > 512 ? new byte[0] : credential.getBytes(StandardCharsets.UTF_8);
        boolean matches = MessageDigest.isEqual(expected, actual);
        if (source == null || !matches) throw new PlatformException(ErrorCode.FORBIDDEN, "跨环境来源身份无效");
    }

    @Override
    public RemoteTarget requireTarget(String id) {
        return targets.stream().filter(target -> target.id().equals(id)).findFirst()
                .orElseThrow(() -> new PlatformException(ErrorCode.INVALID_REQUEST, "跨环境目标未配置"));
    }

    @Override
    public void afterPropertiesSet() {
        if (!validId(environmentId) || !validId(nodeId) || targets == null || targets.size() > 20
                || trustedSources == null || trustedSources.size() > 100) {
            throw new IllegalArgumentException("跨环境身份或目标配置不合法");
        }
        var targetIds = new HashSet<String>();
        for (RemoteTarget target : targets) {
            if (target == null || !validId(target.id()) || !targetIds.add(target.id())
                    || target.name() == null || target.name().isBlank() || target.name().length() > 100
                    || !validCredential(target.credential()) || target.nodes() == null
                    || target.nodes().isEmpty() || target.nodes().size() > 8) {
                throw new IllegalArgumentException("跨环境目标配置不合法");
            }
            var nodeIds = new HashSet<String>();
            var origins = new HashSet<String>();
            for (Node node : target.nodes()) {
                if (node == null || !validId(node.id()) || !nodeIds.add(node.id())) {
                    throw new IllegalArgumentException("跨环境目标节点配置不合法");
                }
                URI origin;
                try { origin = URI.create(node.origin()); }
                catch (RuntimeException invalid) { throw new IllegalArgumentException("跨环境目标地址不合法"); }
                String host = origin.getHost();
                boolean loopback = "127.0.0.1".equals(host) || "[::1]".equals(host);
                if (!("https".equals(origin.getScheme()) || ("http".equals(origin.getScheme()) && loopback))
                        || host == null || origin.getPort() == 0 || origin.getPort() > 65535
                        || origin.getRawUserInfo() != null || origin.getRawQuery() != null || origin.getRawFragment() != null
                        || !origin.getRawPath().isEmpty() || !origins.add(origin.getScheme() + "://"
                                + host.toLowerCase(java.util.Locale.ROOT) + ":"
                                + (origin.getPort() < 0 ? ("https".equals(origin.getScheme()) ? 443 : 80) : origin.getPort()))) {
                    throw new IllegalArgumentException("跨环境目标地址必须为HTTPS或回环HTTP origin且不能重复");
                }
            }
        }
        var sourceIds = new HashSet<String>();
        for (TrustedSource source : trustedSources) {
            if (source == null || !validId(source.id()) || !sourceIds.add(source.id()) || !validCredential(source.credential())) {
                throw new IllegalArgumentException("跨环境来源信任配置不合法");
            }
        }
        targets = targets.stream().map(target -> new RemoteTarget(target.id(), target.name(), target.credential(), List.copyOf(target.nodes()))).toList();
        trustedSources = List.copyOf(trustedSources);
    }

    private static boolean validId(String value) { return value != null && value.matches("[a-z][a-z0-9_-]{0,47}"); }
    private static boolean validCredential(String value) {
        return value != null && value.length() >= 32 && value.length() <= 512
                && value.chars().allMatch(character -> character >= 33 && character <= 126);
    }
}
