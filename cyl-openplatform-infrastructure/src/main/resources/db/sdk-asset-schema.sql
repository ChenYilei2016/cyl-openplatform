CREATE TABLE IF NOT EXISTS sdk_asset (
 id VARCHAR(36) PRIMARY KEY,
 kind VARCHAR(16) NOT NULL DEFAULT 'LEGACY_API',
 api_id VARCHAR(36),
 release_id VARCHAR(36),
 service VARCHAR(64),
 version VARCHAR(32),
 method VARCHAR(64),
 name VARCHAR(100) NOT NULL,
 sdk_version VARCHAR(32) NOT NULL,
 language VARCHAR(32) NOT NULL,
 platform_language VARCHAR(32) GENERATED ALWAYS AS (CASE WHEN kind='PLATFORM' THEN language ELSE NULL END),
 gateway_protocol VARCHAR(40) NOT NULL,
 runtime VARCHAR(80) NOT NULL,
 release_notes VARCHAR(4000) NOT NULL,
 status VARCHAR(16) NOT NULL,
 revision BIGINT NOT NULL,
 sha256 VARCHAR(64),
 size_bytes BIGINT,
 payload MEDIUMBLOB,
 created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 published_at TIMESTAMP(6) NULL DEFAULT NULL,
 CONSTRAINT ck_sdk_asset_references CHECK (
  (kind='PLATFORM' AND api_id IS NULL AND release_id IS NULL AND service IS NULL AND version IS NULL AND method IS NULL)
  OR (kind='LEGACY_API' AND api_id IS NOT NULL AND release_id IS NOT NULL AND service IS NOT NULL AND version IS NOT NULL AND method IS NOT NULL)
 ),
 UNIQUE KEY uk_sdk_platform_version (platform_language,sdk_version),
 KEY idx_sdk_asset_public (kind,status,created_at,id),
 UNIQUE KEY uk_sdk_asset_version (api_id,language,sdk_version),
 KEY idx_sdk_asset_release (api_id,release_id,status,created_at,id),
 KEY idx_sdk_asset_created (created_at,id),
 FOREIGN KEY (api_id) REFERENCES catalog_api_draft(id),
 FOREIGN KEY (release_id) REFERENCES publication_release(id)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;
