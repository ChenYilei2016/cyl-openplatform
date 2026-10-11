-- 人工审核后执行一次；应用启动不自动迁移。
-- 已有记录保留 STANDARD。旧记录缺少精确发布基线，不能从修订号或当前指针猜测。
-- 升级前的待审申请须驳回后重新提交；历史 APPLIED 快照仍可作为回滚来源。
ALTER TABLE publication_release
 ADD COLUMN kind VARCHAR(16) NOT NULL DEFAULT 'STANDARD',
 ADD COLUMN source_release_id VARCHAR(36) NULL,
 ADD COLUMN baseline_release_id VARCHAR(36) NULL,
 ADD COLUMN baseline_state_version BIGINT NULL;
