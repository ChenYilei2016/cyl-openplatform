# 贡献指南

感谢你帮助完善CYL Open Platform。中文或英文Issue/PR均可；当前手册以中文为主。

## 报告问题

先查 [FAQ](docs/faq.md) 与 [已有Issue](https://github.com/ChenYilei2016/cyl-openplatform/issues)。提交问题时提供：

- 项目版本/提交、JDK/Node/操作系统、部署形态。
- 最小复现步骤、期望与实际行为。
- 脱敏的HTTP状态、错误码、requestId和相关日志。
- 是否使用独立测试资源；不要贴数据库密码、Token、Secret或真实客户数据。

使用 [Bug模板](https://github.com/ChenYilei2016/cyl-openplatform/issues/new?template=bug_report.yml)。安全漏洞按 [SECURITY](SECURITY.md)处理，不在公开Issue中上传利用载荷或密钥。

## 提交改动

1. Fork并创建主题分支；较大的功能先说明用户场景和预期边界。
2. 阅读 [架构](docs/architecture.md)、[开发指南](docs/development.md)和[工程约定](AGENTS.md)。
3. 修改保持聚焦，优先复用既有组件、领域规则和SPI。外部专有依赖应留在私有适配模块。
4. 按风险验证受影响行为，同步手册、示例与截图，不为测试添加生产旁路。
5. 提交PR说明问题、最终行为、测试命令、数据/配置兼容影响及未验边界。

仓库提供 [PR模板](.github/pull_request_template.md)。没有理由时不要同时升级依赖、重排整个目录或重写无关模块。

## 文档贡献

欢迎仅修正文档。命令应能复制执行，说明工作目录、前提和成功结果；示例不要包含真实凭据。截图来自实际界面，来源写入 [截图记录](docs/images/README.md)。至少运行：

```bash
python3 scripts/maintenance/check-layout.py --syntax
```

涉及运行步骤还应实际执行对应步骤，或明确没有可用环境。文档检查不能证明业务正确，也不需要为纯文字修改重跑全部业务测试。

## 许可证

贡献按仓库Apache-2.0许可证提供。引用第三方材料时保留需要的来源和许可证；不要提交无权公开的代码、内部文档或数据。讨论聚焦问题本身，尊重不同背景的贡献者。
