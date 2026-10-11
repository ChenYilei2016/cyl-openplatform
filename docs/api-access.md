# 调用与鉴权

[文档首页](README.md) / 调用与鉴权

## 三种身份不要混用

| 场景 | 使用方式 | 是否携带后台Cookie |
| --- | --- | --- |
| 管理员/门户人员操作 | 平台登录会话 + 写请求CSRF | 是，同源浏览器 |
| 客户应用调用API | AppKey/AppSecret换Token，或专用请求签名 | 否 |
| 平台调用业务Provider | 平台生成环境级RSA身份证明 | 由平台SDK处理，不转发浏览器Cookie |

登录密码、AppSecret、请求签名Secret和Provider私钥是不同的凭据。发布API或成为总管理员都不会自动授予某个业务应用调用资格。

## 普通 Token 调用

### 1. 获取 Token

```http
POST /api/token
Content-Type: application/json

{
  "appKey": "替换为创建时得到的32位AppKey",
  "appSecret": "替换为对应Secret",
  "tenantId": "local"
}
```

平台校验标准应用凭据、应用启用状态、目标租户绑定与有效权限组。员工调用另加`employeeNo`，同时要求当前人员有效且已在该租户绑定下获得该应用委托；不要传入自行选择的可信用户ID。

响应`data.accessToken`用于后续调用。默认TTL为7天，可配置；不要把一次签发结果当成永不失效的身份。`existingToken`可传入已有Token以按服务端规则复用，不能绕过授权版本校验。

### 2. 调用已发布API

```bash
# Bash 中粘贴上一步 data.accessToken 的值，输入不回显。
read -r -s -p 'Token: ' TOKEN
# 以下订单调用的输入只有 orderNo。
curl -X POST 'http://127.0.0.1:18080/api/oauth/demo_orders/v1/query' \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  --data-binary '{"orderNo":"COMMON-001"}'
unset TOKEN
```

```json
{
  "code": 200,
  "resultMsg": "成功",
  "data": {"orderNo":"COMMON-001","tenantId":"local","amount":101.25,"status":"PAID"},
  "requestId": "本次请求号"
}
```

URL中的`oauth`是现有业务调用路由名，不表示本项目实现完整OAuth 2.0授权服务器。输入是JSON业务字段；身份取自Token。`tenantId`映射使用`CONTEXT`，不允许客户端通过额外身份头覆盖。

### 3. 生命周期端点

| 方法与路径 | 请求与作用 |
| --- | --- |
| `POST /api/token` | AppKey、AppSecret、tenantId、可选employeeNo/existingToken |
| `POST /api/token/introspect` | Bearer头，空正文或`{}`；核验当前Token上下文 |
| `POST /api/token/refresh` | Bearer头及AppKey/AppSecret；按服务端规则刷新 |
| `POST /api/token/revoke` | Bearer头，空正文或`{}`；撤销当前Token |

不要将Token放入URL、日志、公开截图或浏览器持久化存储。`refresh`和`revoke`会改变状态，不能作为无副作用的网络探活。

## 权限规则：分清调用范围和文档范围

**普通Token/签名调用：** 标准应用有效 + 应用与目标租户绑定有效 + 员工委托（如需要）有效 + API的有效权限组与凭据有效权限组至少一个匹配 + 已发布且可调用。平台还执行当前授权版本、治理及生命周期校验。

**门户/MCP范围：** 使用租户显式获授的权限组或标为公共的有效权限组，结合对应入口的其他资格与发布过滤。权限组的`publicAccess`不是“无需Token的匿名业务调用”开关，也不会自动给所有普通应用增加该权限组。

依据分别是`ApplicationAuthorizationService`、`ApiInvocationExecutor`与`TenantScopeAccessService`。如果只操作“租户权限”但没有给普通凭据分配权限组/建立绑定，普通API仍可能403；反之，不要把门户隐藏当成阻止已授权调用的安全策略。

## 可选：HMAC 请求签名

入口 `POST /api/sign/{service}/{version}/{method}`。先通过管理端建立专用签名密钥，并配置 [签名Secret保护密钥](configuration.md)；签名Secret不是AppSecret。

当前协议保留兼容命名：

```text
Authorization: SZ-HMAC-SHA256 <keyId>:<64位小写十六进制签名>
X-SZ-Tenant: <tenantId>
X-SZ-Employee: <employeeNo，可省略>
X-SZ-Timestamp: <Unix秒>
X-SZ-Nonce: <32位小写十六进制随机值>
Content-Type: application/json
```

待签名串按换行连接，末尾没有额外换行：

```text
SZ-HMAC-SHA256
POST
<原始请求路径，不含scheme/host>
<keyId>
<tenantId>
<employeeNo，省略时为空行>
<timestamp>
<nonce>
<SHA256(原始UTF-8正文)的小写十六进制>
```

签名Secret由服务端以Base64URL（无padding）返回；先解码成32字节密钥，再对该串做HMAC-SHA256。不要直接把Base64文本当作HMAC密钥。不要重排JSON、二次序列化正文、压缩正文或让代理改写路径后再发送；不允许混用Bearer和签名。时间窗、nonce防重放及授权规则由服务端执行。当前时间窗以Redis时间为准，允许前后300秒；防重放集合首次建立或丢失后进入601秒保护恢复期，期间返回503，不能清空Redis来绕过等待。

可运行的签名参考在 [前端请求签名实现](../cyl-openplatform-web-shared/src/documentation/requestSigning.ts) 与 [服务端校验](../cyl-openplatform-domain/src/main/java/io/github/chenyilei2016/openplatform/domain/signature/SignedRequest.java)。`SZ-*`是当前线协议字面值，包名已变更不代表请求头也改名。

## 错误处理

| HTTP / code | 意义 | 下一步 |
| --- | --- | --- |
| 400 / 40000001 | 参数、JSON、路径或映射不合法 | 看字段错误与文档，修正后再发 |
| 401 / 40100001 | 浏览器未登录 | 重新登录平台 |
| 401 / 40100002 | 应用凭据无效 | 核对AppKey/Secret与凭据类型 |
| 401 / 40100003 | Token无效、过期或授权变更 | 核对授权后重新获取Token |
| 401 / 40100004 | 签名无效 | 核对原始正文、时间、nonce、密钥和路径 |
| 403 / 40300001 | 授权、租户、人员或治理拒绝 | 查看具体链路，不无限重试 |
| 404 / 40400001 | 路由或生效资源不存在 | 核对环境、三段路由和发布状态 |
| 409 / 40900001 | 并发状态冲突 | 重新读取当前修订/发布状态 |
| 409 / 40900002 | 幂等重复提交 | 先查询原操作结果 |
| 410 / 41000001 | API已退出 | 迁移到有效版本 |
| 413 / 41300001 | 请求过大 | 按字段约束拆分请求 |
| 429 / 42900001 | 超出治理限额 | 按响应与业务重试策略退避 |
| 502 / 50200001、50200002 | 提供方调用失败或业务拒绝 | 按requestId查调用阶段和提供方 |
| 503 / 50300001 | 依赖不可用 | 检查数据库、Redis或身份适配器 |
| 504 / 50400001 | 下游超时 | 核对耗时、连接和超时配置 |

副作用请求超时不代表未执行。没有明确幂等契约时，不要自动重放。错误输出是脱敏边界，内部日志也不应保存完整Secret/Token。

## Java 客户端运行示例

先运行首次API示例并取得Token，再从仓库根目录构建客户侧示例：

```bash
mvn -s config/build/maven-settings.xml -B -f examples/java-client/pom.xml package dependency:copy-dependencies
export OPEN_PLATFORM_BASE_URL=http://127.0.0.1:18080
export OPEN_PLATFORM_AUTH=BEARER
# Bash交互读取Token，避免将真实值写入命令历史。
read -r -s -p 'Token: ' OPEN_PLATFORM_TOKEN
export OPEN_PLATFORM_TOKEN
java -cp 'examples/java-client/target/classes:examples/java-client/target/dependency/*' \
  io.github.chenyilei2016.openplatform.client.OrderExample demo_orders v1 query
unset OPEN_PLATFORM_TOKEN
```

classpath分隔符为Bash/macOS/Linux写法，Windows请按快速开始使用WSL。此例使用Java8源码兼容基线，本轮实际在JDK25运行验证；不要混同为所有Java8发行版运行矩阵已验收。
