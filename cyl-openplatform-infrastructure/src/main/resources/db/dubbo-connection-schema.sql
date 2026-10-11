CREATE TABLE IF NOT EXISTS dubbo_connection (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    environment_id VARCHAR(48) NOT NULL,
    description VARCHAR(2000) NOT NULL,
    draft_revision BIGINT NOT NULL,
    active_revision BIGINT,
    enabled BOOLEAN NOT NULL,
    state_version BIGINT NOT NULL,
    updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    INDEX idx_dubbo_connection_environment (environment_id,updated_at,id),
    INDEX idx_dubbo_connection_selectable (environment_id,enabled,active_revision,id)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS dubbo_connection_revision (
    id VARCHAR(64) PRIMARY KEY,
    connection_id VARCHAR(36) NOT NULL,
    revision BIGINT NOT NULL,
    config_json LONGTEXT NOT NULL,
    metadata_type VARCHAR(16) NOT NULL,
    discovery_mode VARCHAR(16) NOT NULL,
    provider_metadata_mode VARCHAR(16) NOT NULL,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    UNIQUE KEY uk_dubbo_connection_revision (connection_id,revision),
    FOREIGN KEY (connection_id) REFERENCES dubbo_connection(id)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
