-- Spec50：仅新增治理草稿/不可变发布表；不复制、不自动发布既有规则，不自动执行。
-- 切换前停止仍只认识旧策略的节点；全部节点升级后才能发布新规则，禁止新旧节点混跑。
-- 首次发布前旧PUT仍可用；发布基线同时核对旧策略。首次发布后旧PUT返回409。
-- 规则身份与目标固定，state_version仅递增；回滚创建新发布，停启及算法迁移不清Redis计数。
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
