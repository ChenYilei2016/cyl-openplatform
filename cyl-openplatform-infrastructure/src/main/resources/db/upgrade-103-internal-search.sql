-- 103：当前主定义的派生检索字段。执行前核对目标环境与列/索引是否存在。
-- 不修改主定义JSON、修订、发布快照、身份、凭据或历史记录；回填由配套有界工具执行。
ALTER TABLE catalog_api_draft ADD COLUMN internal_class VARCHAR(1024) NULL,
    ADD COLUMN internal_method VARCHAR(128) NULL;
CREATE INDEX idx_catalog_api_owner ON catalog_api_draft(owner,id);
