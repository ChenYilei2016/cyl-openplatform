CREATE TABLE IF NOT EXISTS publication_release (
    environment_id VARCHAR(48) NOT NULL DEFAULT 'local',
    INDEX idx_release_environment(environment_id,status,submitted_at,id),
 id VARCHAR(36) PRIMARY KEY, api_id VARCHAR(36) NOT NULL, name VARCHAR(100) NOT NULL,
 category VARCHAR(100), lifecycle_status VARCHAR(16),
 mcp_tool_enabled BOOLEAN NOT NULL DEFAULT FALSE,
 service VARCHAR(64) NOT NULL, version VARCHAR(32) NOT NULL, method VARCHAR(64) NOT NULL,
 draft_revision BIGINT NOT NULL, status VARCHAR(16) NOT NULL, audit_required BOOLEAN NOT NULL,
 submitted_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), submitted_by_tenant_id VARCHAR(64) NOT NULL, submitted_by_employee_no VARCHAR(64) NOT NULL,
 reviewed_at TIMESTAMP(6) NULL DEFAULT NULL, reviewed_by_tenant_id VARCHAR(64), reviewed_by_employee_no VARCHAR(64),
 failure_reason VARCHAR(500), submission_key VARCHAR(36) NOT NULL, UNIQUE KEY uk_release_environment_submission (environment_id,submission_key), comment VARCHAR(500) NOT NULL,
    dubbo_connection_id VARCHAR(36) NULL,
    dubbo_connection_revision BIGINT NULL,
 review_comment VARCHAR(500), snapshot_json LONGTEXT NOT NULL,
 baseline_json LONGTEXT NULL, baseline_known BOOLEAN NOT NULL DEFAULT FALSE,
 kind VARCHAR(16) NOT NULL DEFAULT 'STANDARD', source_release_id VARCHAR(36) NULL,
 baseline_release_id VARCHAR(36) NULL, baseline_state_version BIGINT NULL,
 FOREIGN KEY(api_id) REFERENCES catalog_api_draft(id),
 INDEX idx_publication_release_status(status,submitted_at,id), INDEX idx_publication_release_api(api_id,submitted_at,id),
 INDEX idx_release_dubbo_connection(dubbo_connection_id,id),
 INDEX idx_release_mcp_tool(mcp_tool_enabled,api_id),
 INDEX idx_publication_release_category(category,id)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS publication_release_scope (
    environment_id VARCHAR(48) NOT NULL DEFAULT 'local',
 release_id VARCHAR(36) NOT NULL, scope_code VARCHAR(64) NOT NULL,
 PRIMARY KEY(release_id,scope_code),
 FOREIGN KEY(release_id) REFERENCES publication_release(id)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS publication_state (
    environment_id VARCHAR(48) NOT NULL DEFAULT 'local',
    INDEX idx_state_environment(environment_id,api_id),
 api_id VARCHAR(36) PRIMARY KEY, state_version BIGINT NOT NULL, enabled BOOLEAN NOT NULL,
 live_release_id VARCHAR(36), pending_release_id VARCHAR(36),
 FOREIGN KEY(api_id) REFERENCES catalog_api_draft(id),
 FOREIGN KEY(live_release_id) REFERENCES publication_release(id),
 FOREIGN KEY(pending_release_id) REFERENCES publication_release(id)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS publication_audit (
    environment_id VARCHAR(48) NOT NULL DEFAULT 'local',
    INDEX idx_publication_audit_environment(environment_id,occurred_at,id),
 id VARCHAR(36) PRIMARY KEY, api_id VARCHAR(36) NOT NULL, release_id VARCHAR(36), action VARCHAR(40) NOT NULL,
 operator_tenant_id VARCHAR(64) NOT NULL, operator_employee_no VARCHAR(64) NOT NULL,
 outcome VARCHAR(16) NOT NULL, summary VARCHAR(500) NOT NULL, request_id VARCHAR(64) NOT NULL, occurred_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 INDEX idx_publication_audit_operator_tenant (operator_tenant_id, occurred_at, id),
    INDEX idx_publication_audit_operator (operator_employee_no, occurred_at, id),
    INDEX idx_publication_audit_api(api_id,occurred_at,id),
    INDEX idx_publication_audit_time (occurred_at,id),
    INDEX idx_publication_audit_request (request_id,occurred_at,id)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
