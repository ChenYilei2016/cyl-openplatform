# 进阶集成：发现、MCP 与跨环境

[文档首页](README.md) / 进阶集成。首次接入先完成固定URL的 [订单示例](first-api.md)，本页能力需要额外基础设施或外部实现。

## HTTP 服务名发现

工作区选择“服务名发现”后，填写注册服务名和请求路径，而不是把一个服务名当成可解析的URL。先配置部署自己的Nacos Discovery并确认Provider已注册且实例地址从平台可达。注册中心的namespace/group、网络和凭据不匹配时，即使后台配置保存成功也不能调用。

`spring.cloud.nacos.discovery.enabled=true`仅启用服务发现；是否注册平台由`register-enabled`控制。默认发行版不导入Nacos配置中心。相关键见 [配置参考](configuration.md)，具体SDK参数以所使用公共Nacos版本为准。

## Dubbo 连接与元数据

1. 在外部配置准备注册/元数据中心凭据引用。
2. 在“Dubbo服务连接”创建与当前environment-id一致的连接，核对注册中心地址、namespace/group、发现模式与元数据模式。
3. 查看服务/方法信息，选定提供方应用、接口、group/version和准确参数类型。
4. 绑定连接及其修订，配置字段映射，先用隔离数据调试再发布。

凭据引用、注册中心URL、元数据中心地址、Provider应用名各有作用，不能互相替代。连接配置更新后，API所绑定的固定修订不会被解释成未经确认的新契约；按工作区提示核对并发布。

仓库订单Provider默认启动无注册中心的Dubbo服务，主要用于受控测试；完整生产注册发现需要你自己的Nacos/元数据部署。本轮已完成的首个API验收使用HTTP，不把它记为Dubbo跨网络验收。

## MCP 平台入口

平台提供供**服务端MCP网关**调用的无会话JSON-RPC入口：

```text
POST /mcp/v1
POST /mcp/v1/sets/{code}
Content-Type: application/json
MCP-Protocol-Version: 2025-06-18
Authorization: SZ-HMAC-SHA256 <网关签名keyId>:<签名>
```

当前实现支持`initialize`、`ping`、`tools/list`、`tools/call`及通知响应；它采用JSON响应，不应当作带SSE/浏览器会话的通用网关。初始化之外要求协议版本头，携带浏览器Origin的请求会被拒绝。

### 准备顺序

1. 为API设置“MCP配置”，用途说明最多255字符，并保存、发布使配置生效。
2. 管理端“MCP接入”创建本环境的专用网关凭据；先配好签名Secret保护密钥。明文签名Secret只在创建/轮换时交给可信网关。
3. 本租户员工在门户开通MCP，管理端可控制租户开通状态；租户由可信会话确定。
4. 外部网关使用专用凭据签名；不能用普通AppKey/AppSecret或Bearer Token代替。网关凭据也不能换取普通业务Token。
5. `tools/call`的租户身份必须在签名覆盖的`X-SZ-Tenant`中；可选员工身份也必须在签名覆盖的头中。平台校验租户MCP开通、可用权限组、当前API发布与人员资格。
6. 从网关到实际Provider完成一次调用，检查JSON-RPC `error`与工具结果`isError`；HTTP200不一定表示工具业务成功。

`tools/list`是工具目录；某工具被列出不保证每个租户都能调用。每次调用仍按租户与身份核验。工具集地址只限定所选工具集合，不授予调用权限。

签名原理见 [调用与鉴权](api-access.md)，精确请求约束见 [McpRequestReader](../cyl-openplatform-interface/src/main/java/io/github/chenyilei2016/openplatform/web/mcp/McpRequestReader.java)，入口行为见 [McpEndpointController](../cyl-openplatform-interface/src/main/java/io/github/chenyilei2016/openplatform/web/mcp/McpEndpointController.java)。这里描述平台实际契约，不包含某个外部网关的部署包；跨系统联调仍需单独完成。

## 跨环境交付

该流程把已经核对的配置送到明确的目标环境，并记录回执。它不自动复制数据库、账号、Secret、分类目录或注册中心资源。

### 两端配置示意

源环境（如`staging`）：

```yaml
open-platform:
  environment-release:
    environment-id: staging
    node-id: staging-a
    targets:
      - id: production
        name: 生产环境
        credential: REPLACE_WITH_SAME_RANDOM_CREDENTIAL_AT_LEAST_32_CHARS
        nodes:
          - id: production-a
            origin: https://api-platform.example.com
```

目标环境（如`production`）：

```yaml
open-platform:
  environment-release:
    environment-id: production
    node-id: production-a
    trusted-sources:
      - id: staging
        credential: REPLACE_WITH_SAME_RANDOM_CREDENTIAL_AT_LEAST_32_CHARS
```

替换为实际地址和随机凭据后才能使用；不要发布示例占位值。Provider的environment-id也需与所在环境匹配，跨环境机器凭据不是Provider RSA私钥。

### 操作与失败处理

1. 在目标环境预先准备有效分类、负责人档案、权限组与连接。
2. 从源环境发起预览，核对目标、差异、目标修订/审核要求，保留固定请求内容。
3. 确认发送后查看各节点回执；需要目标审核时，到目标环境完成审核。
4. 超时或某节点不可达时，先查询回执判断原请求是否成功。重试保留原幂等标识和原正文，不通过换UUID把同一次业务操作变成新的提交。
5. 目标环境再验证API路由、Provider证明、权限及实际调用。

预览成功不是发布成功，文件导出成功也不是目标环境已可运行。跨网络、多节点和外部身份联调的本轮状态见 [项目状态](status.md)。
