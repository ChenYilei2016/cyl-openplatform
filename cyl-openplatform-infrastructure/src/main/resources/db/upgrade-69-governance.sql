-- 69：仅用于当前local测试库，执行前备份受影响行并停止旧版本网关。
-- 未上线测试配置统一为令牌桶；旧60秒窗口不再保留。速率向上取整，突发容量沿用原窗口额度。
-- 不改API/发布快照/授权/Token，不新增表列，不删除旧表。
UPDATE gateway_governance_rule SET config_json = JSON_REMOVE(CASE WHEN JSON_UNQUOTE(JSON_EXTRACT(config_json, '$.rate.algorithm')) = 'LEGACY_MINUTE' THEN JSON_SET(config_json, '$.rate.algorithm', 'TOKEN_BUCKET', '$.rate.perSecond', CEIL(CAST(JSON_UNQUOTE(JSON_EXTRACT(config_json, '$.rate.perMinute')) AS UNSIGNED) / 60), '$.rate.burst', CAST(JSON_UNQUOTE(JSON_EXTRACT(config_json, '$.rate.perMinute')) AS UNSIGNED)) ELSE config_json END, '$.rate.perMinute'),
 live_rule_json = JSON_REMOVE(CASE WHEN JSON_UNQUOTE(JSON_EXTRACT(live_rule_json, '$.rate.algorithm')) = 'LEGACY_MINUTE' THEN JSON_SET(live_rule_json, '$.rate.algorithm', 'TOKEN_BUCKET', '$.rate.perSecond', CEIL(CAST(JSON_UNQUOTE(JSON_EXTRACT(live_rule_json, '$.rate.perMinute')) AS UNSIGNED) / 60), '$.rate.burst', CAST(JSON_UNQUOTE(JSON_EXTRACT(live_rule_json, '$.rate.perMinute')) AS UNSIGNED)) ELSE live_rule_json END, '$.rate.perMinute')
 WHERE JSON_CONTAINS_PATH(config_json, 'one', '$.rate.perMinute') OR JSON_CONTAINS_PATH(live_rule_json, 'one', '$.rate.perMinute');

UPDATE gateway_governance_release SET rule_json = JSON_REMOVE(CASE WHEN JSON_UNQUOTE(JSON_EXTRACT(rule_json, '$.rate.algorithm')) = 'LEGACY_MINUTE' THEN JSON_SET(rule_json, '$.rate.algorithm', 'TOKEN_BUCKET', '$.rate.perSecond', CEIL(CAST(JSON_UNQUOTE(JSON_EXTRACT(rule_json, '$.rate.perMinute')) AS UNSIGNED) / 60), '$.rate.burst', CAST(JSON_UNQUOTE(JSON_EXTRACT(rule_json, '$.rate.perMinute')) AS UNSIGNED)) ELSE rule_json END, '$.rate.perMinute')
 WHERE JSON_CONTAINS_PATH(rule_json, 'one', '$.rate.perMinute');

-- 旧算法的历史命中细节不伪装成新算法；仅清这些细节，调用元数据/结果保留。
UPDATE platform_call_record SET governance_json = NULL
 WHERE governance_json LIKE '%LEGACY_MINUTE%' OR governance_json LIKE '%MINUTE_LIMIT%' OR governance_json LIKE '%ALGORITHM_TRANSITION%';
