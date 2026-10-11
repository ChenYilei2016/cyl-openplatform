-- 旧库核对后执行一次，新库governance-schema.sql已包含；日配额0兼容原行为。
ALTER TABLE gateway_governance_policy ADD COLUMN daily_quota BIGINT NOT NULL DEFAULT 0;
ALTER TABLE gateway_governance_policy MODIFY COLUMN ip_addresses VARCHAR(5000) NOT NULL;
