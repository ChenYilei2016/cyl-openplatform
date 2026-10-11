-- 119：API列表“MCP工具”筛选的派生列。执行前核对目标环境与列/索引是否存在。
-- 已有定义均未开放MCP，默认值FALSE即与主定义一致，无需回填；不修改定义JSON、修订、发布快照或历史记录。
ALTER TABLE catalog_api_draft ADD COLUMN mcp_tool_enabled BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX idx_catalog_api_mcp_tool ON catalog_api_draft(mcp_tool_enabled,id);
-- 完整工具名唯一约束兜住并发保存；未开放MCP的API不占用唯一键。
ALTER TABLE catalog_api_draft
    ADD COLUMN mcp_tool_name VARCHAR(162) GENERATED ALWAYS AS (CASE WHEN mcp_tool_enabled THEN CONCAT(service,'_',method,'_',REPLACE(REPLACE(version,'.','_'),'-','_')) ELSE NULL END) VIRTUAL,
    ADD UNIQUE KEY uk_catalog_mcp_tool_name (mcp_tool_name);
