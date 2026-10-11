-- 仅在核对目标库与列状态并取得授权后执行；不回填历史未知身份。
ALTER TABLE access_audit ADD COLUMN (
    operator_user_id VARCHAR(64) NULL,
    operator_employee_id VARCHAR(64) NULL,
    tenant_grant_id VARCHAR(36) NULL,
    target_user_id VARCHAR(64) NULL,
    target_employee_id VARCHAR(64) NULL,
    target_employee_no VARCHAR(64) NULL
);
