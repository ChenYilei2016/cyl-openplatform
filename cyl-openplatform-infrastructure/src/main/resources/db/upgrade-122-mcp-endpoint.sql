-- #122 生效目录索引与MCP调用元数据。升级前先核对对应列与索引不存在；不自动运行。
ALTER TABLE publication_release ADD COLUMN mcp_tool_enabled BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX idx_release_mcp_tool ON publication_release(mcp_tool_enabled,api_id);
-- 兼容已在开发环境保存的119快照；只回填派生列，不改变快照、审核状态或生效指针。
UPDATE publication_release SET mcp_tool_enabled=TRUE WHERE JSON_UNQUOTE(JSON_EXTRACT(snapshot_json,'$.mcpTool.enabled'))='true';
ALTER TABLE platform_call_record ADD COLUMN channel VARCHAR(16) NOT NULL DEFAULT 'API', ADD COLUMN tool_name VARCHAR(64);
CREATE INDEX idx_call_channel ON platform_call_record(channel,occurred_at,id);
