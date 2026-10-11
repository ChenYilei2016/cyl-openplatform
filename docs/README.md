# 文档导航

如果你第一次使用，按 **启动平台 → 完成一次调用 → 熟悉管理与授权 → 接入自己的服务** 阅读。文档以本仓当前源码为准，版本状态见 [项目状态](status.md)。

| 顺序 / 场景 | 文档 | 读完应能做到 |
| --- | --- | --- |
| 1. 了解项目 | [项目首页](../README.md)、[界面截图](screenshots.md) | 判断是否符合你的接入场景 |
| 2. 启动 | [快速开始](quickstart.md) | 登录后台，健康检查为UP |
| 按需手动建库 | [数据库初始化](../sql/README.md) | 获取公开 SQL、导入空库、核对 44 张表与初始管理员 |
| 3. 第一次调用 | [第一个API](first-api.md) | 发布示例并拿到真实订单响应 |
| 4. 日常操作 | [使用手册](user-guide.md) | 分清草稿/发布、凭据/账号、应用/租户权限 |
| 5. 客户端集成 | [调用与鉴权](api-access.md) | 获取Token、调用接口、定位错误 |
| 6. 提供方集成 | [Provider SDK](../openapi-provider-sdk/README.md) | 配置信任公钥，接入HTTP/Dubbo服务 |
| 7. 部署维护 | [配置参考](configuration.md)、[运维指南](operations.md) | 管理账号、备份、升级和部署边界 |
| 按需集成 | [服务发现、MCP与跨环境](integrations.md) | 明确外部网关、注册中心与双端信任要求 |
| 8. 深入与扩展 | [架构](architecture.md)、[身份SPI](identity-spi.md)、[开发](development.md) | 找到修改位置，编写并验证适配器 |
| 遇到问题 | [FAQ](faq.md)、[项目状态](status.md) | 按实际症状找到下一步 |
| 贡献与安全 | [CONTRIBUTING](../CONTRIBUTING.md)、[SECURITY](../SECURITY.md)、[变更记录](../CHANGELOG.md) | 规范提交问题、补丁与安全反馈 |

维护者的当次验证记录在 [verification.md](verification.md)，滚动交接在 [继续任务](继续任务.md)。它们是证据/维护记录，不是新用户安装前提。

## 文档维护约定

- 新功能同步更新对应手册；配置默认值以实际属性类和资源为准，避免多个文档维护同一份完整配置表。
- 示例使用独立本机数据，命令标明执行目录、是否写资源及成功结果。无法实测的环境写明验证范围。
- 截图采用真实界面；来源、复现入口和敏感信息检查见 [截图说明](images/README.md)。临时截图留在 `.local`，公开截图只收录 `docs/images` 的精选结果。
- 参考 [XXL-JOB 官方文档](https://github.com/xuxueli/xxl-job/blob/master/doc/XXL-JOB官方文档.md) 的简介、快速入门、功能、配置和排障组织方式；本项目内容按自身代码与实测重新编写，没有复制其实现、截图或项目背书。
