# 变更记录

## Unreleased — 0.1.0-SNAPSHOT

### 平台基线

- 独立开源工程、`io.github.chenyilei2016`包名与Apache-2.0许可证。
- 公共依赖构建、本地账号实现与浏览器身份/账号认证/人员目录SPI。
- API工作区、发布、租户授权、Token、门户、治理及Provider SDK等既有能力。
- 独立初始化脚本、MySQL/Redis Compose和CI定义。

### 初始化修复

- 新增公开的 `sql/init.sql`，Compose 直接挂载；安装不再依赖未提交的 `.local/init`。
- 补入遗漏的 `catalog_api_copy_request` 表，提供旧库单表修复说明。
- 增加 Schema 清单、持久化表引用与公开 SQL 同步检查，以及初始化脚本回归。

### 入门与文档

- 重排 GitHub 首页：技术徽标、带说明的截图、折叠预览、直接可达的 SQL / 密码 / Demo 入口。
- 区分公开安装材料与使用者生成文件，补齐手动建库、密码重置、Demo 结果和重复运行说明。
- README、文档导航、安装、首个API、使用、配置、调用、运维、开发、SPI/SDK与排障手册。
- 真实演示截图、可运行订单Provider脚本和首个API示例。
- 修复公共Boot Parent下Provider重复repackage导致的错误Start-Class。
- 明确开发版分发方式、权限链路、环境隔离和已验/未验边界。

本节尚未发布为正式版本。历史本机验证详情在 [验证记录](docs/verification.md)，不以它替代正式发行说明。
