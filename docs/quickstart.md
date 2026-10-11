# 快速开始

[文档首页](README.md) / 快速开始 → [第一个 API](first-api.md)

目标：仅凭 GitHub 下载的源码，启动你自己的平台、登录后台并确认依赖正常。无需维护者的 `.local`、私有配置或数据库。初始库只有结构和管理员资格，API 列表为空；[下一步演示](first-api.md)会创建可调用的订单 API。

GitHub 不运行后端、数据库或 Provider。本指南让它们在你的电脑运行，便于入门；服务器部署见 [运维指南](operations.md)。

## 1. 检查环境

以下命令在 Bash 终端执行。macOS / Linux 可直接使用；Windows 建议使用 WSL2，并在同一WSL发行版内安装JDK/Node/Python、启用Docker Desktop的WSL集成。不要混用Windows与WSL的路径或各自的localhost。Windows原生脚本未验收。

| 工具 | 要求 | 检查命令 |
| --- | --- | --- |
| Java | JDK 25（不只是JRE） | `java -version`、`javac -version` |
| Maven | 3.8+；Maven使用的Java也须为25 | `mvn -version` |
| Node.js | 22.13+ | `node -v` |
| pnpm | 11.12.0，与仓库packageManager一致 | `pnpm -v` |
| Python | 3.9+，使用标准库 | `python3 --version` |
| OpenSSL | 支持 `genpkey` 和 `pkey` | `openssl version` |
| Docker / Compose | Docker可运行，Compose v2支持`--wait` | `docker info`、`docker compose version` |

缺少pnpm时，可在已有Node后执行 `npm install -g pnpm@11.12.0`。本仓Maven命令显式使用公共仓库配置；npm默认registry.npmjs.org。未承诺最低内存容量，首次Java编译、前端安装与数据库同时运行需留出足够内存和磁盘空间。

## 2. 获取源码并初始化

```bash
git clone https://github.com/ChenYilei2016/cyl-openplatform.git
cd cyl-openplatform
python3 scripts/setup-local.py
```

**此后所有命令默认从仓库根目录执行，新开的终端也要先进入该目录。** 输入12至256字符的初始管理员密码并确认；终端不回显密码。

### 仓库文件与本机生成文件

下面这些文件**已经随 GitHub 源码提供**，点击即可阅读；用户不需要自行补文件：

| 文件 | 用途 |
| --- | --- |
| [sql/init.sql](../sql/init.sql) | 全新 MySQL 空库初始化，44 张表及首位管理员资格 |
| [sql/bootstrap-admin.sql](../sql/bootstrap-admin.sql) | 管理员种子来源；已合入 init.sql，无需重复执行 |
| [配置模板](../config/local/application.example.properties) | 查看完整的最小外部配置字段；使用 setup 时无需另行复制 |
| [compose.yaml](../compose.yaml) | 创建数据库/用户、自动挂载公开 SQL，启动 MySQL/Redis |
| [订单 API 配置](../examples/first-api/order-query.json)、[演示脚本](../scripts/demo/first-api.py) | 完成后续真实 API 发布与调用 |

`setup-local.py` 只生成**属于你这个安装实例**的配置，不连接数据库，也不生成建表 SQL：

| 文件 | 用途 | 是否进入Git |
| --- | --- | --- |
| `config/local/private/application.properties` | 数据库密码、本地账号摘要、Provider私钥 | 否 |
| `config/local/private/provider-public.pem` | 提供方信任公钥 | 否 |
| `.env` | Compose所需的MySQL密码 | 否 |

脚本不会连接数据库。已有配置时会拒绝覆盖，这是保护既有账号和数据；继续使用现有配置即可，不要为通过初始化而删除文件。非交互方式支持 `--password-file /path/to/password.txt`，文件由使用者提供并妥善保管。

### 管理员密码在哪里

- 登录用户名是 `admin`，租户是 `local`，密码就是上面由你输入的值；没有 `admin/admin` 之类的默认密码。
- 明文不会被脚本保存。`config/local/private/application.properties` 中的 `open-platform.accounts.users[0].password-hash` 是摘要，不能拿它直接登录或还原密码。
- `.env` 中的 `MYSQL_PASSWORD` / `MYSQL_ROOT_PASSWORD` 是数据库密码，**不是后台登录密码**。
- SQL 只保存管理员资格，不保存登录密码。账号身份与种子授权按 `local` / `local-admin` / `admin` 对应；第一次启动先保持默认身份。
- 忘记密码：执行 `python3 scripts/password-hash.py`，将输出摘要替换上述 `password-hash` 的值，再重启平台；详见 [账号维护](operations.md#2-账号维护)。

## 3. 启动依赖

先启动Docker，然后执行：

```bash
docker compose up -d --wait
docker compose ps
```

预期mysql、redis均为healthy。Compose只运行两项基础依赖，平台JAR仍在宿主机运行：

| 服务 | 宿主机地址 | 容器内端口 |
| --- | --- | --- |
| MySQL 8.4 | `127.0.0.1:13306` | 3306 |
| Redis 7.4 | `127.0.0.1:16379` | 6379 |

数据库名 `cyl_openplatform`、应用数据库用户 `cyl`。Compose 直接挂载 [sql/init.sql](../sql/init.sql)，仅在**空数据卷首次初始化**时执行。已有卷不会因重启重新导入SQL，修改 `.env` 也不会自动修改已有MySQL用户的密码。

## 4. 构建并运行

```bash
bash scripts/build.sh
bash scripts/run-local.sh
```

首次构建会下载依赖；完成后可找到 `cyl-openplatform-server/target/cyl-openplatform-server.jar`。脚本构建包含前端的JAR，但使用`-DskipTests`，不等于执行了全量回归。完整测试命令在 [开发指南](development.md)。

启动日志应出现 `Started OpenPlatformApplication`，另开终端验证：

```bash
curl -f http://127.0.0.1:18080/actuator/health
```

预期响应包含 `"status":"UP"`。打开 <http://127.0.0.1:18080/admin/>，以 `admin` 和第2步设置的密码登录。初始管理员有全部七项业务管理权限和总管理员资格。门户入口是 <http://127.0.0.1:18080/portal/>。

![本地账号登录](images/login.jpg)

## 5. 停止、重启与修改端口

- 当前前台终端按 `Ctrl+C` 停止平台，再运行 `bash scripts/run-local.sh` 即可重启。
- `docker compose stop` 停止依赖，`docker compose start` 重新启动。
- `docker compose down` 移除容器/网络但保留数据卷；不要为了修复普通启动问题增加`-v`。
- 平台改端口：`bash scripts/run-local.sh --server.port=18081`。前端开发代理和调用地址也要调整。
- MySQL/Redis端口冲突：同时调整Compose宿主机映射和私有配置中的对应连接地址，不要停止其他项目的进程。

## 不使用 Docker

前两步仍需执行，以生成登录配置和 Provider 密钥。自行安装 MySQL 8.4 / Redis，按 [数据库初始化指南](../sql/README.md#手动初始化)创建空库和专用用户，再导入仓库里的 `sql/init.sql`。修改私有配置中的数据库地址、账号、密码和 Redis 地址/端口；生成的 `.env` 仅供 Compose 使用，不会自动配置你已有的数据库。

完成后接第 4 步构建、启动。当前已实际验收独立 MySQL/Redis；Compose 与各操作系统的验证范围见 [项目状态](status.md)。

## 启动成功后

继续 [第一个 API](first-api.md)，在独立订单服务上完成发布、授权和调用。遇到依赖连接、密码或页面错误，先看 [FAQ](faq.md)，不要从删除数据卷或重建配置开始。
