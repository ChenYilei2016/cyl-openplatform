-- 初始身份为local租户的admin；登录密码保存在外部账号配置中，不在数据库SQL中。
-- 仅用于全新独立数据库的首位管理员，不适用于现有数据库升级。
INSERT INTO platform_administrator (id,tenant_id,user_id,employee_id,employee_no,display_name,enabled,super_administrator,revision)
VALUES ('local-admin','local','local-admin','local-admin','admin','管理员',true,true,1);
INSERT INTO platform_administrator_permission VALUES ('local-admin','MANAGE_APPLICATIONS');
INSERT INTO platform_administrator_permission VALUES ('local-admin','MANAGE_APIS');
INSERT INTO platform_administrator_permission VALUES ('local-admin','MANAGE_CONNECTIONS');
INSERT INTO platform_administrator_permission VALUES ('local-admin','PUBLISH_APIS');
INSERT INTO platform_administrator_permission VALUES ('local-admin','REVIEW_APIS');
INSERT INTO platform_administrator_permission VALUES ('local-admin','MANAGE_OPERATIONS');
INSERT INTO platform_administrator_permission VALUES ('local-admin','VIEW_AUDIT');
