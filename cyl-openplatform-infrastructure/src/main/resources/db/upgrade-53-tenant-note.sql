-- Spec53：已有库先核对information_schema.columns，仅在两列均不存在时执行一次。
-- 暂停租户关联写入后执行；不加入启动自动迁移。旧记录空备注直接使用全局名称兜底。
-- 不修改authorization_version、状态、权限组或任何凭据。
ALTER TABLE access_tenant_grant
    ADD COLUMN note VARCHAR(100) NOT NULL DEFAULT '',
    ADD COLUMN note_revision BIGINT NOT NULL DEFAULT 0;
