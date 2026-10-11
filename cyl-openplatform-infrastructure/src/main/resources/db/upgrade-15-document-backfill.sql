-- MySQL8：每次只回填最多1000个旧快照。升级节点并暂停发布写入后执行，可重复执行至remaining=0。
-- category非NULL是投影完整标记；先补Scope再一次提交标量标记，不改快照/状态/摘要。
START TRANSACTION;
CREATE TEMPORARY TABLE sz_document_backfill_batch (
    release_id VARCHAR(36) PRIMARY KEY,
    category VARCHAR(100) NOT NULL,
    lifecycle_status VARCHAR(16) NOT NULL,
    snapshot_json LONGTEXT NOT NULL
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
INSERT INTO sz_document_backfill_batch (release_id,category,lifecycle_status,snapshot_json)
SELECT id, NULLIF(JSON_UNQUOTE(JSON_EXTRACT(snapshot_json,'$.category')),'null'),
    COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(snapshot_json,'$.lifecycle.status')),'null'),'ACTIVE'), snapshot_json
FROM publication_release WHERE category IS NULL ORDER BY id LIMIT 1000 FOR UPDATE;
INSERT INTO publication_release_scope (release_id,scope_code)
SELECT b.release_id,j.scope_code FROM sz_document_backfill_batch b
JOIN JSON_TABLE(b.snapshot_json,'$.scopeCodes[*]' COLUMNS(scope_code VARCHAR(64) PATH '$')) j
WHERE NOT EXISTS (SELECT 1 FROM publication_release_scope existing
                  WHERE existing.release_id=b.release_id AND existing.scope_code=j.scope_code);
UPDATE publication_release r JOIN sz_document_backfill_batch b ON b.release_id=r.id
SET r.category=b.category,r.lifecycle_status=b.lifecycle_status;
COMMIT;
DROP TEMPORARY TABLE sz_document_backfill_batch;
SELECT COUNT(*) AS remaining FROM publication_release WHERE category IS NULL;
