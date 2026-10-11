-- 已完成48历史表初始化的存量库：停写草稿后手动执行，不加入启动迁移。
-- 先检查information_schema.columns；已存在此列时跳过，禁止重复执行ALTER。
ALTER TABLE catalog_api_revision ADD COLUMN restored_from_revision BIGINT NULL;
-- 旧记录不猜测恢复来源；新的恢复记录与草稿/审计同事务归档。
