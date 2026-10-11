-- 任务24：已有库按部署迁移执行一次；新库已在各schema定义索引。
-- 记录ID复用主键；mode/outcome/source不新增低基数索引。
ALTER TABLE platform_call_record ADD INDEX idx_call_employee (employee_no, occurred_at, id);
ALTER TABLE access_audit ADD INDEX idx_access_audit_operator (operator_employee_no, occurred_at, id);
ALTER TABLE token_audit ADD INDEX idx_token_audit_operator (operator_employee_no, occurred_at, id);
ALTER TABLE catalog_audit ADD INDEX idx_catalog_audit_operator (operator_employee_no, occurred_at, id);
ALTER TABLE publication_audit ADD INDEX idx_publication_audit_operator (operator_employee_no, occurred_at, id);

-- MySQL8实际计划确认：对象ID与操作人租户独立过滤需避免扫描约1万行。
ALTER TABLE access_audit ADD INDEX idx_access_audit_target (target_id, occurred_at, id);
ALTER TABLE token_audit ADD INDEX idx_token_audit_target (token_id, occurred_at, id);
ALTER TABLE access_audit ADD INDEX idx_access_audit_operator_tenant (operator_tenant_id, occurred_at, id);
ALTER TABLE token_audit ADD INDEX idx_token_audit_operator_tenant (operator_tenant_id, occurred_at, id);
ALTER TABLE catalog_audit ADD INDEX idx_catalog_audit_operator_tenant (operator_tenant_id, occurred_at, id);
ALTER TABLE publication_audit ADD INDEX idx_publication_audit_operator_tenant (operator_tenant_id, occurred_at, id);
