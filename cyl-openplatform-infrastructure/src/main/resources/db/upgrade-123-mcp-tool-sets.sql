-- #123：已有库确认mcp_tool_set、mcp_tool_set_member均不存在后执行；不自动运行。
CREATE TABLE mcp_tool_set (
    id VARCHAR(64) PRIMARY KEY, code VARCHAR(64) NOT NULL, name VARCHAR(100) NOT NULL,
    description VARCHAR(500) NOT NULL DEFAULT '', enabled BOOLEAN NOT NULL DEFAULT TRUE,
    revision BIGINT NOT NULL DEFAULT 0, UNIQUE KEY uk_mcp_tool_set_code (code)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE mcp_tool_set_member (
    tool_set_id VARCHAR(64) NOT NULL, api_id VARCHAR(36) NOT NULL,
    PRIMARY KEY (tool_set_id, api_id),
    FOREIGN KEY (tool_set_id) REFERENCES mcp_tool_set(id) ON DELETE CASCADE,
    INDEX idx_mcp_tool_set_member_api (api_id,tool_set_id)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
