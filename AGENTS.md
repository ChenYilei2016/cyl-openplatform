# 协作约定

- 使用中文交流。根包 `io.github.chenyilei2016`，按 domain/application/infrastructure/interface/server 分层；先追踪真实入口与受影响调用方，复用现有能力。
- 公司使用的源项目独立维护；本仓不读取或复制其私有配置、数据、密钥和内部 SDK。私有身份接入见 [SPI 说明](docs/identity-spi.md)，公司依赖仅存在于私有适配模块。
- 对外对象 ID 使用 String，Java 使用显式类型，复用 Lombok。ORM 使用 MyBatis-Plus，SQL 属于基础设施，业务层不新增原生 JDBC 存储。
- 客户端不能声明可信租户/人员身份，展示缓存不是授权源。接口保留参数校验、CSRF、权限与错误处理。密钥、密码和完整 Token 不进入日志或公开资料。
- 集合和远程调用采用有界处理，客户端与线程资源受控复用。不为测试添加生产接口或分支，不测试 private 实现，不进行无关重构。
- 保留用户已有改动。批量删除有意义文件前列明范围并获得授权；不清空本机状态或数据卷。
- 公共配置在 server/resources，私有参数在 config/local/private，运行产物在 .local。构建/测试方式见 [README](README.md)，修改配置、接口和流程同步更新对应文档。
- 面向用户的文档从 [文档导航](docs/README.md)进入，README保留快速入口；配置主来源为 [配置参考](docs/configuration.md)，截图规则为 [图片说明](docs/images/README.md)。修改入门路径须实跑受影响命令，不以链接检查代替接入验收。
- 恢复任务先读 [继续任务](docs/继续任务.md) 并核对代码与运行状态。完成后分别记录 Standards、Spec 和实际验证边界，不把模拟测试当作外部系统联调。
- 页面改动需实际操作、检查1440×900和1920×1080布局；身份入口等主要交付需独立体验审阅，修复后复核。复用共享 UI 令牌和组件。
- 文件或脚本变更后运行 `python3 scripts/maintenance/check-layout.py --syntax`；检查通过只说明布局和语法，不证明功能可用。
