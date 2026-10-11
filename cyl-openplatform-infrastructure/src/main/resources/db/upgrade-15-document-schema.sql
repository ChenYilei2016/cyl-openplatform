-- 仅用于任务14及以前的旧库；先核对information_schema，新库已包含这些定义，不重复执行ALTER。
ALTER TABLE publication_release ADD COLUMN category VARCHAR(100) NULL,
    ADD COLUMN lifecycle_status VARCHAR(16) NULL,
    ADD INDEX idx_publication_release_category(category,id);
CREATE TABLE IF NOT EXISTS publication_release_scope (
    release_id VARCHAR(36) NOT NULL,
    scope_code VARCHAR(64) NOT NULL,
    PRIMARY KEY(release_id,scope_code),
    FOREIGN KEY(release_id) REFERENCES publication_release(id)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
