CREATE TABLE IF NOT EXISTS environment_release_receipt (
    environment_id VARCHAR(48) NOT NULL DEFAULT 'local',
 id VARCHAR(36) PRIMARY KEY,
 source_environment VARCHAR(48) NOT NULL,
 transfer_id VARCHAR(36) NOT NULL,
 request_digest VARCHAR(64) NOT NULL,
 api_id VARCHAR(36) NOT NULL,
 release_id VARCHAR(36) NOT NULL,
 source_release_id VARCHAR(36) NOT NULL,
 operator_tenant_id VARCHAR(64) NOT NULL,
 operator_employee_no VARCHAR(64) NOT NULL,
 before_json LONGTEXT,
 after_json LONGTEXT NOT NULL,
 changed_fields_json VARCHAR(1000) NOT NULL,
 UNIQUE KEY uk_environment_receipt_source_transfer (environment_id,source_environment,transfer_id),
 UNIQUE KEY uk_environment_receipt_release (release_id),
 FOREIGN KEY(api_id) REFERENCES catalog_api_draft(id),
 FOREIGN KEY(release_id) REFERENCES publication_release(id)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
