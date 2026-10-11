package io.github.chenyilei2016.openplatform.domain.connection;

import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;

/** 精确服务身份；空版本和组表示未设置，不是通配。应用名用于应用级发现定位。 */
public record DubboServiceIdentity(String interfaceName, String version, String group, String providerApplication) {
    public DubboServiceIdentity {
        version = version == null ? "" : version.strip();
        group = group == null ? "" : group.strip();
        providerApplication = providerApplication == null || providerApplication.isBlank() ? null : providerApplication.strip();
        if (interfaceName == null || interfaceName.length() > 200
                || !interfaceName.matches("[a-zA-Z_$][a-zA-Z0-9_$]*(\\.[a-zA-Z_$][a-zA-Z0-9_$]*)+"))
            invalid("请填写合法接口全限定名，最多200字符");
        if (!exact(version) || !exact(group) || providerApplication != null && !exact(providerApplication))
            invalid("内部版本、服务组和应用名最多100字符，不能使用通配或多值");
    }

    public String registryServiceName() {
        return ("providers:" + interfaceName + ":" + version + ":" + group).replace("$", "___");
    }

    private static boolean exact(String value) {
        return value.length() <= 100 && !value.contains("*") && !value.contains(",") && !value.contains(":");
    }
    private static void invalid(String message) { throw new PlatformException(ErrorCode.INVALID_REQUEST, message); }
}
