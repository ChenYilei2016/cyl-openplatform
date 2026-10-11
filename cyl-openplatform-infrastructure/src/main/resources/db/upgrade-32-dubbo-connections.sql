-- 已有库的任务32增量；确认备份和字段不存在后由运维执行一次。本轮不自动执行公司库迁移。
-- 历史绑定没有连接引用，新增列保持NULL；不改definition_json/snapshot_json或历史摘要。
ALTER TABLE catalog_api_draft
    ADD COLUMN dubbo_connection_id VARCHAR(36) NULL,
    ADD COLUMN dubbo_connection_revision BIGINT NULL,
    ADD INDEX idx_catalog_dubbo_connection (dubbo_connection_id, id);
ALTER TABLE publication_release
    ADD COLUMN dubbo_connection_id VARCHAR(36) NULL,
    ADD COLUMN dubbo_connection_revision BIGINT NULL,
    ADD INDEX idx_release_dubbo_connection (dubbo_connection_id, id);
-- 随后执行 dubbo-connection-schema.sql 创建连接与不可变修订表。
