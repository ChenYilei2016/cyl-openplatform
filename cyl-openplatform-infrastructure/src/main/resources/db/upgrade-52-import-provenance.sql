-- Spec52：新增API修订到导入回执的精确关联；不执行自动迁移、不存来源原文/文件名/凭据。
-- 前置：catalog_api_import_request已存在。部署前核对同名表与库默认字符集，取得授权后单独执行。
-- 仅后续成功CREATE/UPDATE记录来源；旧无关联修订显示“未知”，不扫描result_json、不全库回填。
CREATE TABLE IF NOT EXISTS catalog_api_import_revision (
    api_id VARCHAR(36) NOT NULL,
    revision BIGINT NOT NULL,
    operator_tenant_id VARCHAR(64) NOT NULL,
    operator_employee_no VARCHAR(64) NOT NULL,
    submission_key VARCHAR(36) NOT NULL,
    PRIMARY KEY (api_id,revision),
    INDEX idx_import_revision_receipt (operator_tenant_id,operator_employee_no,submission_key),
    FOREIGN KEY (operator_tenant_id,operator_employee_no,submission_key)
      REFERENCES catalog_api_import_request(tenant_id,employee_no,submission_key)
);
