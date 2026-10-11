# 开源迁移验证

日期：2026-10-11。此记录描述本次本机验证，不代表远程生产或公司环境验收。

## Spec

- 新项目位于独立目录，以 `cyl-openplatform` 为项目名，Java 根包和 Maven groupId 使用 `io.github.chenyilei2016`。
- 原项目代码、配置和运行资源保持不变；未复制 Git 历史、公司私有配置、联调产物和内部 SDK。
- 公共 Spring Boot Parent / BOM 替代私有父工程，标准 Logback / OpenTelemetry Context 替代专有日志组件；业务审计与授权模型保留。
- 提供 `BrowserIdentityProvider`、`AccountAuthentication` 和既有 `EmployeeDirectory` 扩展点；本地账号实现可独立登录、访问门户，并依据数据库管理员权限访问后台。
- 新增 Apache-2.0 许可证、公共依赖构建配置、独立初始化脚本、MySQL / Redis Compose 与 GitHub Actions 配置。未发布远端仓库或 Maven 制品。

## Standards

- 核心领域和应用层不导入公司 SDK；浏览器身份端口留在接口层，密码校验和人员目录实现位于基础设施。
- 客户端 Cookie、租户请求头和请求体不能授予身份；登录采用密码摘要、服务端随机会话、独立随机 CSRF Token 和会话轮换；注销清除服务端会话。
- 本地账号目录有1000条上限，按用户名和租户工号建索引，账号/人员ID重复在启动时拒绝。配置更新后重启，不在每次请求重建客户端或线程池。
- 初始管理员通过仅用于新库的显式 SQL 创建，不在生产业务代码中自动提权。初始化工具遇到已有配置拒绝覆盖；已验证拒绝后文件摘要不变。
- JAR 内容检查确认没有公司运行时依赖，并包含实际登录页。源码域名扫描未发现原公司的主机地址；npm 锁文件已改用公共 registry.npmjs.org。

## 功能与构建

| 命令 / 检查 | 结果与边界 |
| --- | --- |
| `mvn -s config/build/maven-settings.xml -B package` | 498项测试，474通过、24按既有条件跳过，0失败、0错误；包括SDK、领域/应用、H2 HTTP和身份边界。可选IT、外部注册中心及手动实页夹具不计通过。 |
| `pnpm run test:web` | 747项通过、3项既有条件跳过；共享35、门户129、管理端583。 |
| `pnpm install --frozen-lockfile --registry=https://registry.npmjs.org` | 冻结锁文件安装通过，不使用公司 npm 仓库。 |
| `pnpm run build:web` + Maven `package -DskipTests` | 前端类型、样式与生产构建及完整JAR打包通过；保留已有大chunk构建提示。 |
| 初始化与真实HTTP冒烟 | 独立 MySQL 8.4 / 回环 Redis；健康检查、错误密码、会话轮换、管理端七项权限、门户、三类列表、旧CSRF拒绝与注销通过；未创建业务凭据或API。 |
| `python3 scripts/maintenance/check-layout.py --syntax` | 源码布局、文档链接与脚本语法检查通过；检查不连接外部服务。 |

过程日志和截图仅保存在被 Git 忽略的 `.local/artifacts/`。测试RSA密钥由每个测试JVM临时生成，源码不保存静态测试私钥；本地启动密钥独立生成并仅保存在私有配置。对当时 Git 可纳入的1169个文件逐项核对，本次生成的数据库密码、账号密码及密码摘要未出现在公开文件中。

## 页面体验

实现者在真实JAR、独立MySQL和Redis上操作登录、工作台、API空列表、账号菜单和退出，检查1440×900、1920×1080。已修复登录表单宽度、页面基础样式和初始化Properties中文编码；截图在 `.local/artifacts/ui/`。

独立体验审阅通过。审阅者先操作真实页面再阅读说明，覆盖错误密码、登录、账号权限、API空列表、选择门户和注销；1440×900及1920×1080下未见遮挡或横向溢出。审阅发现门户租户名称乱码，修复初始化Properties编码后重新登录复验，两种尺寸均正确显示“管理员 / 本地租户”，无遗留必须修复或优先改进项。

独立截图在 `.local/artifacts/ui-independent/`，旧问题截图保留，修复后截图以 `portal-fixed-*`、`portal-identity-fixed-1440.png`、`logout-fixed-1440.png` 区分。运行版本为当前未提交本地构建。审阅使用空列表，未创建凭据、授权、API或MCP资源，未验证业务发布、多角色、移动端及其他浏览器；体验结论与Standards/Spec分别记录。

## 未验范围

- Docker daemon 当时未运行，因此真实运行使用独立本机 MySQL / Redis；Compose 文件尚未实际启动，GitHub Actions 尚未在远程运行。
- 没有部署公司身份适配模块，没有真实 SSO / 人员服务联调；SPI 只完成公开契约、默认实现与替换装配测试。
- 未进行跨网络、多实例浏览器会话、生产容量、真实注册中心、外部 MCP 网关或远程发布验收。
- 本地账号由部署者维护配置，尚无自助注册、找回密码或账号管理页面。对外部署的HTTPS、登录限速与会话粘滞要求见 [运行说明](operations.md)。


## 文档与首次接入验收（2026-10-11）

### Spec

README已改为公开项目入口，提供产品定位、真实截图、clone/启动命令、首次调用与按角色索引；新增快速开始、完整首个API、使用/调用、配置、架构、开发、排障、进阶集成和支持范围，补充SDK/SPI、贡献、安全、Issue/PR模板和Unreleased记录。公开仓库地址按维护者提供的 `https://github.com/ChenYilei2016/cyl-openplatform` 使用，未执行远端提交或发布。

### Standards

仅修改文档、截图、必要演示辅助脚本和两处Boot打包执行配置；未改变业务授权或为演示添加生产接口。示例使用正式HTTP入口，限制回环目标，逐步保存资源ID；正常`--check`不重复创建资源，恢复前必须核对状态。公开截图7张、统一1440×900，真实独立本机数据，无Token/Secret/私钥。临时凭据和测试状态仅在被忽略的.local中。

发现公共Spring Boot Parent的repackage与原模块执行重复，导致Provider的Start-Class成为JarLauncher；为Provider/server复用`id=repackage`，保留Provider普通JAR及exec classifier的分工。

### 本次实际命令与结果

- `mvn -s config/build/maven-settings.xml -B -pl examples/order-provider -am clean package -DskipTests`：通过；只记录编译打包，未作为全量回归。
- `bash scripts/run-example-provider.sh`：真实Provider健康UP，HTTP8091/Dubbo20881监听；本次调用验收走HTTP。
- `mvn -s config/build/maven-settings.xml -B package -DskipTests`：最终全工程重新打包通过；平台与Provider按文档脚本重新启动。
- `python3 scripts/demo/first-api.py`的最终入口：在另建空库、独立平台18082上从零执行，创建分类/权限/API、发布审核、凭据绑定、Token及真实订单调用全部成功；随后`--check`成功。测试以runpy将状态文件隔离到`.local/state/regression/docs-first-api-fresh.json`，没有修改生产代码或绕过接口。
- 在18080演示环境保留同一套虚构数据供手册截图，`--check`返回COMMON-001/local/101.25/PAID。
- `mvn -s config/build/maven-settings.xml -B -f examples/java-client/pom.xml package dependency:copy-dependencies`与文档中的Java入口：通过，真实网关返回相同订单。
- `python3 scripts/maintenance/check-layout.py --syntax`、Markdown围栏/相对链接、公开路径/占位说明检查通过；七张截图逐张核对并实际操作其入口。

### 边界

本次未重跑无关全量业务回归，上文474项后端/747项前端是上一阶段实际结果。本次新增证据是最终教程、Provider可执行包与Java客户端的真实HTTP链路；未扩大为注册中心、MCP外部网关、生产HA、Windows或Docker容器验收。未做页面代码改造，截图来自已有界面；上一阶段独立体验审阅结论保留。


## 首次公开提交审查（2026-10-11）

### 范围与处理

审查对象是实际Git可纳入文件及首次提交内容，不是把被忽略的本机配置打包发布。原工作目录独立保留，新仓库此前没有提交历史，未导入其他仓库历史。

- 清理残留的人员姓名、旧工号和长员工ID，将示例/测试统一为明显虚构的人员与边界测试ID。
- 页面中的内部账号与Response措辞改为平台/标准表述；公开交接改为可移植的状态说明，本机运行记录保留在.local备份中。
- 移除测试资源里的固定RSA私钥，由测试classpath的EnvironmentPostProcessor注入每JVM新生成的密钥；生产源码和运行接口不增加测试分支。
- 检查Maven/npm配置、URL主机、已知密钥值、编码密钥、文件类型、符号链接和忽略边界。私有配置、.env、.local、数据库、日志、构建产物及node_modules均不进入提交。
- 七张公开截图经过文字识别/视觉内容复核及EXIF/XMP检查，使用独立本机演示，无原环境标识或真实凭据。

### 自动扫描与误报说明

使用官方Gitleaks 8.30.1，并校验下载文件的官方SHA256。公开候选副本复扫无发现；最终暂存内容及新提交历史在推送前再次扫描。报告使用100%脱敏，只放.local。

最初扫描命中的内容是模板占位、虚构AppKey/日志ID以及测试curl认证头。模板和模拟ID已改为更明确的值；只有导入器“必须剥离认证头”的一个公开测试向量保留行级`gitleaks:allow`说明，未设置全目录或全测试白名单。另通过编码私钥规则发现并移除了Gitleaks默认规则未报告的旧静态测试RSA密钥。

已有签名协议字面值及Redis逻辑键前缀不含公司地址、身份或凭据；它们是公开兼容契约，未为了文案清理更改运行协议。常见example域名、回环地址、CIDR示例与精度边界ID属于明确测试数据。

### Standards / Spec

Standards：变更限于公开清理和测试密钥生命周期，生产授权、协议与接口不变；敏感扫描只分析/报告，不输出实际秘密。Spec：以新项目发布文件为边界，保留原项目与本机资源，确认提交内容后推送维护者指定GitHub仓库。

验证结果：后端498项执行记录中474通过、24按条件跳过，0失败/错误；姓名夹具最终调整另做定向复测。前端747项通过、3项既有条件跳过，生产构建与布局检查通过；最终姓名夹具另做定向复测。公开暂存内容Gitleaks复扫为0项，已知运行秘密与截图标识检查均未命中。扫描通过代表本次范围内未发现实际敏感内容，不构成对所有未知秘密形式的绝对保证。
