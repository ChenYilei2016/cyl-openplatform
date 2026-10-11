# 数据库初始化

[项目首页](../README.md) / [快速开始](../docs/quickstart.md) / 数据库初始化

**全新安装使用本目录已提交的 [init.sql](init.sql)。** 它可在 GitHub 直接查看、下载，包含当前 44 张表和首位管理员资格，不依赖 `.local` 或维护者的数据库导出。

## 文件用途

| 文件 | 使用者与用途 |
| --- | --- |
| [init.sql](init.sql) | 安装者：向 MySQL 8.4 **空库**导入一次；无密码、私钥或演示 API |
| [bootstrap-admin.sql](bootstrap-admin.sql) | 维护者：初始管理员种子来源，已合并到 init.sql，安装时不要重复执行 |
| [分模块 Schema](../cyl-openplatform-infrastructure/src/main/resources/db) | 维护者：16 份当前结构源码；其中 `upgrade-*.sql` 为历史迁移，不是全新安装入口 |
| [export-init-sql.py](../scripts/export-init-sql.py) | 维护者：生成与检查公开 init.sql；普通安装无需执行 |

初始身份为租户 `local`、用户/员工 ID `local-admin`、工号/用户名 `admin`，拥有总管理员资格和七项业务管理权限。**登录密码由你执行 [setup-local.py](../scripts/setup-local.py) 时输入，SQL 中没有默认登录密码。** 认证摘要保存于你生成的私有配置，详见 [账号说明](../docs/quickstart.md#管理员密码在哪里)。

初始化不创建演示业务数据。需要可调用 API 时，启动平台后运行 [第一次调用教程](../docs/first-api.md)中的公开脚本。

## 使用 Compose：自动初始化

从仓库根目录执行 [快速开始](../docs/quickstart.md)。`setup-local.py` 生成 `.env` 与账号/密钥配置；`docker compose up -d --wait` 创建数据库 `cyl_openplatform` 和用户 `cyl`，并将仓库的 `sql/init.sql` 挂载到 MySQL 初始化目录。

**只在空数据卷首次启动时导入。** 更换 SQL 后重启不会升级已有库；修改 `.env` 不会修改已有数据库用户密码。Java 配置 `spring.sql.init.mode=never`，平台进程也不会自动补表。

查看表结构（交互输入 `.env` 中你自己的 `MYSQL_PASSWORD`，不要把密码写在命令行）：

```bash
docker compose exec mysql mysql --user=cyl --password cyl_openplatform
```

连接成功后执行本页“检查初始化结果”中的 SQL。

## 手动初始化

适用于不用 Docker、已有独立 MySQL 服务的用户。以下命令在仓库根目录执行，以 `127.0.0.1:3306` 为例；远程或其他端口请替换地址。需要 MySQL 命令行客户端。先完成 `python3 scripts/setup-local.py`，再由数据库管理员建库与授权：

```bash
mysql --host=127.0.0.1 --port=3306 --user=root --password
```

在 MySQL 客户端中执行以下 SQL。**先把密码占位替换为你生成的 `.env` 中的 `MYSQL_PASSWORD`**；不要照抄占位字符串。示例限定同机回环连接，远程部署的用户 Host 应按实际来源配置。

```sql
CREATE DATABASE cyl_openplatform CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;
CREATE USER 'cyl'@'127.0.0.1' IDENTIFIED BY 'REPLACE_WITH_YOUR_MYSQL_PASSWORD';
GRANT ALL PRIVILEGES ON cyl_openplatform.* TO 'cyl'@'127.0.0.1';
EXIT;
```

若已存在同名库或用户，先检查其归属与是否为空；不要覆盖其他项目资源。使用专用用户导入公开 SQL：

```bash
mysql --host=127.0.0.1 --port=3306 --user=cyl --password \
  --default-character-set=utf8mb4 cyl_openplatform < sql/init.sql
```

导入后修改 `config/local/private/application.properties`，将数据库 URL 的端口改为实际端口，用户名/密码保持与刚创建的用户一致；Redis 地址/端口也要指向自己启动的服务。该配置由脚本生成，不会自动创建 MySQL 用户或修改独立数据库密码。然后回到 [构建并运行](../docs/quickstart.md#4-构建并运行)。

## 检查初始化结果

连接到目标库后执行：

```sql
SELECT COUNT(*) AS table_count
FROM information_schema.tables
WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE';
SHOW TABLES LIKE 'catalog_api_copy_request';
SELECT tenant_id, user_id, employee_no, enabled, super_administrator
FROM platform_administrator;
SELECT permission_code FROM platform_administrator_permission
WHERE administrator_id = 'local-admin' ORDER BY permission_code;
```

当前全新安装预期：44 张表；存在 `catalog_api_copy_request`；管理员为 `local / local-admin / admin` 且已启用、具备总管理员资格；最后一条返回七项权限。表数是初步核对，登录成功及 [真实调用示例](../docs/first-api.md)仍需执行。

## 早期安装缺少 API 复制记录表

早期初始化清单漏收了 `api-copy-schema.sql`，只创建了 43 张表；这会导致复制 API 时缺表。新 `init.sql` 已包含它。**已有库不要重导整份 init.sql。** 先备份并运行上面的 `SHOW TABLES`；确认该表不存在时，仅执行公开的 [api-copy-schema.sql](../cyl-openplatform-infrastructure/src/main/resources/db/api-copy-schema.sql)：

```bash
# 独立 MySQL：按你的地址、端口和数据库名调整。
mysql --host=127.0.0.1 --port=13306 --user=cyl --password \
  --default-character-set=utf8mb4 cyl_openplatform \
  < cyl-openplatform-infrastructure/src/main/resources/db/api-copy-schema.sql
```

Compose 用户也可在仓库中打开该文件，将其中的建表语句复制到 `docker compose exec mysql mysql --user=cyl --password cyl_openplatform` 的交互会话执行。它只补复制请求记录表，不修改既有 API 数据。补表后在后台复制一条 API，确认生成新草稿。

其他版本的升级依据实际差异制定，见 [升级与回退](../docs/operations.md#6-升级和回退)。不能把所有历史升级 SQL 无差别执行一遍。
