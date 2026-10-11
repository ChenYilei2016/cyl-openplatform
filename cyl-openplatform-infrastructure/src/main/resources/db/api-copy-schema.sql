CREATE TABLE IF NOT EXISTS catalog_api_copy_request (
    environment_id VARCHAR(48) NOT NULL DEFAULT 'local',
 tenant_id VARCHAR(64) NOT NULL,
 employee_no VARCHAR(64) NOT NULL,
 creation_key VARCHAR(36) NOT NULL,
 content_digest VARCHAR(64) NOT NULL,
 result_json LONGTEXT,
 PRIMARY KEY (environment_id, tenant_id, employee_no, creation_key)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
