CREATE TABLE IF NOT EXISTS access_scope (
    id VARCHAR(36) PRIMARY KEY,
    code VARCHAR(64) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL,
    enabled BOOLEAN NOT NULL,
    default_for_new_application BOOLEAN NOT NULL,
    public_access BOOLEAN NOT NULL DEFAULT FALSE
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS access_application (
    id VARCHAR(36) PRIMARY KEY,
    app_key VARCHAR(64) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL,
    owner_tenant_id VARCHAR(64) NOT NULL,
    status VARCHAR(16) NOT NULL,
    authorization_version BIGINT NOT NULL DEFAULT 0,
    secret_digest VARCHAR(64) NOT NULL,
    kind VARCHAR(16) NOT NULL DEFAULT 'STANDARD',
    -- 仅 MCP_GATEWAY 行为 1，其余为 NULL：唯一约束保证每环境只有一个 MCP 网关凭据。
    mcp_gateway_slot TINYINT GENERATED ALWAYS AS (CASE WHEN kind = 'MCP_GATEWAY' THEN 1 ELSE NULL END),
    UNIQUE KEY uk_application_mcp_gateway (mcp_gateway_slot)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS access_application_scope (
    application_id VARCHAR(36) NOT NULL,
    scope_code VARCHAR(64) NOT NULL,
    PRIMARY KEY (application_id, scope_code),
    FOREIGN KEY (application_id) REFERENCES access_application(id),
    FOREIGN KEY (scope_code) REFERENCES access_scope(code)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS access_audit (
    id VARCHAR(36) PRIMARY KEY,
    application_id VARCHAR(36),
    action VARCHAR(40) NOT NULL,
    operator_tenant_id VARCHAR(64) NOT NULL,
    operator_employee_no VARCHAR(64) NOT NULL,
    operator_user_id VARCHAR(64) NULL,
    operator_employee_id VARCHAR(64) NULL,
    tenant_grant_id VARCHAR(36) NULL,
    target_user_id VARCHAR(64) NULL,
    target_employee_id VARCHAR(64) NULL,
    target_employee_no VARCHAR(64) NULL,
    target_tenant_id VARCHAR(64),
    target_id VARCHAR(64),
    outcome VARCHAR(16) NOT NULL,
    summary VARCHAR(100) NOT NULL,
    request_id VARCHAR(64) NOT NULL,
    occurred_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    INDEX idx_access_audit_operator_tenant (operator_tenant_id, occurred_at, id),
    INDEX idx_access_audit_target (target_id, occurred_at, id),
    INDEX idx_access_audit_operator (operator_employee_no, occurred_at, id),
    INDEX idx_access_audit_application (application_id, occurred_at, id),
    INDEX idx_access_audit_time (occurred_at,id),
    INDEX idx_access_audit_request (request_id,occurred_at,id)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS access_tenant_grant (
    id VARCHAR(36) PRIMARY KEY,
    application_id VARCHAR(36) NOT NULL,
    tenant_id VARCHAR(64) NOT NULL,
    status VARCHAR(16) NOT NULL,
    authorization_version BIGINT NOT NULL DEFAULT 0,
    note VARCHAR(100) NOT NULL DEFAULT '',
    note_revision BIGINT NOT NULL DEFAULT 0,
    UNIQUE (application_id, tenant_id),
    INDEX idx_tenant_grant_tenant (tenant_id,id),
    FOREIGN KEY (application_id) REFERENCES access_application(id)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS access_user_grant (
    id VARCHAR(36) PRIMARY KEY,
    tenant_grant_id VARCHAR(36) NOT NULL,
    tenant_id VARCHAR(64) NOT NULL,
    user_id VARCHAR(64) NOT NULL,
    employee_id VARCHAR(64) NOT NULL,
    employee_no VARCHAR(64) NOT NULL,
    display_name VARCHAR(100) NOT NULL,
    status VARCHAR(16) NOT NULL,
    authorization_version BIGINT NOT NULL DEFAULT 0,
    UNIQUE (tenant_grant_id, employee_id),
    UNIQUE (tenant_grant_id, employee_no),
    UNIQUE (tenant_grant_id, user_id),
    FOREIGN KEY (tenant_grant_id) REFERENCES access_tenant_grant(id)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS access_employee_profile (
    id VARCHAR(36) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL,
    tenant_name VARCHAR(100),
    employee_id VARCHAR(64) NOT NULL,
    user_id VARCHAR(64) NOT NULL,
    employee_no VARCHAR(64) NOT NULL,
    display_name VARCHAR(100) NOT NULL,
    last_seen_at TIMESTAMP(6) NOT NULL,
    UNIQUE KEY uk_employee_profile_identity (tenant_id,employee_id),
    INDEX idx_employee_profile_seen (tenant_id,last_seen_at),
    INDEX idx_employee_profile_number (tenant_id,employee_no),
    INDEX idx_employee_profile_name (tenant_id,display_name,employee_no)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- 118 租户权限：把权限组开通给指定租户，只用于 MCP 工具可用性与门户展示；撤销保留记录。
CREATE TABLE IF NOT EXISTS access_tenant_scope_grant (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL,
    scope_code VARCHAR(64) NOT NULL,
    status VARCHAR(16) NOT NULL,
    granted_by_tenant_id VARCHAR(64) NOT NULL,
    granted_by_employee_no VARCHAR(64) NOT NULL,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    revision BIGINT NOT NULL DEFAULT 0,
    UNIQUE KEY uk_tenant_scope_grant (tenant_id,scope_code),
    INDEX idx_tenant_scope_grant_scope (scope_code,status,updated_at,id),
    FOREIGN KEY (scope_code) REFERENCES access_scope(code)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
