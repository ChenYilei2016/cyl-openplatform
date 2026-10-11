-- Spec52：仅新增导入回执表；不改既有API，不自动执行。上线前核对同名表并备份。
CREATE TABLE IF NOT EXISTS catalog_api_import_request (
    tenant_id VARCHAR(64) NOT NULL,
    employee_no VARCHAR(64) NOT NULL,
    submission_key VARCHAR(36) NOT NULL,
    content_digest VARCHAR(64) NOT NULL,
    source_kind VARCHAR(16) NOT NULL,
    source_digest VARCHAR(64) NOT NULL,
    result_json LONGTEXT,
    PRIMARY KEY (tenant_id, employee_no, submission_key)
);
