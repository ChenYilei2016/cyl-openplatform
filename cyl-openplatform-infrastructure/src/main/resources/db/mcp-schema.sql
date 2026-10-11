CREATE TABLE IF NOT EXISTS mcp_tenant_activation (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL,
    key_code VARCHAR(40) NOT NULL,
    status VARCHAR(16) NOT NULL,
    disabled_by_platform BOOLEAN NOT NULL DEFAULT FALSE,
    activated_by_employee_no VARCHAR(64) NOT NULL,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    revision BIGINT NOT NULL DEFAULT 0,
    UNIQUE KEY uk_mcp_activation_tenant (tenant_id),
    UNIQUE KEY uk_mcp_activation_key_code (key_code),
    INDEX idx_mcp_activation_created (created_at, id)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS mcp_tool_set (
    environment_id VARCHAR(48) NOT NULL DEFAULT 'local',
    id VARCHAR(64) PRIMARY KEY,
    code VARCHAR(64) NOT NULL,
    name VARCHAR(100) NOT NULL,
    description VARCHAR(500) NOT NULL DEFAULT '',
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    revision BIGINT NOT NULL DEFAULT 0,
    UNIQUE KEY uk_mcp_tool_set_code (environment_id,code)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS mcp_tool_set_member (
    environment_id VARCHAR(48) NOT NULL DEFAULT 'local',
    tool_set_id VARCHAR(64) NOT NULL,
    api_id VARCHAR(36) NOT NULL,
    PRIMARY KEY (tool_set_id, api_id),
    FOREIGN KEY (tool_set_id) REFERENCES mcp_tool_set(id) ON DELETE CASCADE,
    INDEX idx_mcp_tool_set_member_api (api_id,tool_set_id)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
