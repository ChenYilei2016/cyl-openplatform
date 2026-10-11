-- 92：仅新增分类与名称别名表。既有草稿/发布/修订JSON不改写。
-- 存量名称由配套准备脚本从草稿、发布和修订中去重登记；运行前需获得本环境授权。
CREATE TABLE IF NOT EXISTS catalog_category (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    revision BIGINT NOT NULL DEFAULT 1,
    INDEX idx_catalog_category_name(enabled,name,id)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS catalog_category_alias (
    category_key VARCHAR(100) PRIMARY KEY,
    category_id VARCHAR(36) NOT NULL,
    INDEX idx_catalog_category_alias_id(category_id),
    FOREIGN KEY (category_id) REFERENCES catalog_category(id)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- 执行器先检查 information_schema.statistics，已存在时跳过该索引。
CREATE INDEX idx_catalog_api_category ON catalog_api_draft(category,id);
