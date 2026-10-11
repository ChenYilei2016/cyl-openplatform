-- CYL Open Platform：全新MySQL 8.4空库初始化（表结构 + 首位管理员资格）。
-- 不包含登录密码、数据库账号密码、Provider密钥或演示API。
-- 先选择已创建的空库；Compose自动选择cyl_openplatform。不可用于现有库升级。
-- 由 scripts/export-init-sql.py 生成；修改分模块Schema或bootstrap-admin.sql后重新生成。
SET NAMES utf8mb4;

-- Source: cyl-openplatform-infrastructure/src/main/resources/db/access-schema.sql
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

-- Source: cyl-openplatform-infrastructure/src/main/resources/db/mcp-schema.sql
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

-- Source: cyl-openplatform-infrastructure/src/main/resources/db/catalog-schema.sql
CREATE TABLE IF NOT EXISTS catalog_api_draft (
    environment_id VARCHAR(48) NOT NULL DEFAULT 'local',
    INDEX idx_api_environment(environment_id,id),
    portal_visible BOOLEAN NOT NULL DEFAULT TRUE,
    id VARCHAR(36) PRIMARY KEY,
    service VARCHAR(64) NOT NULL,
    version VARCHAR(32) NOT NULL,
    method VARCHAR(64) NOT NULL,
    name VARCHAR(100) NOT NULL,
    category VARCHAR(100) NOT NULL,
    owner VARCHAR(100) NOT NULL,
    protocol VARCHAR(16) NOT NULL,
    draft_revision BIGINT NOT NULL,
    dubbo_connection_id VARCHAR(36) NULL,
    dubbo_connection_revision BIGINT NULL,
    definition_json LONGTEXT NOT NULL,
    internal_class VARCHAR(1024) NULL,
    internal_method VARCHAR(128) NULL,
    mcp_tool_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    mcp_tool_name VARCHAR(162) GENERATED ALWAYS AS (CASE WHEN mcp_tool_enabled THEN CONCAT(service,'_',method,'_',REPLACE(REPLACE(version,'.','_'),'-','_')) ELSE NULL END),
    UNIQUE KEY uk_catalog_mcp_tool_name (environment_id,mcp_tool_name),
    INDEX idx_catalog_api_category (category,id),
    INDEX idx_catalog_api_mcp_tool (mcp_tool_enabled,id),
    INDEX idx_catalog_dubbo_connection (dubbo_connection_id, id),
    INDEX idx_catalog_api_owner (owner,id),
    UNIQUE KEY uk_catalog_environment_operation (environment_id, service, version, method)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS catalog_audit (
    environment_id VARCHAR(48) NOT NULL DEFAULT 'local',
    INDEX idx_catalog_audit_environment(environment_id,occurred_at,id),
    id VARCHAR(36) PRIMARY KEY,
    api_id VARCHAR(36) NOT NULL,
    draft_revision BIGINT NOT NULL,
    action VARCHAR(40) NOT NULL,
    operator_tenant_id VARCHAR(64) NOT NULL,
    operator_employee_no VARCHAR(64) NOT NULL,
    request_id VARCHAR(64) NOT NULL,
    occurred_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    INDEX idx_catalog_audit_operator_tenant (operator_tenant_id, occurred_at, id),
    INDEX idx_catalog_audit_operator (operator_employee_no, occurred_at, id),
    INDEX idx_catalog_audit_api (api_id, occurred_at, id),
    INDEX idx_catalog_audit_time (occurred_at,id),
    INDEX idx_catalog_audit_request (request_id,occurred_at,id)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS catalog_api_revision (
    environment_id VARCHAR(48) NOT NULL DEFAULT 'local',
    api_id VARCHAR(36) NOT NULL,
    revision BIGINT NOT NULL,
    source VARCHAR(40) NOT NULL,
    operator_tenant_id VARCHAR(64) NULL,
    operator_employee_no VARCHAR(64) NULL,
    recorded_at TIMESTAMP(6) NOT NULL,
    history_start BOOLEAN NOT NULL,
    content_digest VARCHAR(64) NOT NULL,
    digest_version VARCHAR(40) NOT NULL,
    snapshot_json LONGTEXT NOT NULL,
    restored_from_revision BIGINT NULL,
    PRIMARY KEY (api_id, revision),
    FOREIGN KEY (api_id) REFERENCES catalog_api_draft(id)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- Spec52：仅新增导入回执表；不改既有API，不自动执行。上线前核对同名表并备份。
CREATE TABLE IF NOT EXISTS catalog_api_import_request (
    environment_id VARCHAR(48) NOT NULL DEFAULT 'local',
    tenant_id VARCHAR(64) NOT NULL,
    employee_no VARCHAR(64) NOT NULL,
    submission_key VARCHAR(36) NOT NULL,
    content_digest VARCHAR(64) NOT NULL,
    source_kind VARCHAR(16) NOT NULL,
    source_digest VARCHAR(64) NOT NULL,
    result_json LONGTEXT,
    PRIMARY KEY (environment_id, tenant_id, employee_no, submission_key)
);

-- Spec52：新增API修订到导入回执的精确关联；不执行自动迁移、不存来源原文/文件名/凭据。
-- 前置：catalog_api_import_request已存在。部署前核对同名表与库默认字符集，取得授权后单独执行。
-- 仅后续成功CREATE/UPDATE记录来源；旧无关联修订显示“未知”，不扫描result_json、不全库回填。
CREATE TABLE IF NOT EXISTS catalog_api_import_revision (
    environment_id VARCHAR(48) NOT NULL DEFAULT 'local',
    api_id VARCHAR(36) NOT NULL,
    revision BIGINT NOT NULL,
    operator_tenant_id VARCHAR(64) NOT NULL,
    operator_employee_no VARCHAR(64) NOT NULL,
    submission_key VARCHAR(36) NOT NULL,
    PRIMARY KEY (api_id,revision),
    INDEX idx_import_revision_receipt (operator_tenant_id,operator_employee_no,submission_key),
    FOREIGN KEY (environment_id,operator_tenant_id,operator_employee_no,submission_key)
      REFERENCES catalog_api_import_request(environment_id,tenant_id,employee_no,submission_key)
);
-- 92：仅新增分类与名称别名表。既有草稿/发布/修订JSON不改写。
-- 存量名称由配套准备脚本从草稿、发布和修订中去重登记；运行前需获得本环境授权。
CREATE TABLE IF NOT EXISTS catalog_category (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    revision BIGINT NOT NULL DEFAULT 1,
    INDEX idx_catalog_category_name(enabled,name,id)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS catalog_category_alias (
    category_key VARCHAR(100) PRIMARY KEY,
    category_id VARCHAR(36) NOT NULL,
    INDEX idx_catalog_category_alias_id(category_id),
    FOREIGN KEY (category_id) REFERENCES catalog_category(id)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- Source: cyl-openplatform-infrastructure/src/main/resources/db/api-copy-schema.sql
CREATE TABLE IF NOT EXISTS catalog_api_copy_request (
    environment_id VARCHAR(48) NOT NULL DEFAULT 'local',
 tenant_id VARCHAR(64) NOT NULL,
 employee_no VARCHAR(64) NOT NULL,
 creation_key VARCHAR(36) NOT NULL,
 content_digest VARCHAR(64) NOT NULL,
 result_json LONGTEXT,
 PRIMARY KEY (environment_id, tenant_id, employee_no, creation_key)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- Source: cyl-openplatform-infrastructure/src/main/resources/db/dubbo-connection-schema.sql
CREATE TABLE IF NOT EXISTS dubbo_connection (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    environment_id VARCHAR(48) NOT NULL,
    description VARCHAR(2000) NOT NULL,
    draft_revision BIGINT NOT NULL,
    active_revision BIGINT,
    enabled BOOLEAN NOT NULL,
    state_version BIGINT NOT NULL,
    updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    INDEX idx_dubbo_connection_environment (environment_id,updated_at,id),
    INDEX idx_dubbo_connection_selectable (environment_id,enabled,active_revision,id)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS dubbo_connection_revision (
    id VARCHAR(64) PRIMARY KEY,
    connection_id VARCHAR(36) NOT NULL,
    revision BIGINT NOT NULL,
    config_json LONGTEXT NOT NULL,
    metadata_type VARCHAR(16) NOT NULL,
    discovery_mode VARCHAR(16) NOT NULL,
    provider_metadata_mode VARCHAR(16) NOT NULL,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    UNIQUE KEY uk_dubbo_connection_revision (connection_id,revision),
    FOREIGN KEY (connection_id) REFERENCES dubbo_connection(id)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- Source: cyl-openplatform-infrastructure/src/main/resources/db/token-schema.sql
CREATE TABLE IF NOT EXISTS platform_token (
    id VARCHAR(36) PRIMARY KEY,
    token_digest VARCHAR(64) NOT NULL UNIQUE,
    application_id VARCHAR(36) NOT NULL,
    app_key VARCHAR(32) NOT NULL,
    tenant_grant_id VARCHAR(36) NOT NULL,
    tenant_id VARCHAR(64) NOT NULL,
    user_grant_id VARCHAR(36),
    user_id VARCHAR(64),
    employee_id VARCHAR(64),
    employee_no VARCHAR(64),
    application_version BIGINT NOT NULL,
    tenant_version BIGINT NOT NULL,
    user_version BIGINT NOT NULL,
    scope_codes VARCHAR(6500) NOT NULL,
    status VARCHAR(16) NOT NULL,
    issued_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    expires_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    INDEX idx_token_application (application_id, issued_at, id),
    INDEX idx_token_expiry (expires_at),
    FOREIGN KEY (application_id) REFERENCES access_application(id),
    FOREIGN KEY (tenant_grant_id) REFERENCES access_tenant_grant(id),
    FOREIGN KEY (user_grant_id) REFERENCES access_user_grant(id)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS token_audit (
    id VARCHAR(36) PRIMARY KEY,
    action VARCHAR(16) NOT NULL,
    actor_kind VARCHAR(32) NOT NULL,
    operator_tenant_id VARCHAR(64),
    operator_employee_no VARCHAR(64),
    token_id VARCHAR(36),
    application_id VARCHAR(36),
    app_key VARCHAR(32),
    tenant_id VARCHAR(64),
    user_id VARCHAR(64),
    outcome VARCHAR(16) NOT NULL,
    reason VARCHAR(64) NOT NULL,
    request_id VARCHAR(64) NOT NULL,
    occurred_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    INDEX idx_token_audit_operator_tenant (operator_tenant_id, occurred_at, id),
    INDEX idx_token_audit_target (token_id, occurred_at, id),
    INDEX idx_token_audit_operator (operator_employee_no, occurred_at, id),
    INDEX idx_token_audit_application (application_id, occurred_at, id),
    INDEX idx_token_audit_time (occurred_at,id),
    INDEX idx_token_audit_request (request_id,occurred_at,id)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- Source: cyl-openplatform-infrastructure/src/main/resources/db/publication-schema.sql
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

-- Source: cyl-openplatform-infrastructure/src/main/resources/db/governance-schema.sql
-- 五维治理草稿与固定发布快照；运行时只读取已发布规则。
CREATE TABLE IF NOT EXISTS gateway_governance_rule (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    target_type VARCHAR(20) NOT NULL,
    tenant_id VARCHAR(64),
    application_id VARCHAR(36),
    api_id VARCHAR(36),
    live_mode VARCHAR(16),
    config_json LONGTEXT NOT NULL,
    draft_revision BIGINT NOT NULL,
    state_version BIGINT NOT NULL,
    live_release_id VARCHAR(36),
    live_rule_json LONGTEXT,
    INDEX idx_governance_rule_type (target_type,id),
    INDEX idx_governance_rule_tenant (tenant_id,id),
    INDEX idx_governance_rule_application (application_id,id),
    INDEX idx_governance_rule_api (api_id,id)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS gateway_governance_release (
    id VARCHAR(36) PRIMARY KEY,
    rule_id VARCHAR(64) NOT NULL,
    state_version BIGINT NOT NULL,
    name VARCHAR(100) NOT NULL,
    rule_json LONGTEXT NOT NULL,
    published_at TIMESTAMP(6) NOT NULL,
    source_release_id VARCHAR(36),
    operator_tenant_id VARCHAR(64) NOT NULL,
    operator_employee_no VARCHAR(64) NOT NULL,
    preview_digest VARCHAR(64) NOT NULL,
    UNIQUE KEY uk_governance_release_version (rule_id,state_version),
    UNIQUE KEY uk_governance_release_digest (rule_id,preview_digest),
    FOREIGN KEY (rule_id) REFERENCES gateway_governance_rule(id)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- Source: cyl-openplatform-infrastructure/src/main/resources/db/observability-schema.sql
CREATE TABLE IF NOT EXISTS platform_call_record (
    id VARCHAR(36) PRIMARY KEY,
    request_id VARCHAR(64) NOT NULL,
    mode VARCHAR(16) NOT NULL,
    channel VARCHAR(16) NOT NULL DEFAULT 'API',
    tool_name VARCHAR(64),
    api_id VARCHAR(36),
    service VARCHAR(64),
    version VARCHAR(32),
    method VARCHAR(64),
    protocol VARCHAR(16),
    application_id VARCHAR(36),
    tenant_id VARCHAR(64),
    user_id VARCHAR(64),
    employee_id VARCHAR(64),
    identity_kind VARCHAR(16),
    governance_rejected BOOLEAN NOT NULL DEFAULT FALSE,
    observed BOOLEAN NOT NULL DEFAULT FALSE,
    governance_denial_reason VARCHAR(32),
    employee_no VARCHAR(64),
    client_ip VARCHAR(64) NOT NULL,
    release_id VARCHAR(36),
    draft_revision BIGINT,
    operator_tenant_id VARCHAR(64),
    operator_employee_no VARCHAR(64),
    outcome VARCHAR(16) NOT NULL,
    error_code INTEGER,
    http_status INTEGER NOT NULL,
    duration_millis BIGINT NOT NULL,
    governance_json TEXT,
    occurred_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    INDEX idx_call_employee (employee_no, occurred_at, id),
    INDEX idx_call_person (tenant_id, employee_id, occurred_at, id),
    INDEX idx_call_time (occurred_at, id),
    INDEX idx_call_channel (channel, occurred_at, id),
    INDEX idx_call_request (request_id, occurred_at, id),
    INDEX idx_call_api (api_id, occurred_at, id),
    INDEX idx_call_application (application_id, occurred_at, id),
    INDEX idx_call_tenant (tenant_id, occurred_at, id)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS platform_call_rule_record (
    record_id VARCHAR(36) NOT NULL,
    rule_id VARCHAR(240) NOT NULL,
    rule_version BIGINT NOT NULL,
    rule_mode VARCHAR(16) NOT NULL,
    reason VARCHAR(32) NOT NULL,
    PRIMARY KEY (record_id,rule_id,rule_version),
    INDEX idx_call_rule (rule_id,rule_version,record_id)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- Source: cyl-openplatform-infrastructure/src/main/resources/db/operations-metrics-schema.sql
-- bucket_start 为UTC epoch minute，避免JDBC连接时区影响归属；仅新写链聚合，无历史回填。
CREATE TABLE IF NOT EXISTS platform_call_minute (
    bucket_start BIGINT NOT NULL,
    mode VARCHAR(16) NOT NULL,
    api_key VARCHAR(36) NOT NULL,
    application_key VARCHAR(36) NOT NULL,
    tenant_key VARCHAR(64) NOT NULL DEFAULT '',
    employee_key VARCHAR(64) NOT NULL DEFAULT '',
    identity_kind VARCHAR(16) NOT NULL DEFAULT 'UNKNOWN',
    governance_rejected BIGINT NOT NULL DEFAULT 0,
    observed_requests BIGINT NOT NULL DEFAULT 0,
    rule_hits BIGINT NOT NULL DEFAULT 0,
    ip_denied BIGINT NOT NULL DEFAULT 0,
    token_bucket_rejected BIGINT NOT NULL DEFAULT 0,
    daily_quota_rejected BIGINT NOT NULL DEFAULT 0,
    requests BIGINT NOT NULL,
    successes BIGINT NOT NULL,
    client_errors BIGINT NOT NULL,
    server_errors BIGINT NOT NULL,
    auth_rejected BIGINT NOT NULL,
    rate_limited BIGINT NOT NULL,
    slow_calls BIGINT NOT NULL,
    unattributed BIGINT NOT NULL,
    duration_sum BIGINT NOT NULL,
    max_duration BIGINT NOT NULL,
    PRIMARY KEY (bucket_start, mode, api_key, application_key, tenant_key, identity_kind, employee_key),
    INDEX idx_call_minute_api (api_key, mode, bucket_start),
    INDEX idx_call_minute_application (application_key, mode, bucket_start),
    INDEX idx_call_minute_tenant (tenant_key, mode, bucket_start),
    INDEX idx_call_minute_person (tenant_key, employee_key, mode, bucket_start)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS platform_rule_minute (
    bucket_start BIGINT NOT NULL,
    rule_id VARCHAR(240) NOT NULL,
    rule_version BIGINT NOT NULL,
    mode VARCHAR(16) NOT NULL,
    api_key VARCHAR(36) NOT NULL,
    application_key VARCHAR(36) NOT NULL,
    tenant_key VARCHAR(64) NOT NULL DEFAULT '',
    employee_key VARCHAR(64) NOT NULL DEFAULT '',
    identity_kind VARCHAR(16) NOT NULL DEFAULT 'UNKNOWN',
    governance_rejected BIGINT NOT NULL DEFAULT 0,
    observed_requests BIGINT NOT NULL DEFAULT 0,
    rule_hits BIGINT NOT NULL DEFAULT 0,
    ip_denied BIGINT NOT NULL DEFAULT 0,
    token_bucket_rejected BIGINT NOT NULL DEFAULT 0,
    daily_quota_rejected BIGINT NOT NULL DEFAULT 0,
    requests BIGINT NOT NULL,
    successes BIGINT NOT NULL,
    client_errors BIGINT NOT NULL,
    server_errors BIGINT NOT NULL,
    auth_rejected BIGINT NOT NULL,
    rate_limited BIGINT NOT NULL,
    slow_calls BIGINT NOT NULL,
    unattributed BIGINT NOT NULL,
    duration_sum BIGINT NOT NULL,
    max_duration BIGINT NOT NULL,
    PRIMARY KEY (rule_id, rule_version, bucket_start, mode, api_key, application_key, tenant_key, identity_kind, employee_key),
    INDEX idx_rule_minute_time (bucket_start),
    INDEX idx_rule_minute_api (api_key, mode, bucket_start),
    INDEX idx_rule_minute_application (application_key, mode, bucket_start),
    INDEX idx_rule_minute_tenant (tenant_key, mode, bucket_start),
    INDEX idx_rule_minute_person (tenant_key, employee_key, mode, bucket_start)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- Source: cyl-openplatform-infrastructure/src/main/resources/db/environment-release-transfer-schema.sql
CREATE TABLE IF NOT EXISTS environment_release_transfer (
    environment_id VARCHAR(48) NOT NULL DEFAULT 'local',
    INDEX idx_transfer_environment(environment_id,created_at,id),
 id VARCHAR(36) PRIMARY KEY,
 source_release_id VARCHAR(36) NOT NULL,
 source_environment VARCHAR(48) NULL,
 target_id VARCHAR(48) NOT NULL,
 service VARCHAR(64) NOT NULL,
 version VARCHAR(32) NOT NULL,
 method VARCHAR(64) NOT NULL,
 request_json MEDIUMTEXT NOT NULL,
 delivery_state VARCHAR(16) NOT NULL,
 error VARCHAR(500),
 receipt_json TEXT,
 observations_json TEXT NOT NULL,
 created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 record_version BIGINT NOT NULL,
 KEY idx_environment_transfer_created (created_at,id)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;

-- Source: cyl-openplatform-infrastructure/src/main/resources/db/environment-release-receipt-schema.sql
CREATE TABLE IF NOT EXISTS environment_release_receipt (
    environment_id VARCHAR(48) NOT NULL DEFAULT 'local',
 id VARCHAR(36) PRIMARY KEY,
 source_environment VARCHAR(48) NOT NULL,
 transfer_id VARCHAR(36) NOT NULL,
 request_digest VARCHAR(64) NOT NULL,
 api_id VARCHAR(36) NOT NULL,
 release_id VARCHAR(36) NOT NULL,
 source_release_id VARCHAR(36) NOT NULL,
 operator_tenant_id VARCHAR(64) NOT NULL,
 operator_employee_no VARCHAR(64) NOT NULL,
 before_json LONGTEXT,
 after_json LONGTEXT NOT NULL,
 changed_fields_json VARCHAR(1000) NOT NULL,
 UNIQUE KEY uk_environment_receipt_source_transfer (environment_id,source_environment,transfer_id),
 UNIQUE KEY uk_environment_receipt_release (release_id),
 FOREIGN KEY(api_id) REFERENCES catalog_api_draft(id),
 FOREIGN KEY(release_id) REFERENCES publication_release(id)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- Source: cyl-openplatform-infrastructure/src/main/resources/db/sdk-asset-schema.sql
CREATE TABLE IF NOT EXISTS sdk_asset (
 id VARCHAR(36) PRIMARY KEY,
 kind VARCHAR(16) NOT NULL DEFAULT 'LEGACY_API',
 api_id VARCHAR(36),
 release_id VARCHAR(36),
 service VARCHAR(64),
 version VARCHAR(32),
 method VARCHAR(64),
 name VARCHAR(100) NOT NULL,
 sdk_version VARCHAR(32) NOT NULL,
 language VARCHAR(32) NOT NULL,
 platform_language VARCHAR(32) GENERATED ALWAYS AS (CASE WHEN kind='PLATFORM' THEN language ELSE NULL END),
 gateway_protocol VARCHAR(40) NOT NULL,
 runtime VARCHAR(80) NOT NULL,
 release_notes VARCHAR(4000) NOT NULL,
 status VARCHAR(16) NOT NULL,
 revision BIGINT NOT NULL,
 sha256 VARCHAR(64),
 size_bytes BIGINT,
 payload MEDIUMBLOB,
 created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 published_at TIMESTAMP(6) NULL DEFAULT NULL,
 CONSTRAINT ck_sdk_asset_references CHECK (
  (kind='PLATFORM' AND api_id IS NULL AND release_id IS NULL AND service IS NULL AND version IS NULL AND method IS NULL)
  OR (kind='LEGACY_API' AND api_id IS NOT NULL AND release_id IS NOT NULL AND service IS NOT NULL AND version IS NOT NULL AND method IS NOT NULL)
 ),
 UNIQUE KEY uk_sdk_platform_version (platform_language,sdk_version),
 KEY idx_sdk_asset_public (kind,status,created_at,id),
 UNIQUE KEY uk_sdk_asset_version (api_id,language,sdk_version),
 KEY idx_sdk_asset_release (api_id,release_id,status,created_at,id),
 KEY idx_sdk_asset_created (created_at,id),
 FOREIGN KEY (api_id) REFERENCES catalog_api_draft(id),
 FOREIGN KEY (release_id) REFERENCES publication_release(id)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;

-- Source: cyl-openplatform-infrastructure/src/main/resources/db/operations-alert-schema.sql
-- 新库及旧库均显式执行一次；策略初始关闭，不发送外部通知。
CREATE TABLE IF NOT EXISTS platform_alert_policy (
 id VARCHAR(36) PRIMARY KEY, version BIGINT NOT NULL, window_minutes INT NOT NULL,
 min_requests BIGINT NOT NULL, failure_enabled BOOLEAN NOT NULL,
 failure_rate_threshold DECIMAL(5,2) NOT NULL, latency_enabled BOOLEAN NOT NULL,
 average_latency_threshold_millis BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
INSERT INTO platform_alert_policy(id,version,window_minutes,min_requests,failure_enabled,failure_rate_threshold,latency_enabled,average_latency_threshold_millis)
SELECT 'platform',0,5,100,false,5.00,false,1000 WHERE NOT EXISTS (SELECT 1 FROM platform_alert_policy WHERE id='platform');
CREATE TABLE IF NOT EXISTS platform_alert_state (
 metric VARCHAR(32) PRIMARY KEY, status VARCHAR(16) NOT NULL, metric_value VARCHAR(32),
 sample_count BIGINT NOT NULL, window_start TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), window_end TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 policy_version BIGINT NOT NULL, evaluated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS platform_alert_event (
 id VARCHAR(36) PRIMARY KEY, metric VARCHAR(32) NOT NULL, previous_status VARCHAR(16), status VARCHAR(16) NOT NULL,
 metric_value VARCHAR(32), sample_count BIGINT NOT NULL, window_start TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 window_end TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), policy_version BIGINT NOT NULL, occurred_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 UNIQUE KEY uk_alert_window(metric,policy_version,window_end),
 INDEX idx_alert_event_occurred(occurred_at,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- Source: cyl-openplatform-infrastructure/src/main/resources/db/signature-schema.sql
CREATE TABLE IF NOT EXISTS platform_signing_key (
    application_id VARCHAR(36) PRIMARY KEY,
    key_id VARCHAR(32) NOT NULL,
    revision BIGINT NOT NULL,
    status VARCHAR(16) NOT NULL,
    wrapping_key_id VARCHAR(32),
    encrypted_secret VARCHAR(128),
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    changed_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    UNIQUE KEY uk_signing_key_id (key_id)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- Source: cyl-openplatform-infrastructure/src/main/resources/db/administrator-schema.sql
-- 管理权限仅存储在数据库；首位管理员由受控SQL建立，应用不自动授予权限。
CREATE TABLE IF NOT EXISTS platform_administrator_control (
    id INTEGER PRIMARY KEY,
    CONSTRAINT chk_administrator_control_singleton CHECK (id = 1)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- 固定控制行用于并发授权事务加锁。
INSERT INTO platform_administrator_control (id)
SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM platform_administrator_control WHERE id = 1);

CREATE TABLE IF NOT EXISTS platform_administrator (
    id VARCHAR(36) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL,
    user_id VARCHAR(64) NOT NULL,
    employee_id VARCHAR(64) NOT NULL,
    employee_no VARCHAR(64) NOT NULL,
    display_name VARCHAR(100) NOT NULL,
    enabled BOOLEAN NOT NULL,
    super_administrator BOOLEAN NOT NULL,
    revision BIGINT NOT NULL,
    UNIQUE KEY uk_administrator_user (tenant_id, user_id),
    UNIQUE KEY uk_administrator_employee (tenant_id, employee_id),
    UNIQUE KEY uk_administrator_employee_no (tenant_id, employee_no),
    INDEX idx_administrator_super (enabled, super_administrator, id),
    CONSTRAINT chk_administrator_revision CHECK (revision >= 1)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS platform_administrator_permission (
    administrator_id VARCHAR(36) NOT NULL,
    permission_code VARCHAR(40) NOT NULL,
    PRIMARY KEY (administrator_id, permission_code),
    FOREIGN KEY (administrator_id) REFERENCES platform_administrator(id),
    CONSTRAINT chk_administrator_permission CHECK (permission_code IN (
        'MANAGE_APPLICATIONS', 'MANAGE_APIS', 'MANAGE_CONNECTIONS', 'PUBLISH_APIS',
        'REVIEW_APIS', 'MANAGE_OPERATIONS', 'VIEW_AUDIT'
    ))
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS platform_administrator_audit (
    id VARCHAR(36) PRIMARY KEY,
    administrator_id VARCHAR(36) NOT NULL,
    operator_tenant_id VARCHAR(64) NOT NULL,
    operator_employee_no VARCHAR(64) NOT NULL,
    action VARCHAR(32) NOT NULL,
    reason VARCHAR(500) NOT NULL,
    before_json LONGTEXT,
    after_json LONGTEXT NOT NULL,
    request_id VARCHAR(64) NOT NULL,
    occurred_at TIMESTAMP(6) NOT NULL,
    INDEX idx_administrator_audit_target (administrator_id, occurred_at, id),
    INDEX idx_administrator_audit_time (occurred_at, id),
    INDEX idx_administrator_audit_request (request_id)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- Source: sql/bootstrap-admin.sql
-- 初始身份为local租户的admin；登录密码保存在外部账号配置中，不在数据库SQL中。
-- 仅用于全新独立数据库的首位管理员，不适用于现有数据库升级。
INSERT INTO platform_administrator (id,tenant_id,user_id,employee_id,employee_no,display_name,enabled,super_administrator,revision)
VALUES ('local-admin','local','local-admin','local-admin','admin','管理员',true,true,1);
INSERT INTO platform_administrator_permission VALUES ('local-admin','MANAGE_APPLICATIONS');
INSERT INTO platform_administrator_permission VALUES ('local-admin','MANAGE_APIS');
INSERT INTO platform_administrator_permission VALUES ('local-admin','MANAGE_CONNECTIONS');
INSERT INTO platform_administrator_permission VALUES ('local-admin','PUBLISH_APIS');
INSERT INTO platform_administrator_permission VALUES ('local-admin','REVIEW_APIS');
INSERT INTO platform_administrator_permission VALUES ('local-admin','MANAGE_OPERATIONS');
INSERT INTO platform_administrator_permission VALUES ('local-admin','VIEW_AUDIT');
