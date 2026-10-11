-- 已有记录没有保存提交时基线，明确保留未知；不得用当前生效配置回填历史基线。
ALTER TABLE publication_release
 ADD COLUMN baseline_json LONGTEXT NULL,
 ADD COLUMN baseline_known BOOLEAN NOT NULL DEFAULT FALSE;
