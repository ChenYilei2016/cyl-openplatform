-- 任务54：仅新增最小人员展示档案，不回填授权或审计，不自动执行公司库升级。
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
