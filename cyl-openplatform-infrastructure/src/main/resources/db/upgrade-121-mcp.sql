-- Spec121：已有库先核对information_schema，确认access_application.kind与mcp_gateway_slot两列、
-- uk_application_mcp_gateway索引及mcp_tenant_activation表均不存在后执行一次；只缺部分时先核对实际结构，不重复执行整份脚本。
-- 不加入启动自动迁移。已有凭据全部成为STANDARD，不改变授权版本、状态、权限组、AppSecret或签名密钥。
-- mcp_gateway_slot为虚拟生成列：仅MCP_GATEWAY行为1，唯一约束保证每环境只有一个MCP网关凭据。
ALTER TABLE access_application
    ADD COLUMN kind VARCHAR(16) NOT NULL DEFAULT 'STANDARD',
    ADD COLUMN mcp_gateway_slot TINYINT GENERATED ALWAYS AS (CASE WHEN kind = 'MCP_GATEWAY' THEN 1 ELSE NULL END) VIRTUAL,
    ADD UNIQUE KEY uk_application_mcp_gateway (mcp_gateway_slot);

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
