# Provider SDK：接入自己的业务服务

[项目首页](../README.md) / [文档导航](../docs/README.md) / Provider SDK

**这个SDK安装在业务提供方，而不是客户应用。** 它验证平台生成的身份证明，向业务代码提供可信租户/人员上下文。客户应用通过Token调用网关，不持有Provider私钥。

## 1. 选择模块

| 模块 | 用途 / 宿主 |
| --- | --- |
| `openapi-provider-sdk-core` | Java8标准库核心；RSA签名验证、身份和目标协议 |
| `openapi-provider-sdk-spring-boot2-starter` | Spring Boot2 / javax Web提供方 |
| `openapi-provider-sdk-spring-boot4-starter` | Spring Boot4 / Jakarta Web提供方 |
| `openapi-provider-sdk-dubbo-apache` | Apache Dubbo过滤器；提供方声明需要的平台身份 |

groupId统一为`io.github.chenyilei2016`，当前版本`0.1.0-SNAPSHOT`。两个Spring starter二选一，不要在同一宿主同时导入。核心Java8兼容不代表Boot4也能运行在Java8；实际运行下限取决于宿主。

SDK还未发布公共Maven制品。先从仓库根目录本地安装：

```bash
mvn -s config/build/maven-settings.xml -B -f openapi-provider-sdk/pom.xml install
```

Boot4提供方依赖示例：

```xml
<dependency>
    <groupId>io.github.chenyilei2016</groupId>
    <artifactId>openapi-provider-sdk-spring-boot4-starter</artifactId>
    <version>0.1.0-SNAPSHOT</version>
</dependency>
```

私有环境可以把经过验证的SDK版本发布到自己的仓库；公共平台内核不因此加入私有SDK依赖。

## 2. 建立平台信任

平台保存RSA私钥，Provider只保存配套公钥。至少2048位，私钥PKCS8、公钥X.509，支持PEM或Base64 DER。两端的environment-id与key-id必须对应。

```yaml
open-platform:
  provider:
    environment-id: local
    public-keys:
      local-platform: |
        -----BEGIN PUBLIC KEY-----
        用实际平台公钥内容替换这里
        -----END PUBLIC KEY-----
```

复制初始化生成的`config/local/private/provider-public.pem`内容，不能把私钥放进这个配置。这个YAML是格式示例，占位内容不能用于启动。

受保护接口收到直接调用、伪造租户头或错误证明时会被拒绝。业务服务健康端点可以正常返回UP，因此“健康”和“通过业务身份验证”是两件事。

## 3. HTTP 接入（Boot4 示例）

在已有Controller上声明入口，并从SDK取得身份：

```java
import io.github.chenyilei2016.openplatform.provider.OpenPlatformApi;
import io.github.chenyilei2016.openplatform.provider.CurrentOpenPlatformIdentity;
import io.github.chenyilei2016.openplatform.provider.OpenPlatformIdentity;

@OpenPlatformApi
@PostMapping("/internal/orders/query")
public OrderResult query(@RequestBody OrderQuery query,
                        @CurrentOpenPlatformIdentity OpenPlatformIdentity identity) {
    return orders.query(query.orderNo(), identity.getTenantId(), identity);
}
```

这里的`OrderQuery/OrderResult/orders`由业务服务提供；完整可运行实现见 [OrderQueryController](../examples/order-provider/src/main/java/io/github/chenyilei2016/example/order/OrderQueryController.java)。需要人员身份的入口使用`@RequireOpenPlatformEmployee`，读取到可信身份后仍需执行本业务的数据权限。

如果需要按路径整体保护，可配置`open-platform.provider.protected-paths[]`；不要把已接入路径留为可绕过的匿名旁路。HTTP绑定的对外请求结构、目标URL与字段映射在平台工作区维护。

运行仓库示例：

```bash
bash scripts/build.sh
bash scripts/run-example-provider.sh
```

默认HTTP8091、Dubbo20881；业务租户local。脚本生成的运行文件在`.local/runtime`，不会覆盖长期私有配置。完整接入步骤见 [第一个API](../docs/first-api.md)。

## 4. Apache Dubbo 接入

添加`openapi-provider-sdk-dubbo-apache`，由业务宿主继续管理Dubbo版本、注册中心、序列化和生命周期；SDK不替宿主启动注册中心。

按示例为目标服务配置身份过滤器和证明验证组件，再在后台选择受控连接、发现方式与固定连接修订，核对：

- 提供方应用名、Java全限定接口名。
- 方法名、准确参数类型数组及重载选择。
- group、version和注册中心namespace/group。
- Provider的environment-id、公钥key-id与平台配置。

可运行装配见 [OrderDubboConfiguration](../examples/order-provider/src/main/java/io/github/chenyilei2016/example/order/rpc/OrderDubboConfiguration.java) 和 [SDK Dubbo模块](openapi-provider-sdk-dubbo-apache)。仓库订单服务默认直连、无Nacos；平台后台的受控连接发现/元数据流程需要部署相应基础设施，不能把样例直连当作注册中心验收。

## 5. 两类响应处理

- 返回纯业务对象：平台配置`DIRECT`。
- 返回`{code,message,data}`等信封：平台配置`ENVELOPE`，填写实际成功路径和值、数据路径、消息路径。数字成功码和字符串成功码不可混用。

样例的`/internal/orders/query`直接返回对象，`/internal/orders/lookup`返回code/message/data。订单不存在、租户不匹配与员工不匹配有不同业务结果；不要统一伪装成功。

## 6. 客户端SDK不是本SDK

[examples/java-client](../examples/java-client) 是客户侧Java8+调用示例，使用OkHttp和业务Token；门户自动生成的cURL/Java/Python等示例也属于客户侧。它们不应导入Provider信任私钥。

本轮已验证真实HTTP订单链路；Dubbo跨网络、外部注册中心与所有宿主矩阵仍按 [项目状态](../docs/status.md)记录，不能由JAR存在推断兼容性。
