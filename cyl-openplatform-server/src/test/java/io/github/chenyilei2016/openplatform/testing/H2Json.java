package io.github.chenyilei2016.openplatform.testing;

/** H2 的 MySQL 模式不提供 JSON_VALUE/JSON_CONTAINS；仅为集成测试补齐生产 SQL 用到的路径与语义。 */
public final class H2Json {
    private static final tools.jackson.databind.json.JsonMapper JSON =
            tools.jackson.databind.json.JsonMapper.builder().build();

    private H2Json() {}

    public static String value(String document, String path) {
        if (!"$.category".equals(path))
            throw new IllegalArgumentException("Unsupported test JSON path: " + path);
        tools.jackson.databind.JsonNode node = JSON.readTree(document).get("category");
        return node == null || node.isNull() ? null : node.asText();
    }

    /** 与 MySQL 一致：路径不存在时返回 NULL；数组包含候选值返回 1，否则 0。 */
    public static Integer contains(String document, String candidate, String path) {
        if (!"$.scopeCodes".equals(path))
            throw new IllegalArgumentException("Unsupported test JSON path: " + path);
        if (document == null) return null;
        tools.jackson.databind.JsonNode node = JSON.readTree(document).get("scopeCodes");
        if (node == null || node.isNull()) return null;
        tools.jackson.databind.JsonNode expected = JSON.readTree(candidate);
        for (tools.jackson.databind.JsonNode item : node) if (item.equals(expected)) return 1;
        return 0;
    }
}
