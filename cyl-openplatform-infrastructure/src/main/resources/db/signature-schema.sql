CREATE TABLE IF NOT EXISTS platform_signing_key (
    application_id VARCHAR(36) PRIMARY KEY,
    key_id VARCHAR(32) NOT NULL,
    revision BIGINT NOT NULL,
    status VARCHAR(16) NOT NULL,
    wrapping_key_id VARCHAR(32),
    encrypted_secret VARCHAR(128),
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    changed_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    UNIQUE KEY uk_signing_key_id (key_id)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
