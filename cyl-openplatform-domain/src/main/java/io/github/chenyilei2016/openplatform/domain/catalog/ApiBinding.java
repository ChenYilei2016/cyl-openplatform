package io.github.chenyilei2016.openplatform.domain.catalog;

import io.github.chenyilei2016.openplatform.domain.common.FieldValidation;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;

public record ApiBinding(ApiProtocol protocol, int timeoutMillis, Http http, Dubbo dubbo) {
    private static final Pattern JAVA_IDENTIFIER = Pattern.compile("[a-zA-Z_$][a-zA-Z0-9_$]*");
    private static final Pattern JAVA_TYPE = Pattern.compile("(?:boolean|byte|short|int|long|float|double|char|[a-zA-Z_$][a-zA-Z0-9_$]*(?:\\.[a-zA-Z_$][a-zA-Z0-9_$]*)+)(?:\\[\\])*");
    private static final Set<String> HTTP_METHODS = Set.of("GET", "POST", "PUT", "PATCH", "DELETE");

    public enum HttpTargetMode { URL, SERVICE_NAME }
    public record Http(String url, String method, HttpTargetMode targetMode, String serviceName, String path,
                       String sourceClass, String sourceMethod) {
        public Http(String url, String method) { this(url, method, null, null, null, null, null); }
        public HttpTargetMode effectiveTargetMode() { return targetMode == null ? HttpTargetMode.URL : targetMode; }
        public boolean discovered() { return effectiveTargetMode() == HttpTargetMode.SERVICE_NAME; }
        public boolean hasJsonBody() { return Set.of("POST", "PUT", "PATCH").contains(method); }
        /** 发现前只校验路径与参数；占位主机从不用于出站。 */
        public String templateUrl() { return discovered() ? "http://discovery.invalid" + path : url; }
        public HttpUrlTemplate template() { return HttpUrlTemplate.parse(templateUrl()); }
        public String targetField() { return discovered() ? "/binding/http/path" : "/binding/http/url"; }
        public static boolean validServiceName(String value) {
            return value != null && value.length() <= 200 && value.matches("[a-zA-Z0-9_][a-zA-Z0-9_.-]*");
        }
    }
    public record Dubbo(String interfaceName, String method, String version, String group, List<String> parameterTypes,
                        String connectionId, Long connectionRevision, String providerApplication) {
        public io.github.chenyilei2016.openplatform.domain.connection.DubboServiceIdentity identity() {
            return new io.github.chenyilei2016.openplatform.domain.connection.DubboServiceIdentity(interfaceName, version, group, providerApplication);
        }
        public Dubbo { parameterTypes = parameterTypes == null ? List.of() : List.copyOf(parameterTypes); }
    }

    public void validate() {
        FieldValidation checks = new FieldValidation();
        checks.check(protocol != null, "/protocol", "请选择提供方协议");
        checks.check(timeoutMillis >= 100 && timeoutMillis <= 30_000, "/timeoutMillis", "超时须为100至30000毫秒");
        checks.inspect("", this::validateTarget);
        checks.requireValid();
    }

    private void validateTarget() {
        if (protocol == null) return;
        if (protocol == ApiProtocol.HTTP) {
            if (http == null || dubbo != null) invalidAt("/http", "HTTP绑定不完整或混入Dubbo字段");
            FieldValidation httpChecks = new FieldValidation();
            if (http.discovered()) {
                httpChecks.check(Http.validServiceName(http.serviceName), "/http/serviceName", "服务名必填，不超过200字符，使用字母、数字、点、下划线或短横线");
                httpChecks.check(http.path != null && http.path.startsWith("/") && !http.path.startsWith("//") && http.path.length() <= 1976,
                        "/http/path", "请求路径须以单个/开头且不超过1976字符");
            } else httpChecks.check(http.url != null && http.url.length() <= 2000, "/http/url", "HTTP地址必填且不超过2000字符");
            httpChecks.check(HTTP_METHODS.contains(http.method == null ? "" : http.method), "/http/method", "HTTP方法不支持");
            httpChecks.check(http.sourceClass == null || http.sourceClass.isEmpty() || http.sourceClass.length() <= 1024
                            && http.sourceClass.contains(".") && JAVA_TYPE.matcher(http.sourceClass).matches() && !http.sourceClass.endsWith("[]"),
                    "/http/sourceClass", "内部类请填写Java全限定类名，最多1024字符；可留空");
            httpChecks.check(http.sourceMethod == null || http.sourceMethod.isEmpty() || http.sourceMethod.length() <= 128 && JAVA_IDENTIFIER.matcher(http.sourceMethod).matches(),
                    "/http/sourceMethod", "内部方法请填写Java方法名，最多128字符；可留空");
            httpChecks.requireValid();
            try {
                http.template();
            } catch (IllegalArgumentException exception) { invalidAt(http.discovered() ? "/http/path" : "/http/url", exception.getMessage()); }
        } else {
            if (dubbo == null || http != null || dubbo.interfaceName == null
                    || !JAVA_TYPE.matcher(dubbo.interfaceName).matches() || !dubbo.interfaceName.contains(".") || dubbo.interfaceName.endsWith("[]")
                    || dubbo.method == null || !JAVA_IDENTIFIER.matcher(dubbo.method).matches()
                    || (dubbo.version != null && (dubbo.version.length() > 100 || (!dubbo.version.isEmpty() && dubbo.version.isBlank()) || (dubbo.version.contains("*") || dubbo.version.contains(","))))
                    || (dubbo.group != null && (dubbo.group.length() > 100 || (dubbo.group.contains("*") || dubbo.group.contains(",")))) || dubbo.parameterTypes.size() > 20) invalidAt("/dubbo", "Dubbo绑定不完整或混入HTTP字段");
            if ((dubbo.connectionId == null) != (dubbo.connectionRevision == null)
                    || (dubbo.connectionId != null && (dubbo.connectionId.isBlank() || dubbo.connectionId.length() > 36
                    || dubbo.connectionRevision <= 0))) invalidAt("/dubbo/connectionRevision", "Dubbo连接ID与正整数修订必须同时填写");
            FieldValidation identity = new FieldValidation();
            identity.inspect("/dubbo", dubbo::identity);
            identity.requireValid();
            if (dubbo.parameterTypes.stream().anyMatch(type -> type.length() > 200 || !JAVA_TYPE.matcher(type).matches())) invalidAt("/dubbo/parameterTypes", "Dubbo参数类型不合法");
        }
    }

    private static void invalidAt(String path, String message) {
        throw FieldValidation.invalid(path, FieldValidation.Reason.INVALID_VALUE, message);
    }
}
