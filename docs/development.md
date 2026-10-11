# 开发指南

[文档首页](README.md) / 开发

## 准备与目录

先完成 [快速开始](quickstart.md)。模块归属见 [架构](architecture.md)，协作规范见 [AGENTS](../AGENTS.md)。当前分支的Maven版本为`0.1.0-SNAPSHOT`，Java使用25；Provider SDK有独立的Java8兼容基线。

## 常用命令

所有命令从仓库根目录执行：

```bash
pnpm install --frozen-lockfile
pnpm run build:web
mvn -s config/build/maven-settings.xml -B package
```

`mvn package`执行默认单元/HTTP测试并打包，不执行Failsafe集成测试；`bash scripts/build.sh`使用`-DskipTests`做日常构建。不要把跳过测试的构建记为测试通过。

### 前端开发

先启动后端，再分别启动Vite：

```bash
pnpm --filter cyl-openplatform-admin-web dev
# 另一个终端：
pnpm --filter cyl-openplatform-portal-web dev
```

Vite会在终端显示实际端口，两端默认代理后端18080。以终端地址为准，避免两个进程竞争默认端口。前端共享设计令牌与组件位于web-shared，功能层不要覆盖Ant Design内部类名。

### 验证

```bash
pnpm run test:web
pnpm run lint:style
mvn -s config/build/maven-settings.xml -B test
python3 scripts/maintenance/check-layout.py --syntax
```

针对修改可选用`-Dtest=类名 -Dsurefire.failIfNoSpecifiedTests=false`或模块内`pnpm exec vitest run 路径`。按影响补关键验证，不为了文档修正重跑无关业务测试。

可选真实网络/Redis/Nacos及手动浏览器夹具有各自系统属性开关，默认测试中跳过并不表示集成已通过。先读对应测试类的`EnabledIfSystemProperty`与动态端口配置，再设置独立测试资源；不要把默认local指向其他项目资源。`mvn verify`会进入Failsafe阶段，需要按测试实际依赖准备环境。

## 示例开发与本地安装SDK

```bash
mvn -s config/build/maven-settings.xml -B -pl examples/order-provider -am package
mvn -s config/build/maven-settings.xml -B -f openapi-provider-sdk/pom.xml install
```

Provider使用可执行classifier为`exec`的JAR；普通JAR保留给测试/契约引用。公共Spring Boot Parent已提供`repackage`执行，修改POM时复用`id=repackage`，避免重复重打包导致错误的Start-Class。

SDK暂未发布Maven Central，本地消费者先`install`。Java客户端样例在 [examples/java-client](../examples/java-client)，它与Provider SDK用途不同。

## 文档与截图

- README只保留产品定位、关键能力、快速入口与代表截图；详细参数只在 [配置参考](configuration.md)维护。
- 新用户路径要给出执行目录、前提、写入范围、预期结果和失败恢复方式。
- 公开截图只用独立演示数据，录制方式见 [图片来源](images/README.md)。禁止用公司资源、真实客户数据或凭据截图。
- 布局检查覆盖Java包路径、Markdown相对文件链接、Python/Bash/XML/JSON语法；它不能代替命令实跑、页面检查或语义核对。

## 提交前

1. 追踪入口与受影响调用方，不修改无关模块。
2. 完成适合改动风险的测试，记录实际命令与外部集成边界。
3. 同步手册/示例/配置；新文件有明确入口和用途。
4. 确认`.env`、`config/local/private`、`.local`、数据库和构建产物未进入Git。
5. 参考 [贡献指南](../CONTRIBUTING.md)提交PR，不在问题或日志附件中泄露凭据。
