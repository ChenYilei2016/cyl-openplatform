package io.github.chenyilei2016.openplatform.domain.catalog;

/** API作为MCP工具的配置；随草稿保存、发布后生效。空白用途说明视为未填写。 */
public record McpToolConfig(boolean enabled, String aiDescription) {
    public static final McpToolConfig DISABLED = new McpToolConfig(false, null);
    /** MCP网关描述字段上限；超出时拒绝，不静默截断。 */
    public static final int AI_DESCRIPTION_LIMIT = 255;

    public McpToolConfig {
        aiDescription = aiDescription == null || aiDescription.isBlank() ? null : aiDescription;
    }
}
