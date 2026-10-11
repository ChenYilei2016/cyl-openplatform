-- Spec48第二阶段：人工审核后执行；不加入spring.sql.init或启动自动迁移。
-- 先暂停API草稿写入，再建表、归档及核验，最后启动新版服务。
-- 正文永久保留；该脚本不删除历史、不改变草稿、发布或审核状态。
CREATE TABLE IF NOT EXISTS catalog_api_revision (
    api_id VARCHAR(36) NOT NULL,
    revision BIGINT NOT NULL,
    source VARCHAR(40) NOT NULL,
    operator_tenant_id VARCHAR(64) NULL,
    operator_employee_no VARCHAR(64) NULL,
    recorded_at TIMESTAMP(6) NOT NULL,
    history_start BOOLEAN NOT NULL,
    content_digest VARCHAR(64) NOT NULL,
    digest_version VARCHAR(40) NOT NULL,
    snapshot_json LONGTEXT NOT NULL,
    restored_from_revision BIGINT NULL,
    PRIMARY KEY (api_id, revision),
    FOREIGN KEY (api_id) REFERENCES catalog_api_draft(id)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- 当前可确认草稿作为历史起点；原保存时间及作者未知，不能冒充本次操作人。
-- recorded_at表示归档时间；历史起点之前可能有缺失的草稿修订。
INSERT INTO catalog_api_revision
(api_id, revision, source, operator_tenant_id, operator_employee_no, recorded_at,
 history_start, content_digest, digest_version, snapshot_json)
SELECT d.id, d.draft_revision, 'HISTORY_BASELINE', NULL, NULL, CURRENT_TIMESTAMP(6),
       TRUE, SHA2(d.definition_json, 256), 'snapshot-json-sha256-v1', d.definition_json
FROM catalog_api_draft d
LEFT JOIN catalog_api_revision h ON h.api_id = d.id AND h.revision = d.draft_revision
WHERE h.api_id IS NULL;

-- 仅恢复已生效发布且同一API/修订的正文无歧义的历史；相同修订以当前草稿为准。
-- 历史作者未知，发布提交人不能冒充草稿作者。不同修订间的缺口不补造。
INSERT INTO catalog_api_revision
(api_id, revision, source, operator_tenant_id, operator_employee_no, recorded_at,
 history_start, content_digest, digest_version, snapshot_json)
SELECT r.api_id, r.draft_revision, 'LEGACY_RELEASE', NULL, NULL, CURRENT_TIMESTAMP(6),
       TRUE, SHA2(r.snapshot_json, 256), 'snapshot-json-sha256-v1', r.snapshot_json
FROM publication_release r
JOIN (
    SELECT api_id, draft_revision, MIN(id) AS chosen_id
    FROM publication_release
    WHERE status = 'APPLIED'
    GROUP BY api_id, draft_revision
    HAVING COUNT(DISTINCT SHA2(snapshot_json, 256)) = 1
) known ON known.chosen_id = r.id
LEFT JOIN catalog_api_revision h ON h.api_id = r.api_id AND h.revision = r.draft_revision
WHERE h.api_id IS NULL;

-- 核验：应为0；该值不表示历史修订连续，也不证明丢失旧稿已恢复。
SELECT COUNT(*) AS current_drafts_without_history
FROM catalog_api_draft d
LEFT JOIN catalog_api_revision h ON h.api_id = d.id AND h.revision = d.draft_revision
WHERE h.api_id IS NULL;
