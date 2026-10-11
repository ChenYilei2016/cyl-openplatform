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
