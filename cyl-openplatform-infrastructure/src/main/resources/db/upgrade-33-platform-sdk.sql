-- 任务33：一次性升级既有sdk_asset；执行前备份并核验目标环境，勿随应用启动重复执行。
-- 旧记录保持ID、API/release定位、ZIP、修订和状态，全部标记LEGACY_API，不自动公开。
ALTER TABLE sdk_asset ADD COLUMN kind VARCHAR(16) NOT NULL DEFAULT 'LEGACY_API';
ALTER TABLE sdk_asset MODIFY COLUMN api_id VARCHAR(36) NULL;
ALTER TABLE sdk_asset MODIFY COLUMN release_id VARCHAR(36) NULL;
ALTER TABLE sdk_asset MODIFY COLUMN service VARCHAR(64) NULL;
ALTER TABLE sdk_asset MODIFY COLUMN version VARCHAR(32) NULL;
ALTER TABLE sdk_asset MODIFY COLUMN method VARCHAR(64) NULL;
ALTER TABLE sdk_asset ADD COLUMN platform_language VARCHAR(32)
 GENERATED ALWAYS AS (CASE WHEN kind='PLATFORM' THEN language ELSE NULL END);
ALTER TABLE sdk_asset ADD CONSTRAINT ck_sdk_asset_references CHECK (
 (kind='PLATFORM' AND api_id IS NULL AND release_id IS NULL AND service IS NULL AND version IS NULL AND method IS NULL)
 OR (kind='LEGACY_API' AND api_id IS NOT NULL AND release_id IS NOT NULL AND service IS NOT NULL AND version IS NOT NULL AND method IS NOT NULL)
);
-- 原uk_sdk_asset_version及API/release外键继续保留；NULL派生值允许不同API保留同名旧版本。
CREATE UNIQUE INDEX uk_sdk_platform_version ON sdk_asset(platform_language,sdk_version);
CREATE INDEX idx_sdk_asset_public ON sdk_asset(kind,status,created_at,id);
