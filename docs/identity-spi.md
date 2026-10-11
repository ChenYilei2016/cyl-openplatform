# 架构与身份 SPI

根包为 `io.github.chenyilei2016`，平台业务位于 `openplatform` 子包。Maven 坐标 groupId 同为 `io.github.chenyilei2016`。

| 模块 | 职责 |
| --- | --- |
| cyl-openplatform-domain | 业务对象、规则、人员目录等领域端口 |
| cyl-openplatform-application | 用例编排、数据库授权、账号认证端口 |
| cyl-openplatform-infrastructure | MyBatis-Plus 存储、HTTP/Dubbo/Redis 适配、本地账号实现 |
| cyl-openplatform-interface | HTTP 边界、校验、会话和浏览器身份端口 |
| cyl-openplatform-server | 自动装配、JSON配置、前端资源与启动入口 |
| openapi-provider-sdk | 提供方证明协议及 Boot / Dubbo 接入适配 |

## 身份扩展点

1. `identity.BrowserIdentityProvider` 属于接口层，负责从当前 HTTP 请求获得可信身份、提供前端 CSRF Token 和校验写请求。允许私有适配模块使用 SSO Cookie、OIDC 回调或已有登录 SDK。任何外部 SDK 类型都留在适配模块内。
2. `application.identity.AccountAuthentication` 负责账号密码认证及按账号重新读取当前身份，开源版由 `infrastructure.identity.LocalAccountAdapter` 实现。SSO 模式不必实现账号密码登录。
3. `domain.access.EmployeeDirectory` 按租户和工号读取权威人员事实，用于人员委托、管理员登记及其他业务授权。展示缓存不承担身份授权。

浏览器身份返回完整 `EmployeeIdentity`，必须已核验账号与人员对应关系及当前状态；无登录抛 `UNAUTHENTICATED`，无资格抛 `FORBIDDEN`，依赖故障抛 `DEPENDENCY_UNAVAILABLE`，不得透出外部响应或 Token。会话租户取自 SPI，客户端请求头或请求体不能覆盖它。

`PlatformLoginInterceptor` 继续执行租户允许名单、人员资格以及数据库管理员权限检查。认证成功不等于有管理权限，门户与管理端分别建立请求内会话。管理权限和业务审计继续由既有存储管理。

## 接入内部身份适配模块

在私有仓库建立适配模块，依赖领域、应用和接口模块；以 Spring `@Configuration` / 自动配置导出 `BrowserIdentityProvider` 与 `EmployeeDirectory` Bean。公司 SDK、私有 BOM、私有地址和凭据只出现在该模块或私有宿主工程，不加入开源根 POM。

部署设置 `open-platform.identity.provider=external`。此模式不创建本地账号适配器、账号密码登录和注销 Controller；私有适配器自行提供登录/注销回调，并通过 `open-platform.admin-login-url` 指向登录入口。前端写请求统一使用 `X-CSRF-Token`，适配器须完成原 SDK 协议与该请求头的转换。

外部模式要求两种 SPI 都存在，缺少实现时启动失败，不回退匿名或模拟登录。认证和人员目录分别装配，测试或私有环境可以独立替换。

本仓仅包含公开契约和默认本地实现。外部身份适配器由部署者维护，接入后须在真实 SSO / 人员服务上验证，不能以替身装配测试代替外部联调。

## 日志、配置和服务发现

公共 Spring Boot Parent 和公开 BOM 管理构建依赖。SLF4J / Logback 输出标准控制台日志，保留请求号、W3C Trace Context 及既有脱敏异常处理。业务审计落库流程保留；专有日志注解、采集 Appender 和追踪 SDK 不进入开源发行版。

启动配置使用标准 Spring 属性、环境变量和本地外部文件。Nacos 不参与默认启动；需要注册发现的部署可显式启用公共 Nacos Discovery，API 的 Dubbo 连接也可配置公共 Nacos 注册中心。MCP 网关是独立系统，仓库提供平台侧契约，不包含某个公司的网关。

## 接口签名与装配方式

Web适配器的实际契约是：

```java
public interface BrowserIdentityProvider {
    AccountAuthentication.Account current(HttpServletRequest request);
    String csrfToken(HttpServletRequest request);
    void verifyMutation(HttpServletRequest request);
}
```

`Account`携带`username`、完整`EmployeeIdentity`和展示用`tenantName`。领域人员目录只需实现：

```java
EmployeeIdentity find(String tenantId, String employeeNo);
```

私有适配模块的Spring配置若不在平台默认扫描包下，须通过私有宿主的`@Import`或标准自动配置显式导入，不能只把JAR放到classpath就假设Bean已注册。SDK返回的缓存身份必须重新核验当前租户、人员有效状态及账号对应关系；转换异常时保留安全错误码，不返回含Token的SDK响应体。

## 保持前端登录与退出契约

外部模式关闭默认的账号密码Controller。`admin-login-url`控制进入登录的链接，但当前共享退出组件仍调用以下端点，外部适配模块必须提供兼容入口：

| 端点 | 外部适配器责任 |
| --- | --- |
| `GET /auth/csrf` | 返回统一响应，`data.token`为当前会话CSRF值，禁止缓存 |
| `POST /auth/logout` | 校验`X-CSRF-Token`，注销本地/外部会话，返回成功JSON |
| 自定义SSO登录/回调 | 验证state、回调及可信服务端身份，再建立能被current识别的会话 |

后台/门户session响应仍使用`X-CSRF-Token`头，业务代码继续获得同样的可信请求内身份。若外部SDK采用不同请求头或Cookie名称，在适配层转换，不能要求所有业务Controller依赖其SDK类型。

## 最小接入验证

- 未登录访问管理与门户接口为401；伪造租户头不能改变可信租户。
- 已停用账号、离职/替换人员无法沿用旧会话资格；无管理员权限的人员不能访问管理操作。
- 每个写请求校验CSRF，登录回调和注销均完成会话处理。
- 公共文档和普通Token调用不依赖SSO的客户端Cookie。
- 外部服务故障按503等安全错误处理，不降级成管理员、不公开远程错误正文。
- 在真实身份系统验证后，分别记录模拟回归与外部联调结果。
