-- 104 local具体授权后执行；仅新采集链维度，不回填旧人员或治理事实。
ALTER TABLE platform_call_record
    ADD COLUMN employee_id VARCHAR(64) NULL,
    ADD COLUMN identity_kind VARCHAR(16) NULL,
    ADD COLUMN governance_rejected BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN observed BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN governance_denial_reason VARCHAR(32) NULL,
    ADD INDEX idx_call_person (tenant_id,employee_id,occurred_at,id);
ALTER TABLE platform_call_minute
    ADD COLUMN tenant_key VARCHAR(64) NOT NULL DEFAULT '',
    ADD COLUMN employee_key VARCHAR(64) NOT NULL DEFAULT '',
    ADD COLUMN identity_kind VARCHAR(16) NOT NULL DEFAULT 'UNKNOWN',
    ADD COLUMN governance_rejected BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN observed_requests BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN rule_hits BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN ip_denied BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN token_bucket_rejected BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN daily_quota_rejected BIGINT NOT NULL DEFAULT 0,
    DROP PRIMARY KEY,
    ADD PRIMARY KEY (bucket_start,mode,api_key,application_key,tenant_key,identity_kind,employee_key),
    ADD INDEX idx_call_minute_tenant (tenant_key,mode,bucket_start),
    ADD INDEX idx_call_minute_person (tenant_key,employee_key,mode,bucket_start);

CREATE TABLE IF NOT EXISTS platform_call_rule_record (
    record_id VARCHAR(36) NOT NULL,
    rule_id VARCHAR(240) NOT NULL,
    rule_version BIGINT NOT NULL,
    rule_mode VARCHAR(16) NOT NULL,
    reason VARCHAR(32) NOT NULL,
    PRIMARY KEY (record_id,rule_id,rule_version),
    INDEX idx_call_rule (rule_id,rule_version,record_id)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS platform_rule_minute (
    bucket_start BIGINT NOT NULL,
    rule_id VARCHAR(240) NOT NULL,
    rule_version BIGINT NOT NULL,
    mode VARCHAR(16) NOT NULL,
    api_key VARCHAR(36) NOT NULL,
    application_key VARCHAR(36) NOT NULL,
    tenant_key VARCHAR(64) NOT NULL DEFAULT '',
    employee_key VARCHAR(64) NOT NULL DEFAULT '',
    identity_kind VARCHAR(16) NOT NULL DEFAULT 'UNKNOWN',
    governance_rejected BIGINT NOT NULL DEFAULT 0,
    observed_requests BIGINT NOT NULL DEFAULT 0,
    rule_hits BIGINT NOT NULL DEFAULT 0,
    ip_denied BIGINT NOT NULL DEFAULT 0,
    token_bucket_rejected BIGINT NOT NULL DEFAULT 0,
    daily_quota_rejected BIGINT NOT NULL DEFAULT 0,
    requests BIGINT NOT NULL,
    successes BIGINT NOT NULL,
    client_errors BIGINT NOT NULL,
    server_errors BIGINT NOT NULL,
    auth_rejected BIGINT NOT NULL,
    rate_limited BIGINT NOT NULL,
    slow_calls BIGINT NOT NULL,
    unattributed BIGINT NOT NULL,
    duration_sum BIGINT NOT NULL,
    max_duration BIGINT NOT NULL,
    PRIMARY KEY (rule_id, rule_version, bucket_start, mode, api_key, application_key, tenant_key, identity_kind, employee_key),
    INDEX idx_rule_minute_time (bucket_start),
    INDEX idx_rule_minute_api (api_key, mode, bucket_start),
    INDEX idx_rule_minute_application (application_key, mode, bucket_start),
    INDEX idx_rule_minute_tenant (tenant_key, mode, bucket_start),
    INDEX idx_rule_minute_person (tenant_key, employee_key, mode, bucket_start)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
