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
