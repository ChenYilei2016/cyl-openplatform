-- 128：同库API环境隔离。先停止所有访问该库的旧版本实例并备份，再由运维明确执行。
-- pre/prod共库的已有记录全部归pre（用户已确认）；独立project库升级时将末尾CALL参数改为'project'。
-- MySQL DDL会隐式提交；本脚本拒绝重复或部分执行状态，不自动回滚/猜测数据归属。
DROP PROCEDURE IF EXISTS upgrade_api_environment_128;
DELIMITER $$
CREATE PROCEDURE upgrade_api_environment_128(IN legacy_environment VARCHAR(48))
BEGIN
    DECLARE operation_index VARCHAR(64);
    DECLARE submission_index VARCHAR(64);
    DECLARE import_fk VARCHAR(64);
    IF legacy_environment NOT REGEXP '^[a-z][a-z0-9_-]{0,47}$' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Invalid legacy API environment';
    END IF;
    IF (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name IN ('catalog_api_draft','catalog_audit','catalog_api_revision','catalog_api_copy_request','catalog_api_import_request','catalog_api_import_revision','publication_release','publication_release_scope','publication_state','publication_audit','environment_release_receipt','environment_release_transfer','mcp_tool_set','mcp_tool_set_member')) <> 14 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Missing baseline tables; apply prerequisite schema migrations first';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name IN ('catalog_api_draft','catalog_audit','catalog_api_revision','catalog_api_copy_request','catalog_api_import_request','catalog_api_import_revision','publication_release','publication_release_scope','publication_state','publication_audit','environment_release_receipt','environment_release_transfer','mcp_tool_set','mcp_tool_set_member') AND column_name='environment_id') THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Environment columns already exist; inspect completed or partial migration before retry';
    END IF;
    IF (SELECT COUNT(DISTINCT table_name,index_name) FROM information_schema.statistics
          WHERE table_schema=DATABASE() AND ((table_name='catalog_api_draft' AND index_name='uk_catalog_mcp_tool_name')
            OR (table_name='environment_release_receipt' AND index_name='uk_environment_receipt_source_transfer')
            OR (table_name='mcp_tool_set' AND index_name='uk_mcp_tool_set_code'))) <> 3
       OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE()
                  AND table_name='catalog_api_draft' AND column_name='portal_visible') THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Baseline indexes or portal column differ; inspect before migration';
    END IF;
    SELECT index_name INTO operation_index FROM information_schema.statistics
      WHERE table_schema=DATABASE() AND table_name='catalog_api_draft' AND non_unique=0
      GROUP BY index_name HAVING GROUP_CONCAT(column_name ORDER BY seq_in_index)='service,version,method' LIMIT 1;
    SELECT index_name INTO submission_index FROM information_schema.statistics
      WHERE table_schema=DATABASE() AND table_name='publication_release' AND non_unique=0
      GROUP BY index_name HAVING GROUP_CONCAT(column_name ORDER BY seq_in_index)='submission_key' LIMIT 1;
    SELECT constraint_name INTO import_fk FROM information_schema.key_column_usage
      WHERE table_schema=DATABASE() AND table_name='catalog_api_import_revision'
        AND referenced_table_name='catalog_api_import_request' LIMIT 1;
    IF operation_index IS NULL OR submission_index IS NULL OR import_fk IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Baseline constraints differ; inspect before migration';
    END IF;
    SET @ddl=CONCAT('ALTER TABLE catalog_api_draft ADD COLUMN environment_id VARCHAR(48) NOT NULL DEFAULT ', QUOTE(legacy_environment));
    PREPARE change_schema FROM @ddl; EXECUTE change_schema; DEALLOCATE PREPARE change_schema;
    SET @ddl=CONCAT('ALTER TABLE catalog_audit ADD COLUMN environment_id VARCHAR(48) NOT NULL DEFAULT ', QUOTE(legacy_environment));
    PREPARE change_schema FROM @ddl; EXECUTE change_schema; DEALLOCATE PREPARE change_schema;
    SET @ddl=CONCAT('ALTER TABLE catalog_api_revision ADD COLUMN environment_id VARCHAR(48) NOT NULL DEFAULT ', QUOTE(legacy_environment));
    PREPARE change_schema FROM @ddl; EXECUTE change_schema; DEALLOCATE PREPARE change_schema;
    SET @ddl=CONCAT('ALTER TABLE catalog_api_copy_request ADD COLUMN environment_id VARCHAR(48) NOT NULL DEFAULT ', QUOTE(legacy_environment));
    PREPARE change_schema FROM @ddl; EXECUTE change_schema; DEALLOCATE PREPARE change_schema;
    SET @ddl=CONCAT('ALTER TABLE catalog_api_import_request ADD COLUMN environment_id VARCHAR(48) NOT NULL DEFAULT ', QUOTE(legacy_environment));
    PREPARE change_schema FROM @ddl; EXECUTE change_schema; DEALLOCATE PREPARE change_schema;
    SET @ddl=CONCAT('ALTER TABLE catalog_api_import_revision ADD COLUMN environment_id VARCHAR(48) NOT NULL DEFAULT ', QUOTE(legacy_environment));
    PREPARE change_schema FROM @ddl; EXECUTE change_schema; DEALLOCATE PREPARE change_schema;
    SET @ddl=CONCAT('ALTER TABLE publication_release ADD COLUMN environment_id VARCHAR(48) NOT NULL DEFAULT ', QUOTE(legacy_environment));
    PREPARE change_schema FROM @ddl; EXECUTE change_schema; DEALLOCATE PREPARE change_schema;
    SET @ddl=CONCAT('ALTER TABLE publication_release_scope ADD COLUMN environment_id VARCHAR(48) NOT NULL DEFAULT ', QUOTE(legacy_environment));
    PREPARE change_schema FROM @ddl; EXECUTE change_schema; DEALLOCATE PREPARE change_schema;
    SET @ddl=CONCAT('ALTER TABLE publication_state ADD COLUMN environment_id VARCHAR(48) NOT NULL DEFAULT ', QUOTE(legacy_environment));
    PREPARE change_schema FROM @ddl; EXECUTE change_schema; DEALLOCATE PREPARE change_schema;
    SET @ddl=CONCAT('ALTER TABLE publication_audit ADD COLUMN environment_id VARCHAR(48) NOT NULL DEFAULT ', QUOTE(legacy_environment));
    PREPARE change_schema FROM @ddl; EXECUTE change_schema; DEALLOCATE PREPARE change_schema;
    SET @ddl=CONCAT('ALTER TABLE environment_release_receipt ADD COLUMN environment_id VARCHAR(48) NOT NULL DEFAULT ', QUOTE(legacy_environment));
    PREPARE change_schema FROM @ddl; EXECUTE change_schema; DEALLOCATE PREPARE change_schema;
    SET @ddl=CONCAT('ALTER TABLE environment_release_transfer ADD COLUMN environment_id VARCHAR(48) NOT NULL DEFAULT ', QUOTE(legacy_environment));
    PREPARE change_schema FROM @ddl; EXECUTE change_schema; DEALLOCATE PREPARE change_schema;
    SET @ddl=CONCAT('ALTER TABLE mcp_tool_set ADD COLUMN environment_id VARCHAR(48) NOT NULL DEFAULT ', QUOTE(legacy_environment));
    PREPARE change_schema FROM @ddl; EXECUTE change_schema; DEALLOCATE PREPARE change_schema;
    SET @ddl=CONCAT('ALTER TABLE mcp_tool_set_member ADD COLUMN environment_id VARCHAR(48) NOT NULL DEFAULT ', QUOTE(legacy_environment));
    PREPARE change_schema FROM @ddl; EXECUTE change_schema; DEALLOCATE PREPARE change_schema;
    ALTER TABLE catalog_api_draft ADD COLUMN portal_visible BOOLEAN NOT NULL DEFAULT TRUE;
    SET @ddl=CONCAT('ALTER TABLE catalog_api_draft DROP INDEX `',REPLACE(operation_index,'`','``'),'`');
    PREPARE change_schema FROM @ddl; EXECUTE change_schema; DEALLOCATE PREPARE change_schema;
    ALTER TABLE catalog_api_draft ADD UNIQUE KEY uk_catalog_environment_operation(environment_id,service,version,method),
      DROP INDEX uk_catalog_mcp_tool_name, ADD UNIQUE KEY uk_catalog_mcp_tool_name(environment_id,mcp_tool_name);
    SET @ddl=CONCAT('ALTER TABLE publication_release DROP INDEX `',REPLACE(submission_index,'`','``'),'`');
    PREPARE change_schema FROM @ddl; EXECUTE change_schema; DEALLOCATE PREPARE change_schema;
    ALTER TABLE publication_release ADD UNIQUE KEY uk_release_environment_submission(environment_id,submission_key);
    SET @ddl=CONCAT('ALTER TABLE catalog_api_import_revision DROP FOREIGN KEY `',REPLACE(import_fk,'`','``'),'`');
    PREPARE change_schema FROM @ddl; EXECUTE change_schema; DEALLOCATE PREPARE change_schema;
    ALTER TABLE catalog_api_import_request DROP PRIMARY KEY, ADD PRIMARY KEY(environment_id,tenant_id,employee_no,submission_key);
    ALTER TABLE catalog_api_import_revision ADD CONSTRAINT fk_import_revision_environment
      FOREIGN KEY(environment_id,operator_tenant_id,operator_employee_no,submission_key)
      REFERENCES catalog_api_import_request(environment_id,tenant_id,employee_no,submission_key);
    ALTER TABLE catalog_api_copy_request DROP PRIMARY KEY, ADD PRIMARY KEY(environment_id,tenant_id,employee_no,creation_key);
    ALTER TABLE environment_release_receipt DROP INDEX uk_environment_receipt_source_transfer,
      ADD UNIQUE KEY uk_environment_receipt_source_transfer(environment_id,source_environment,transfer_id);
    ALTER TABLE mcp_tool_set DROP INDEX uk_mcp_tool_set_code, ADD UNIQUE KEY uk_mcp_tool_set_code(environment_id,code);
    ALTER TABLE catalog_api_draft ADD INDEX idx_api_environment(environment_id,id);
    ALTER TABLE publication_release ADD INDEX idx_release_environment(environment_id,status,submitted_at,id);
    ALTER TABLE publication_state ADD INDEX idx_state_environment(environment_id,api_id);
    ALTER TABLE catalog_audit ADD INDEX idx_catalog_audit_environment(environment_id,occurred_at,id);
    ALTER TABLE publication_audit ADD INDEX idx_publication_audit_environment(environment_id,occurred_at,id);
    ALTER TABLE environment_release_transfer ADD INDEX idx_transfer_environment(environment_id,created_at,id);
END$$
DELIMITER ;
CALL upgrade_api_environment_128('pre');
DROP PROCEDURE upgrade_api_environment_128;

-- 验证数量、默认归属与门户状态。不得以这些计数替代双环境HTTP验收。
SELECT environment_id,COUNT(*) AS api_count,SUM(portal_visible) AS portal_visible_count FROM catalog_api_draft GROUP BY environment_id;
SELECT environment_id,COUNT(*) AS release_count FROM publication_release GROUP BY environment_id;
SELECT environment_id,COUNT(*) AS state_count FROM publication_state GROUP BY environment_id;
