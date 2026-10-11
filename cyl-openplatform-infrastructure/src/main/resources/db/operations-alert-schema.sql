-- 新库及旧库均显式执行一次；策略初始关闭，不发送外部通知。
CREATE TABLE IF NOT EXISTS platform_alert_policy (
 id VARCHAR(36) PRIMARY KEY, version BIGINT NOT NULL, window_minutes INT NOT NULL,
 min_requests BIGINT NOT NULL, failure_enabled BOOLEAN NOT NULL,
 failure_rate_threshold DECIMAL(5,2) NOT NULL, latency_enabled BOOLEAN NOT NULL,
 average_latency_threshold_millis BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
INSERT INTO platform_alert_policy(id,version,window_minutes,min_requests,failure_enabled,failure_rate_threshold,latency_enabled,average_latency_threshold_millis)
SELECT 'platform',0,5,100,false,5.00,false,1000 WHERE NOT EXISTS (SELECT 1 FROM platform_alert_policy WHERE id='platform');
CREATE TABLE IF NOT EXISTS platform_alert_state (
 metric VARCHAR(32) PRIMARY KEY, status VARCHAR(16) NOT NULL, metric_value VARCHAR(32),
 sample_count BIGINT NOT NULL, window_start TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), window_end TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 policy_version BIGINT NOT NULL, evaluated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS platform_alert_event (
 id VARCHAR(36) PRIMARY KEY, metric VARCHAR(32) NOT NULL, previous_status VARCHAR(16), status VARCHAR(16) NOT NULL,
 metric_value VARCHAR(32), sample_count BIGINT NOT NULL, window_start TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 window_end TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), policy_version BIGINT NOT NULL, occurred_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 UNIQUE KEY uk_alert_window(metric,policy_version,window_end),
 INDEX idx_alert_event_occurred(occurred_at,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
