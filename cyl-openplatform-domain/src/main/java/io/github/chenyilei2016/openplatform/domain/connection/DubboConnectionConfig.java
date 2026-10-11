package io.github.chenyilei2016.openplatform.domain.connection;

import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import java.net.URI;
import java.util.Set;

/** 注册与元数据中心显式分开；服务及方法来自真实目录或API绑定。 */
public record DubboConnectionConfig(Registry registry, Metadata metadata, DiscoveryMode discoveryMode,
                                    ProviderMetadataMode providerMetadataMode) {
    public enum DiscoveryMode { INTERFACE, APPLICATION }
    public enum ProviderMetadataMode { LOCAL, REMOTE }
    public enum MetadataType { NONE, NACOS, REDIS }

    public record Registry(String address, String namespace, String group, String credentialRef) {
        public Registry {
            namespace = namespace == null ? "" : namespace.strip();
            group = group == null ? "" : group.strip();
            credentialRef = optional(credentialRef);
        }
        public void validate() {
            endpoint(address, Set.of("nacos"));
            if (namespace.length() > 128 || group.isBlank() || group.length() > 128)
                invalid("注册中心namespace最多128字符且必须明确registry group");
            reference(credentialRef);
        }
    }

    public record Metadata(MetadataType type, String address, String namespace, String group,
                           Integer database, String credentialRef) {
        public Metadata {
            address = optional(address);
            namespace = optional(namespace);
            group = optional(group);
            credentialRef = optional(credentialRef);
        }
    }

    public void validate() {
        if (registry == null || metadata == null || metadata.type() == null
                || discoveryMode == null || providerMetadataMode == null) invalid("请明确注册中心、元数据中心及发现兼容模式");
        registry.validate();
        if (metadata.type() == MetadataType.NONE) {
            if (discoveryMode == DiscoveryMode.APPLICATION) invalid("应用级发现必须配置显式元数据中心");
            if (metadata.address() != null || metadata.namespace() != null || metadata.group() != null
                    || metadata.database() != null || metadata.credentialRef() != null)
                invalid("无元数据中心时不能残留地址、命名空间、分组、数据库或凭据引用");
        } else {
            endpoint(metadata.address(), metadata.type() == MetadataType.NACOS ? Set.of("nacos") : Set.of("redis", "rediss"));
            if (metadata.group() == null || metadata.group().length() > 128
                    || metadata.namespace() != null && metadata.namespace().length() > 128)
                invalid("请明确元数据分组，命名空间和分组最多128字符");
            if (metadata.type() == MetadataType.REDIS) {
                if (metadata.database() == null || metadata.database() < 0 || metadata.namespace() != null)
                    invalid("Redis元数据需显式非负database，不能填写Nacos namespace");
            } else if (metadata.database() != null) invalid("Nacos元数据不能填写Redis database");
            reference(metadata.credentialRef());
        }
    }

    private static String optional(String value) { return value == null || value.isBlank() ? null : value.strip(); }

    private static void reference(String value) {
        if (value == null) return;
        if (!value.matches("[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}")) invalid("凭据引用须为1至64位字母、数字、点、下划线或连字符");
    }

    private static void endpoint(String value, Set<String> schemes) {
        try {
            if (value == null || value.length() > 512) invalid("中心地址不能为空或超过512字符");
            URI uri = URI.create(value);
            if (!schemes.contains(uri.getScheme()) || uri.getHost() == null || uri.getPort() < 1 || uri.getPort() > 65535
                    || uri.getRawUserInfo() != null || uri.getRawQuery() != null || uri.getRawFragment() != null
                    || uri.getRawPath() != null && !uri.getRawPath().isEmpty())
                invalid("中心地址必须为明确协议、主机和端口，不能包含路径、参数或用户名密码");
        } catch (IllegalArgumentException failure) {
            invalid("中心地址格式不合法");
        }
    }

    private static void invalid(String message) { throw new PlatformException(ErrorCode.INVALID_REQUEST, message); }
}
