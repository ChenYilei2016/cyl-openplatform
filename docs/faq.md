# 常见问题与排障

[文档首页](README.md) / FAQ。每次排障先保留：版本、发生时间、HTTP状态、脱敏的错误码和requestId。

## 安装与启动

### GitHub 上找不到 `.local`、私有配置或初始化 SQL？

初始化 SQL 已公开在 [sql/init.sql](../sql/init.sql)，下载仓库后即可导入，Compose 也直接挂载它。`.env` 与 `config/local/private` 由你运行 `python3 scripts/setup-local.py` 后生成；`.local` 中的 Provider 配置、演示凭据和运行记录由对应运行脚本生成，首次使用不需要这个目录。不要索取或复制别人的私有文件。

### 库是空的，演示数据在哪里？

建表 SQL 只创建结构及初始管理员资格。启动后按 [第一个 API](first-api.md)运行公开演示脚本，它通过正式接口创建 API、发布、授权和凭据，并请求真实订单 Provider；[API JSON](../examples/first-api/order-query.json)可在 GitHub 直接查看。

### `invalid target release: 25` 或 Maven 使用了旧 Java

`java -version`和`mvn -version`都要确认。Maven可能使用另一个JAVA_HOME；设置JDK25并重新打开终端，不要仅修改pom的release数字。

### pnpm 启动失败或 Node 版本不符

使用Node22.13+与pnpm11.12.0。尤其不要用旧Node运行新pnpm。安装使用`--frozen-lockfile`，不要通过随意删除锁文件改变依赖版本。

### 初始化提示“已有文件”

说明配置已存在，正常重启无需再次初始化。确认原配置与数据库是否仍匹配。脚本不覆盖，是为了保留已有密码、密钥和数据；不要删除`.env`后重新生成并期望已有数据库密码自动改变。

### Docker daemon 未运行、`--wait` 不识别或端口占用

先运行`docker info`和`docker compose version`。启动Docker，使用支持`--wait`的Compose v2；端口冲突时同时修改映射与私有配置。不要停止其他项目进程，也不要直接删除数据卷。

### MySQL Access denied / 表不存在

检查私有配置中的地址、数据库名、用户、密码与实际数据库一致。全新Compose卷才运行初始化SQL；已有卷不会再次执行。`spring.sql.init.mode=never`，Java启动不负责补表。区分“用户密码不匹配”和“SQL没有导入”。[SQL 指南](../sql/README.md)提供检查命令；早期版本只建了 43 张表，遗漏 `catalog_api_copy_request`，已有库按该指南补这一张表，不能重复导入整份初始化 SQL。

### 健康检查503或业务提示依赖不可用

查看MySQL和Redis连接，不要只看进程存在。服务运行在容器里时，`127.0.0.1`指容器自己；本仓快速开始让JAR运行于宿主机。自建容器部署需自行配置可达地址。

### Java运行但后台空白 / `/admin/`404

先执行`pnpm run build:web`，再重新Maven打包，前端dist在打包时嵌入JAR。旧JAR不会自动读取最新前端源码。也可使用Vite开发服务器。

### Provider JAR出现大量重复`JarLauncher`异常

核对实际JAR来自当前源码。公共Boot Parent的repackage应只执行一次；示例POM使用`id=repackage`与`exec` classifier。用`mvn -s config/build/maven-settings.xml -pl examples/order-provider -am clean package -DskipTests`重新构建，不要继续运行旧产物。

## 账号与身份

### 默认密码是什么？忘记密码怎么办？

没有公共默认密码；初始密码由setup时输入。部署者可运行`password-hash.py`生成新摘要，更新对应本地账号配置并重启。不要为此重建库或轮换Provider密钥。

### 登录成功却提示没有后台资格

账号认证与数据库管理员资格分离。核对tenant/user/employee ID和工号是否与管理员记录一致，账号/资格是否启用，以及管理员是否有操作所需权限。先由已有总管理员分配；锁定恢复见 [运维指南](operations.md)。

### 配置中文租户名/人员名乱码

`.properties`使用Java Unicode转义，或改用UTF-8 YAML并配置正确的外部文件路径。setup已自动转义。修改后重启，重新登录核对门户会话；不要通过改数据库主键修复显示名。

### 后台能GET，但POST/PUT返回403

检查同源Cookie与最新`X-CSRF-Token`。登录会轮换会话，旧Token不能继续使用。后台Cookie/CSRF不能用于普通业务Token调用。

## 发布与调用

### API保存成功，但调用404

保存只是草稿。检查审核、实际生效版本、启用状态、逻辑环境和`service/version/method`；不要以页面草稿修订作为正式调用版本。

### “分类无效”或“负责人不能自由填写”

先创建分类；API请求的`category`传已维护的分类名称。`owner`传已验证员工档案的稳定ID，而不是姓名或工号。页面选择器和演示脚本会处理这些值。

### 文档看得见但调用403，或凭据有权限却门户看不到

两者使用不同范围：普通API看凭据权限组和租户绑定；门户/MCP看租户可用/公共权限组及发布展示状态。请按 [授权规则](api-access.md)逐项核对，不把公共文档视为匿名调用许可。

### Token有效但API仍拒绝员工身份

该API可能要求员工，或字段映射引用了员工上下文。需要真实有效人员和显式员工委托，再签发带employeeNo的Token。不能靠请求体或伪造头补入身份。

### Provider健康但平台调用失败

健康端点不需要业务身份证明。检查平台私钥与Provider公钥是否配对、key-id/environment-id是否一致、映射是否提供正确tenantId，以及Provider业务数据是否属于目标租户。不要关闭Provider验证来解决403。

### 返回外壳失败 / 成功值匹配不上

选对DIRECT或ENVELOPE；核对成功路径、数据路径和成功值类型。`0`与`"0"`不同；不能把HTTP200一律当业务成功。

### 签名失败、nonce重复或保护密钥未配置

请求签名Secret与AppSecret不同。核对当前协议头、原始UTF-8正文、原始路径、Unix秒和随机nonce；保证机器时间同步。签名Secret须先按Base64URL解码。防重放状态首次初始化或丢失时，当前实现等待601秒后恢复，期间503是保护行为，不应反复清空Redis。签名密钥的AES保护配置是可选功能前提，不影响普通Bearer示例。

### 409、429、504是否可以直接重试？

409先读取原结果/版本；429按治理策略退避；504不代表提供方没有执行。只有明确无副作用或有幂等契约的调用才适合重试，不能无界重放。

### 演示脚本中断了

先看`.local/state/demo/first-api.json`是否已有凭据。已经创建完成仅Provider不可用时，启动Provider并`--check`。早期部分完成时，后台核对已记录与未记录资源后使用`--resume`。不要删除状态文件盲目重复创建。

## 部署与项目状态

### 不用Nacos可以运行吗？其他Boot/Java版本可用吗？

默认固定URL示例不需要Nacos。平台宿主使用JDK25/Boot4；Provider SDK核心兼容Java8，Boot2/Boot4使用对应starter。具体支持和实测边界见 [项目状态](status.md)。

### 多实例登录会话是否自动进Redis？

不会。当前HttpSession在单JVM中，使用会话粘滞或外部浏览器身份SPI。业务Redis用于治理、防重放和幂等，不是共享浏览器会话的承诺。

### 可以直接下载官方应用镜像或Maven制品吗？

当前开发版以源码为入口，未提供已发布的应用镜像或公共Maven制品。仓库Compose只有MySQL/Redis；Provider SDK先本地install。不要使用猜测的镜像标签或坐标版本。

仍不能解决时，提交 [Issue](https://github.com/ChenYilei2016/cyl-openplatform/issues/new?template=bug_report.yml)，说明期望、复现步骤、版本和脱敏日志。安全问题按 [SECURITY](../SECURITY.md)处理。
