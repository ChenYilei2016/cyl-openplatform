package io.github.chenyilei2016.openplatform.application.common;

import java.util.regex.Pattern;

/** 复制及管理诊断共用的敏感字段与文本规则。 */
public final class SensitiveValues {
    private SensitiveValues() {}
    public static final Pattern SENSITIVE = Pattern.compile("xopenplatformsignature|signature|authorization|cookie|setcookie|password|passwd|secret|appsecret|signingsecret|token|accesstoken|refreshtoken|apikey|xapikey|xszsignature|clientsecret|credential|credentials|accesskey|secretkey|privatekey|accesskeyid|accesskeysecret", Pattern.CASE_INSENSITIVE);
    public static final Pattern BEARER = Pattern.compile("\\bBearer\\s+[^\\s\"',}]+", Pattern.CASE_INSENSITIVE);
    public static final Pattern INLINE_SECRET = Pattern.compile("(?i)(client[_-]?secret|app[_-]?secret|access[_-]?token|refresh[_-]?token|token|secret|password|credential|signature|authorization|private[_-]?key|api[_-]?key)[\"']?\\s*[:=]\\s*(?:\"(?:\\\\.|[^\"\\\\])*\"|'(?:\\\\.|[^'\\\\])*'|[^\\s,;]+)");
    public static boolean sensitiveName(String name) {
        return SENSITIVE.matcher(name.replace("-", "").replace("_", "")).matches();
    }
    public static String redactText(String value) {
        return INLINE_SECRET.matcher(BEARER.matcher(value).replaceAll("[已脱敏]")).replaceAll("[已脱敏]");
    }
}
