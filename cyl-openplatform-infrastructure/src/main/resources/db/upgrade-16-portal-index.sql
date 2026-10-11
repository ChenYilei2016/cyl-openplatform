-- 既有库执行一次；新库access-schema.sql已含此索引，执行前核对information_schema.statistics。
CREATE INDEX idx_tenant_grant_tenant ON access_tenant_grant (tenant_id,id);
