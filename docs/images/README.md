# 公开截图来源与更新

本目录只收录README和手册引用的真实产品截图。日期：2026-10-11；版本：本仓0.1.0-SNAPSHOT本地构建。浏览器截取的 JPEG 使用 `.jpg`；维护者提供的出参映射 PNG 保留原格式，没有重绘界面或编辑截图内容。

## 数据来源

- 平台：本机独立MySQL/Redis与本地账号，非公司环境。
- 服务：仓库`examples/order-provider`真实独立进程。
- 数据：`scripts/demo/first-api.py`创建的“入门示例 / 查询示例订单”，订单`COMMON-001`，金额101.25，状态PAID，均为虚构演示数据。
- 截图账号：初始化的本地管理员。门户图显示已登录租户范围，不用于宣称匿名权限。
- API修订r1/r2反映示例配置及补充公开响应样例的实际保存/发布；读者首次运行的修订可能不同。

## 文件与复现入口

| 文件 | 入口 / 操作 |
| --- | --- |
| [login.jpg](login.jpg) | `/admin/login.html`，输入凭据前 |
| [workbench.jpg](workbench.jpg) | 登录后工作台，已有演示调用 |
| [api-list.jpg](api-list.jpg) | “API列表”，示例已发布且门户展示开启 |
| [api-workspace.jpg](api-workspace.jpg) | 示例行“编辑”，配置页顶部 |
| [api-request-mapping.jpg](api-request-mapping.jpg) | 工作区“调用目标与映射”，展示 BODY 两条规则并展开“最终请求预览” |
| [api-response-mapping.png](api-response-mapping.png) | 维护者提供的工作区截图；“从 Response 提取”，成功条件 `errCode` / `["0"]`、业务路径 `data` 与失败消息路径 `errMessage` |
| [portal-home.jpg](portal-home.jpg) | 同账号访问`/portal/` |
| [portal-document.jpg](portal-document.jpg) | 门户“查看文档”→查询示例订单 |
| [call-logs.jpg](call-logs.jpg) | 后台“调用日志”，展示真实调用结果 |

补充映射截图直接截取浏览器当前视口，保留原始 JPEG；请求预览的 `sample-tenant` 是界面自带样例占位。出参图由维护者提供，保留原始 PNG，展示基于 r2 的未保存编辑态。截图内返回预览未展开；配套样例与最终响应对照见 [截图导览](../screenshots.md#出参映射响应处理)，已通过正式响应预览接口验证，没有保存或发布修订。两图均已检查无密码、AppSecret、Token、私钥或公司环境地址。

## 更新规则

1. 在独立本机环境按入门教程准备演示，不使用真实客户数据。
2. 用浏览器实际操作后截图；等待页面完成加载，检查遮挡、截断和身份范围说明。
3. 截图前核对没有密码、AppSecret、有效Token、私钥或原环境地址。公开示例只能显示占位符或无敏感性的虚构业务数据。
4. 覆盖本目录对应图片并更新本说明，不把大量过程截图全部纳入仓库。原始问题和验收过程放`.local/artifacts/`。
5. 运行布局/链接检查并逐张查看README和手册中引用的图片；文件存在不代表截图内容已核对。
