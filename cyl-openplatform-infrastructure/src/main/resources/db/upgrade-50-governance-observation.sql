-- Spec50：先核对information_schema确认该列不存在；停止旧版本节点后执行一次。
-- 仅新增有限治理命中摘要，不存请求正文；既有调用保持NULL。未自动执行。
ALTER TABLE platform_call_record ADD COLUMN governance_json TEXT;
