-- 阶段 A：DDL 仅执行一次，之后升级所有写入节点。回填期间暂停旧版本跨环境发送写入。
ALTER TABLE environment_release_transfer ADD COLUMN source_environment VARCHAR(48) NULL;

-- 阶段 B：MySQL8，每次至多 1000 条 ID；仅重复本阶段，沿当前会话游标续跑。
-- 中断后可从空游标重新开始：已填标量不会重复修改，非法历史正文保持未知。
SET @task24_source_after_id = COALESCE(@task24_source_after_id, '');
START TRANSACTION;
CREATE TEMPORARY TABLE task24_environment_source_batch (
 transfer_id VARCHAR(36) PRIMARY KEY,
 source_environment TEXT NULL
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
INSERT INTO task24_environment_source_batch (transfer_id, source_environment)
SELECT id, CASE WHEN JSON_VALID(request_json) THEN
 CASE WHEN JSON_TYPE(JSON_EXTRACT(request_json, '$.sourceEnvironment')) = 'STRING'
 THEN JSON_UNQUOTE(JSON_EXTRACT(request_json, '$.sourceEnvironment')) END END
FROM environment_release_transfer
WHERE source_environment IS NULL AND id > @task24_source_after_id
ORDER BY id LIMIT 1000 FOR UPDATE;
UPDATE environment_release_transfer t
JOIN task24_environment_source_batch b ON b.transfer_id = t.id
SET t.source_environment = b.source_environment
WHERE t.source_environment IS NULL
  AND CHAR_LENGTH(b.source_environment) BETWEEN 1 AND 48
  AND CHAR_LENGTH(TRIM(b.source_environment)) > 0;
COMMIT;
SELECT @task24_source_after_id := COALESCE(MAX(transfer_id), @task24_source_after_id) AS resume_after_id
FROM task24_environment_source_batch;
DROP TEMPORARY TABLE task24_environment_source_batch;
SELECT COUNT(*) AS remaining_after_cursor FROM environment_release_transfer
WHERE source_environment IS NULL AND id > @task24_source_after_id;
-- remaining_after_cursor=0 后核对：应为 0；不为 0 的历史记录需要人工核查原请求，不推断当前环境。
SELECT COUNT(*) AS unknown_source_environment FROM environment_release_transfer
WHERE source_environment IS NULL OR CHAR_LENGTH(TRIM(source_environment)) = 0;
