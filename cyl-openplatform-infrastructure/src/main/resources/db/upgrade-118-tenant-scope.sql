-- 118 公共通用权限组与租户权限：已有库先核对 information_schema，仅在 access_scope.public_access 不存在、
-- access_tenant_scope_grant 不存在时执行一次；不加入启动自动迁移。DDL 会隐式提交，执行前先备份并确认目标库。
-- 只加列与新表：现有权限组默认不是公共通用，不改启用状态、默认授予、凭据权限组或任何授权版本。
ALTER TABLE access_scope
    ADD COLUMN public_access BOOLEAN NOT NULL DEFAULT FALSE;

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
