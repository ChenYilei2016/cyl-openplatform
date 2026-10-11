package io.github.chenyilei2016.openplatform.infrastructure.common;

/** 包含搜索的统一转义规则，用户输入的%/_按字面匹配。 */
public final class SqlPatterns {
    private SqlPatterns() {}
    public static String contains(String query) {
        return "%" + (query == null ? "" : query.replace("!", "!!").replace("%", "!%").replace("_", "!_")) + "%";
    }
}
