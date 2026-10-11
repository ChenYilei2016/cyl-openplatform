package io.github.chenyilei2016.openplatform.provider;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Locale;

/** 由网关绑定及提供方实际入口分别构造；HTTP仅绑定方法/路径/query；域名与端口不作为身份。 */
public final class OpenPlatformTarget {
    private final List<String> fields;

    private OpenPlatformTarget(List<String> fields) {
        this.fields = Collections.unmodifiableList(fields);
    }

    public static OpenPlatformTarget http(URI uri, String method) {
        origin(uri); // 仍校验URL语法，站点不参与v3签名。
        if (!Arrays.asList("GET", "POST", "PUT", "PATCH", "DELETE").contains(method))
            throw new IllegalArgumentException("HTTP方法不支持");
        String path = uri.getRawPath().isEmpty() ? "/" : uri.getRawPath();
        String query = uri.getRawQuery() == null ? "" : uri.getRawQuery();
        if ((path + query).getBytes(StandardCharsets.UTF_8).length > 8192)
            throw new IllegalArgumentException("HTTP路径与查询过长");
        return new OpenPlatformTarget(Arrays.asList("HTTP", method, path, query));
    }

    public static String origin(URI uri) {
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
        if (!(scheme.equals("http") || scheme.equals("https")) || uri.getHost() == null
                || uri.getUserInfo() != null || uri.getFragment() != null
                || uri.getPort() == 0 || uri.getPort() > 65535)
            throw new IllegalArgumentException("HTTP地址必须是无凭据及fragment的HTTP/HTTPS地址");
        String host = uri.getHost().toLowerCase(Locale.ROOT);
        int port = uri.getPort();
        boolean defaultPort = port < 0 || scheme.equals("http") && port == 80 || scheme.equals("https") && port == 443;
        String origin = scheme + "://" + host + (defaultPort ? "" : ":" + port);
        if (origin.length() > 512) throw new IllegalArgumentException("HTTP origin过长");
        return origin;
    }

    public static OpenPlatformTarget dubbo(String interfaceName, String version, String group,
                                            String method, List<String> parameterTypes) {
        requireText(interfaceName, 200, false);
        requireText(method, 100, false);
        requireText(version == null ? "" : version, 100, true);
        requireText(group == null ? "" : group, 100, true);
        if (parameterTypes == null || parameterTypes.size() > 20)
            throw new IllegalArgumentException("Dubbo参数类型最多20项");
        List<String> fields = new ArrayList<>(Arrays.asList("DUBBO", interfaceName,
                version == null ? "" : version, group == null ? "" : group, method,
                Integer.toString(parameterTypes.size())));
        for (String type : parameterTypes) {
            requireText(type, 200, false);
            fields.add(type);
        }
        return new OpenPlatformTarget(fields);
    }

    private static void requireText(String value, int max, boolean emptyAllowed) {
        if (value == null || value.length() > max || !emptyAllowed && value.isEmpty()
                || value.chars().anyMatch(c -> Character.isWhitespace(c) || Character.isISOControl(c)))
            throw new IllegalArgumentException("Dubbo目标字段不合法");
    }

    List<String> fields() { return fields; }
}
