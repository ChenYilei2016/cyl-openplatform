# 配置参考

[文档首页](README.md) / 配置参考

本页列出默认启动与可选能力的关键配置。完整约束以 [属性类目录](../cyl-openplatform-infrastructure/src/main/java/io/github/chenyilei2016/openplatform/infrastructure/properties) 和 [公共配置](../cyl-openplatform-server/src/main/resources/application.properties) 为准。

## 1. 文件与优先级

GitHub 提供 [完整最小配置模板](../config/local/application.example.properties) 和 [初始化工具](../scripts/setup-local.py)。下文“私有文件”指部署者运行工具后在自己环境生成的文件，不是仓库漏传的配置。数据库结构与管理员种子独立公开在 [sql/](../sql/README.md)。

- 公共默认值：server的`application.properties`，不放真实凭据。
- 默认外部文件：`config/local/private/application.properties`；`OPEN_PLATFORM_CONFIG`可改为另一个文件，包括`.yaml`。
- `scripts/setup-local.py`生成的私有文件显式配置了MySQL 13306、Redis 16379、账号和RSA密钥，因此这些值优先于公共文件里的默认连接值。
- `--server.port=...`等标准Spring命令行参数可覆盖配置。使用环境变量时，区分公共文件引用的`OPEN_PLATFORM_*`变量和Spring直接绑定的`SPRING_DATASOURCE_URL`等属性。
- `.env`用于Docker Compose变量替换，`java -jar`不会自动读取它；应用数据库参数在私有文件内。
- 相对路径按**启动进程工作目录**解析。`scripts/run-local.sh`自动切换仓库根目录；手工启动时建议使用外部配置绝对路径。

`.properties`中文值使用Java Unicode转义；初始化脚本已处理。手工维护包含中文的账号目录时，推荐用UTF-8 YAML，再设置`OPEN_PLATFORM_CONFIG`。修改连接、账号和密钥后重启，不依赖隐式热刷新。

## 2. 默认运行

| 属性 | 默认值 / 初始化值 | 说明 |
| --- | --- | --- |
| `server.address` | `127.0.0.1` | `OPEN_PLATFORM_BIND_ADDRESS`；默认仅本机 |
| `server.port` | `18080` | `OPEN_PLATFORM_PORT` |
| `spring.datasource.url` | 默认MySQL3306；初始化后13306 | `OPEN_PLATFORM_DB_URL`提供公共默认值 |
| `spring.datasource.username` | `cyl` | `OPEN_PLATFORM_DB_USERNAME` |
| `spring.datasource.password` | 默认空，初始化生成随机值 | `OPEN_PLATFORM_DB_PASSWORD`或外部文件 |
| `spring.datasource.hikari.maximum-pool-size` | `20` | 数据库最大连接数 |
| `spring.datasource.hikari.connection-timeout` | `5000`ms | 等待连接超时 |
| `spring.sql.init.mode` | `never` | 运行进程不自动建表/升级 |
| `spring.data.redis.host` | `127.0.0.1` | `OPEN_PLATFORM_REDIS_HOST` |
| `spring.data.redis.port` | 默认6379；初始化后16379 | `OPEN_PLATFORM_REDIS_PORT` |
| `spring.data.redis.username/password` | 默认空 | 对应`OPEN_PLATFORM_REDIS_USERNAME/PASSWORD` |
| `spring.data.redis.database` | `0` | `OPEN_PLATFORM_REDIS_DATABASE` |
| `spring.data.redis.connect-timeout/timeout` | `1s` / `1s` | 连接/操作超时 |
| `open-platform.name` | `CYL Open Platform` | 服务端平台名称 |
| `open-platform.gateway-base-url` | 默认空 | 对外网关HTTP(S)基址；空时文档示例要求客户端设置OPEN_PLATFORM_BASE_URL |
| `open-platform.admin-login-url` | `/admin/login.html` | 外部身份模式可指向SSO入口 |
| `open-platform.publish.audit.enabled` | `true` | 发布是否需要审核 |
| `open-platform.token.ttl` | `7d` | 允许60秒至30天 |
| `open-platform.environment-release.environment-id` | `local` | `OPEN_PLATFORM_ENVIRONMENT_ID` |
| `open-platform.environment-release.node-id` | `local` | 多节点应设置不同`OPEN_PLATFORM_NODE_ID` |

## 3. 登录与账号

| 属性 | 默认 / 约束 |
| --- | --- |
| `open-platform.identity.provider` | `local`；外部适配使用`external` |
| `open-platform.accounts.users` | 最多1000条配置账号；用户名与租户内身份唯一 |
| `open-platform.login.required-path-patterns` | 必须包含`/admin-api/**`和`/portal-api/**` |
| `open-platform.login.admin-tenant-ids` | 默认空表示不额外限制租户；仍必须有数据库管理员资格 |
| `server.servlet.session.timeout` | `30m`空闲超时 |
| `server.servlet.session.cookie.name` | `CYL_SESSION` |
| Cookie属性 | HttpOnly、SameSite=Strict、仅Cookie跟踪 |
| `server.servlet.session.cookie.secure` | 默认false；HTTPS部署设`OPEN_PLATFORM_COOKIE_SECURE=true` |
| `server.forward-headers-strategy` | `none`；不会默认相信客户端转发头 |

账号完整字段、增加人员与密码修改见 [运维指南](operations.md)。外部SPI必须自己实现浏览器身份/CSRF，见 [身份扩展](identity-spi.md)。

## 4. Provider 身份证明（必配）

```properties
open-platform.gateway.provider.key-id=local-platform
open-platform.gateway.provider.private-key=你的PKCS8_RSA私钥
```

支持PEM或Base64 DER，RSA至少2048位。初始化已生成本机密钥；真实部署保存在受控外部配置。Provider持有公钥而非私钥，且environment-id必须一致。密钥不能以默认测试值发布给所有用户。提供方配置见 [SDK](../openapi-provider-sdk/README.md)。

## 5. 调用资源上限

| 前缀与属性 | 默认值 |
| --- | --- |
| `open-platform.gateway.http.max-connections` | 128 |
| `open-platform.gateway.http.pending-acquire-max-count` | 64 |
| HTTP `connect-timeout` / `acquire-timeout` | 2s / 1s |
| HTTP `max-concurrent-requests` | 128 |
| HTTP `max-request-bytes` / `max-response-bytes` | 65536 / 262144 |
| HTTP `total-timeout` | 8s |
| `open-platform.gateway.dubbo.max-payload-bytes` | 524288 |
| Dubbo `max-concurrent-requests` | 128 |
| Dubbo `connect-timeout` / `total-timeout` | 2s / 8s |
| Dubbo `max-request-bytes` / `max-response-bytes` | 65536 / 262144 |

单API绑定的超时允许100至30000ms，但仍受平台总体资源和超时约束。不要通过无限增大超时/并发掩盖慢提供方；生产参数应基于自己的压力测试。

## 6. 按需启用的能力

### 服务发现 / Nacos

默认`spring.cloud.nacos.discovery.enabled=false`、`register-enabled=false`。固定URL HTTP不需要注册中心。若选择HTTP服务名发现，应配置部署自己的Nacos地址、namespace、账号及是否注册平台；Dubbo连接在后台按连接模型配置，认证引用放外部配置：

```properties
open-platform.dubbo-connections.credentials.demo-registry.username=部署者提供
open-platform.dubbo-connections.credentials.demo-registry.password=部署者提供
```

该`demo-registry`是后台连接选择的凭据引用，不能把用户名/密码塞入注册中心URL。默认启动没有Nacos配置中心导入；开启Discovery不等于开启远程配置中心。

### 请求签名 Secret 保护

普通Token调用不需要此配置。若管理专用签名密钥，配置256位AES保护密钥：

```properties
open-platform.signature.active-wrapping-key-id=key-2026
open-platform.signature.wrapping-keys.key-2026=32字节随机值的Base64
```

可使用`openssl rand -base64 32`生成后存入私有文件。数据库保存加密后的签名Secret；更换active id时必须保留仍用于历史记录解密的旧保护密钥，不要直接覆盖同一ID的内容。

### 跨环境发布

源环境配置`open-platform.environment-release.targets[]`的`id/name/credential/nodes[]`，目标环境配置`trusted-sources[]`的`id/credential`。来源id与源environment-id一致，credential两端匹配。目标origin必须是HTTPS或回环HTTP，不能含路径、账号、query或fragment。每个目标最多8节点，目标最多20个；应用默认没有任何目标或信任来源。

### 日志与统计

调用记录保留期`open-platform.observability.retention-days=30`，每批清理`cleanup-batch-size=1000`；运营数据`open-platform.operations.retention-days=90`。`response-log-enabled=true`输出有界脱敏摘要，`response-log-max-bytes=2048`。告警评估`open-platform.operations.alerts.evaluation-enabled=true`。调用记录清理`open-platform.observability.cleanup-enabled`和运营清理`open-platform.operations.cleanup-enabled`默认启用；保留期/清理开关需要明确按数据策略配置。更改清理行为前核对保留要求，数据库备份与日志归档独立管理。

进阶工作流、MCP入口及两端跨环境配置示意见 [进阶集成](integrations.md)。
