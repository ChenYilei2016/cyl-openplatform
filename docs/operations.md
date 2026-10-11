# 运维指南

[文档首页](README.md) / 运维。首次启动见 [quickstart](quickstart.md)，配置键见 [configuration](configuration.md)。

## 1. 运行产物与环境

构建产物 `cyl-openplatform-server/target/cyl-openplatform-server.jar` 包含后台、门户和登录页。运行需要JDK25、MySQL、Redis、账号配置和Provider RSA密钥；Provider单独部署。默认单实例、回环监听，当前源码不包含应用Docker镜像或Helm发行包。

```bash
# 自己部署时使用实际绝对路径，避免进程工作目录改变后读不到配置。
OPEN_PLATFORM_CONFIG=/srv/cyl/config/application.yaml   java -jar /srv/cyl/cyl-openplatform-server.jar
```

使用systemd或你的进程管理器设置专用运行身份、工作目录、重启策略和日志输出。建议设置`open-platform.gateway-base-url`为实际对外网关地址，使文档生成正确的接入地址；该值不应含账号、query或fragment。健康入口为`/actuator/health`，只暴露健康信息。不要将actuator管理面或数据库/Redis端口直接公开。

逻辑environment-id是API隔离与Provider证明的一部分。不要把Spring profile、Kubernetes命名空间、数据库名和API逻辑环境ID当成同一个字段；相同环境的节点保持environment-id一致、node-id独立。

## 2. 账号维护

默认账号目录由部署者维护，没有自助注册或密码找回界面。更新账号、密码或enabled后**重启**，适配器在启动时创建不可变索引。

推荐使用UTF-8 YAML：

```yaml
open-platform:
  accounts:
    users:
      - username: admin
        password-hash: "用password-hash.py生成的96位十六进制摘要替换"
        tenant-id: local
        tenant-name: 本地租户
        user-id: local-admin
        employee-id: local-admin
        employee-no: admin
        display-name: 管理员
        enabled: true
      - username: developer
        password-hash: "另一个独立密码摘要"
        tenant-id: local
        tenant-name: 本地租户
        user-id: local-developer
        employee-id: local-developer
        employee-no: dev01
        display-name: 示例开发者
        enabled: true
```

这是账号片段；不能替代数据库、Redis和Provider密钥等完整配置。使用外部YAML时应将原私有文件所需配置一并迁移，避免丢失连接参数。

生成摘要：

```bash
python3 scripts/password-hash.py
```

同一用户名必须唯一；同一租户内user-id、employee-id、employee-no分别唯一。账号的tenant/name/ID都是可信服务器配置，客户端不得覆盖。每次登录后人员展示档案可能被更新，但展示档案不是授权源。

增加账号只会允许其按本地身份进入门户，管理权限还需已有总管理员在“管理员”页面分配。新账号未登录过时，可通过管理员页面输入工号核验，再分配资格。总管理员负责管理管理员，不会自动获得全部七项业务权限；初始化脚本给首位管理员显式赋予全部权限。

密码遗忘时，部署者重新生成摘要、更新对应账号并重启。不要轮换Provider密钥或重建数据库来解决登录密码问题。

## 3. 首位管理员与锁定恢复

全新库导入仓库中的 [sql/init.sql](../sql/init.sql) 建立首位总管理员（种子来源：[bootstrap-admin.sql](../sql/bootstrap-admin.sql)）；`setup-local.py`只生成对应的本地认证配置，生产进程不会自动提权。如果已有库没有可用总管理员：

1. 先核对账号目录中的租户、用户ID、员工ID、工号、enabled和人员状态。
2. 在备份后由授权DBA检查`platform_administrator`及`platform_administrator_permission`中的对应资格，确认是身份不一致还是授权被停用。
3. 通过受控事务恢复经过确认的管理员记录，并保留变更依据；不要导入整份初始化SQL覆盖已有库，也不要删除最后一位管理员。

这是受控恢复流程，不提供绕过认证的HTTP接口。表约束见 [管理员Schema](../cyl-openplatform-infrastructure/src/main/resources/db/administrator-schema.sql)。

## 4. 对外部署

- 在反向代理终止HTTPS，设置`OPEN_PLATFORM_COOKIE_SECURE=true`，按需要更改绑定地址；默认回环服务不能直接供其他机器访问。
- 配置登录限速、连接/正文大小与超时。平台当前本地登录没有完整账号风控系统，对外暴露前需补齐入口保护。
- 默认不信任转发头；只有在代理边界与客户端IP语义明确后才更改对应配置，避免访问控制相信伪造头。
- 同源部署后台和门户，避免把Cookie传给提供方。若采用外部SSO，适配器须正确处理SameSite、回调和CSRF。
- 当前浏览器会话存于单JVM。多实例应使用会话粘滞或实现外部浏览器身份SPI；业务Redis不会自动共享HttpSession。容量、HA、故障恢复需按自己的拓扑验证。

## 5. 备份与恢复

应一起管理：MySQL数据、Redis持久化/运行状态需求、外部账号配置、Provider私钥/公钥和签名Secret保护密钥。只备份数据库而丢失解密密钥可能无法恢复签名凭据。

独立MySQL示例（交互输入数据库密码，不写在命令行）：

```bash
mkdir -p .local/backups
mysqldump --host=127.0.0.1 --port=13306 --user=cyl --password   --single-transaction --no-tablespaces --default-character-set=utf8mb4   cyl_openplatform > .local/backups/cyl-openplatform.sql
```

定期在隔离的新库验证恢复，确认表、管理员、发布与调用链，不能只看备份文件存在。恢复前停止相关写入并明确目标，禁止把回归数据导入其他项目数据库。生产备份保留期、加密与远端副本由部署者按自身要求制定。

Redis保存治理计数、签名防重放与幂等协调状态；不要把随意清空Redis当成普通修复手段。Compose启用AOF，但实际持久化和故障恢复仍须按部署环境核验。

## 6. 升级和回退

当前为开发版，没有稳定跨版本自动迁移承诺。升级前阅读 [CHANGELOG](../CHANGELOG.md)、核对版本对应的Schema变更、备份数据与配置，在隔离环境回放升级并验证登录/发布/调用。

`spring.sql.init.mode=never`，启动不会自动执行数据库升级。`src/main/resources/db/upgrade-*.sql`是各历史结构演进脚本，不是“把所有文件顺序执行”的通用升级器。全新安装使用已提交的 [sql/init.sql](../sql/init.sql)；已有库应基于实际表结构制定明确迁移清单。早期初始化遗漏 API 复制记录表的修复见 [SQL 指南](../sql/README.md#早期安装缺少-api-复制记录表)。

回退JAR前确认数据库结构仍兼容，DDL已改变时单独处理恢复方案。先回退代码并不能保证数据状态也恢复。

## 7. 日常排障

从HTTP状态、`requestId`和实际发生时间定位请求。优先查看平台日志与对应Provider日志，再检查数据库/Redis、授权版本、发布状态和环境。HTTP超时、503与403的处理不同，见 [FAQ](faq.md)。

示例Provider、演示状态与截图均用于本机教学；清理应只针对已确认的演示ID，不提供批量清空生产资源命令。
