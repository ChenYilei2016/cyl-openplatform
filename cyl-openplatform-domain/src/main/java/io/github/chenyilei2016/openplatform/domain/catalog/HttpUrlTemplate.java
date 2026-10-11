package io.github.chenyilei2016.openplatform.domain.catalog;

import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import java.net.URI;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** 固定HTTP地址中的普通路径占位；不允许业务值改变authority或形成路径结构。 */
public final class HttpUrlTemplate {
    private static final Pattern VARIABLE = Pattern.compile("\\{([a-zA-Z_][a-zA-Z0-9_]{0,63})}");
    private static final int MAX_EXPANDED_LENGTH = 10_240;
    private final String url;
    private final URI literal;
    private final List<String> variables;

    private HttpUrlTemplate(String url, URI literal, List<String> variables) {
        this.url = url;
        this.literal = literal;
        this.variables = variables;
    }

    public static HttpUrlTemplate parse(String url) {
        URI uri;
        try { uri = URI.create(url.replace("{", "%7B").replace("}", "%7D")); }
        catch (IllegalArgumentException invalid) { throw new IllegalArgumentException("HTTP地址格式不合法"); }
        if (!("http".equalsIgnoreCase(uri.getScheme()) || "https".equalsIgnoreCase(uri.getScheme()))
                || uri.getHost() == null || uri.getUserInfo() != null || uri.getFragment() != null
                || uri.getPort() == 0 || uri.getPort() > 65_535)
            throw new IllegalArgumentException("HTTP地址必须是无凭据及fragment、端口有效的http/https地址");
        int pathStart = url.indexOf("://") + 3 + uri.getRawAuthority().length();
        int queryStart = url.indexOf('?', pathStart);
        int pathEnd = queryStart < 0 ? url.length() : queryStart;
        LinkedHashSet<String> names = new LinkedHashSet<>();
        Matcher matcher = VARIABLE.matcher(url);
        while (matcher.find()) {
            if (matcher.start() < pathStart || matcher.end() > pathEnd)
                throw new IllegalArgumentException("占位只能出现在路径中");
            names.add(matcher.group(1));
        }
        if (names.size() > 100) throw new IllegalArgumentException("路径变量超过100项映射上限");
        String remainder = VARIABLE.matcher(url).replaceAll("");
        if (remainder.indexOf('{') >= 0 || remainder.indexOf('}') >= 0)
            throw new IllegalArgumentException("路径仅支持普通{name}占位，不支持正则或URI模板表达式");
        return new HttpUrlTemplate(url, uri, List.copyOf(names));
    }

    public List<String> variables() { return variables; }
    public URI origin() { return URI.create(literal.getScheme() + "://" + literal.getRawAuthority()); }

    public Set<String> fixedQueryNames() {
        Set<String> names = new LinkedHashSet<>();
        if (literal.getRawQuery() != null) for (String pair : literal.getRawQuery().split("&"))
            names.add(URLDecoder.decode(pair.split("=", 2)[0], StandardCharsets.UTF_8));
        return Set.copyOf(names);
    }

    public static boolean validPathValue(Object value) {
        if (!(value instanceof String || value instanceof Number || value instanceof Boolean || value instanceof Character)) return false;
        String text = value.toString();
        return !text.isEmpty() && text.indexOf('/') < 0 && text.indexOf('\\') < 0 && !text.equals(".") && !text.equals("..");
    }

    public URI expand(Map<String, Object> values) {
        if (!variables.containsAll(values.keySet())) throw invalid("存在路径模板未使用的PATH值");
        Matcher matcher = VARIABLE.matcher(url);
        StringBuilder expanded = new StringBuilder();
        while (matcher.find()) {
            String name = matcher.group(1);
            Object value = values.get(name);
            if (!validPathValue(value)) throw invalid("路径变量" + name + "需要非空标量，不能包含斜杠、反斜杠或独立. / ..段");
            String encoded = URLEncoder.encode(value.toString(), StandardCharsets.UTF_8)
                    .replace("+", "%20").replace("*", "%2A").replace("%7E", "~");
            matcher.appendReplacement(expanded, Matcher.quoteReplacement(encoded));
            if (expanded.length() > MAX_EXPANDED_LENGTH) throw invalid("最终HTTP路径和query超过8KiB限制");
        }
        matcher.appendTail(expanded);
        if (expanded.length() > MAX_EXPANDED_LENGTH) throw invalid("最终HTTP路径和query超过8KiB限制");
        URI resolved = URI.create(expanded.toString());
        String ascii = resolved.toASCIIString();
        if (ascii.length() > MAX_EXPANDED_LENGTH) throw invalid("最终HTTP路径和query超过8KiB限制");
        URI result = URI.create(ascii);
        validateExpandedTarget(result);
        return result;
    }

    /** 与Provider proof v3的实际目标上限一致，不把origin计入签名目标。 */
    public static void validateExpandedTarget(URI uri) {
        String target = (uri.getRawPath().isEmpty() ? "/" : uri.getRawPath()) + (uri.getRawQuery() == null ? "" : "?" + uri.getRawQuery());
        if (target.getBytes(StandardCharsets.UTF_8).length > 8192) throw invalid("最终HTTP路径和query超过8KiB限制");
    }

    private static PlatformException invalid(String message) { return new PlatformException(ErrorCode.INVALID_REQUEST, message); }
}
