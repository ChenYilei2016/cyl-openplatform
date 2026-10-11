-- 仅既有库升级执行一次；先应用governance-schema.sql和observability-schema.sql。
ALTER TABLE access_audit ADD INDEX idx_access_audit_time (occurred_at,id), ADD INDEX idx_access_audit_request (request_id,occurred_at,id);
ALTER TABLE token_audit ADD INDEX idx_token_audit_time (occurred_at,id), ADD INDEX idx_token_audit_request (request_id,occurred_at,id);
ALTER TABLE catalog_audit ADD INDEX idx_catalog_audit_time (occurred_at,id), ADD INDEX idx_catalog_audit_request (request_id,occurred_at,id);
ALTER TABLE publication_audit ADD INDEX idx_publication_audit_time (occurred_at,id), ADD INDEX idx_publication_audit_request (request_id,occurred_at,id);
