import { PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import {
  ClassRef,
  ConfirmAction,
  EmptyState,
  EntityDrawer,
  FieldLabel,
  FormSection,
  IdText,
  Metric,
  PageHeader,
  PersonTag,
  ReadonlyField,
  StatusBadge,
  StickyActionBar,
  TenantTag,
  defineStatusMap,
} from "@cyl/open-platform-web-shared/ui/components";
import { PlatformTheme } from "@cyl/open-platform-web-shared/ui/PlatformTheme";
import { cssVariables, typography, type ColorMode, type ThemeVariant } from "@cyl/open-platform-web-shared/ui/tokens";
import { Button, Input, InputNumber, Radio, Segmented, Select, Space, Switch, Table, Tabs, Tag } from "antd";
import { useState, type ReactNode } from "react";
import "./uikit.css";

/** 106/107 视觉基准：只展示静态示例数据，不调用任何业务接口。 */
export const uiKitAvailable = (hostname = window.location.hostname, dev = import.meta.env.DEV) =>
  dev || ["localhost", "127.0.0.1", "[::1]", "::1"].includes(hostname);

const apiStatus = defineStatusMap({
  PUBLISHED: { tone: "success", label: "已发布" },
  CHANGED: { tone: "warning", label: "有未发布修改" },
  UNPUBLISHED: { tone: "neutral", label: "未发布" },
  PENDING_REVIEW: { tone: "info", label: "待审核" },
  REJECTED: { tone: "error", label: "已驳回" },
});

const colorGroups: [string, string[]][] = [
  ["品牌", ["--op-color-primary", "--op-color-primary-hover", "--op-color-primary-soft", "--op-color-accent"]],
  ["文字", ["--op-color-text", "--op-color-text-secondary", "--op-color-text-tertiary"]],
  ["表面与边框", ["--op-color-bg-layout", "--op-color-bg-surface", "--op-color-bg-subtle", "--op-color-bg-hover", "--op-color-bg-selected", "--op-color-border", "--op-color-divider"]],
  ["状态", ["--op-color-success", "--op-color-warning", "--op-color-error", "--op-color-neutral", "--op-color-success-soft", "--op-color-warning-soft", "--op-color-error-soft"]],
];

const sampleRows = [
  { key: "1", name: "订单详情查询", id: "order.lookup", protocol: "HTTP", version: "v1", status: "PUBLISHED", detail: "r3", owner: ["示例人员", "E1001"], updated: "09-30 16:43" },
  { key: "2", name: "订单详情查询 · Dubbo", id: "order_dubbo.lookup", protocol: "DUBBO", version: "v1", status: "CHANGED", detail: "生效 r5 · 草稿 r8", owner: ["示例维护人", "E1002"], updated: "09-30 11:02" },
  { key: "3", name: "方法不存在诊断", id: "acceptance68_aag.validate_ticket", protocol: "DUBBO", version: "v1", status: "UNPUBLISHED", detail: "草稿 r1", owner: [null, null], updated: "09-26 10:15" },
  { key: "4", name: "本地自调用平台信息（草稿保存验收）", id: "local_selfcheck.draft_save_spec48", protocol: "HTTP", version: "1.0", status: "PENDING_REVIEW", detail: "提交 r4", owner: ["示例人员", "E1001"], updated: "09-21 00:08" },
  { key: "5", name: "虚构订单查询", id: "nacos_2cbde6fdaf_http.query", protocol: "HTTP", version: "v1", status: "REJECTED", detail: "提交 r2", owner: ["示例研发", null], updated: "09-10 20:18" },
];

function Section({ id, title, description, children }: { id: string; title: string; description?: string; children: ReactNode }) {
  return (
    <section id={id} className="uikit-section" aria-labelledby={`${id}-title`}>
      <header>
        <h2 id={`${id}-title`}>{title}</h2>
        {description && <p>{description}</p>}
      </header>
      <div className="uikit-panel">{children}</div>
    </section>
  );
}

function Swatch({ name, mode }: { name: string; mode: ColorMode }) {
  return (
    <div className="uikit-swatch">
      <span className="uikit-swatch__chip" style={{ background: `var(${name})` }} />
      <span className="uikit-swatch__name">{name.replace("--op-color-", "")}</span>
      <span className="uikit-swatch__value">{cssVariables(mode)[name]}</span>
    </div>
  );
}

export default function UiKit() {
  const [variant, setVariant] = useState<ThemeVariant>("admin");
  const [mode, setMode] = useState<ColorMode>("light");
  const [drawer, setDrawer] = useState(false);
  const [drawerTab, setDrawerTab] = useState("overview");
  const [protocol, setProtocol] = useState("HTTP");
  if (!uiKitAvailable())
    return <PlatformTheme><div className="uikit-shell"><EmptyState kind="forbidden" title="组件展示页仅在本机开发环境可用" /></div></PlatformTheme>;
  return (
    <PlatformTheme variant={variant} mode={mode}>
      <div className="uikit-shell" data-variant={variant}>
        <nav className="uikit-toc" aria-label="组件目录">
          <strong>组件展示</strong>
          {[
            ["colors", "色彩"], ["type", "字号"], ["buttons", "按钮与控件"], ["status", "状态"], ["ids", "编号与人员"],
            ["header", "页头"], ["table", "表格密度"], ["form", "表单分区"], ["drawer", "抽屉"], ["confirm", "确认"], ["empty", "空态"], ["actionbar", "底部操作栏"],
          ].map(([id, label]) => <a key={id} href={`#${id}`}>{label}</a>)}
        </nav>
        <main className="uikit-main">
          <div className="uikit-toolbar">
            <Segmented aria-label="主题" value={variant} onChange={(value) => { setVariant(value as ThemeVariant); setMode(value === "portal" ? "dark" : "light"); }} options={[{ value: "admin", label: "管理端" }, { value: "portal", label: "门户" }]} />
            <Segmented aria-label="明暗" value={mode} onChange={(value) => setMode(value as ColorMode)} options={[{ value: "light", label: "浅色" }, { value: "dark", label: "深色" }]} />
            <span className="op-muted">设计令牌唯一来源：web-shared/ui/tokens.ts（106 第 3 节）</span>
          </div>

          <Section id="colors" title="色彩" description="页面样式只能引用 var(--op-*)；状态色全站同义。">
            {colorGroups.map(([group, names]) => (
              <div key={group} className="uikit-swatch-group">
                <h3>{group}</h3>
                <div className="uikit-swatches">{names.map((name) => <Swatch key={name} name={name} mode={mode} />)}</div>
              </div>
            ))}
            <div className="uikit-gradient"><span>门户强调渐变 · 只用于主按钮、关键词、关键数字</span></div>
            <div className="uikit-metrics">
              <Metric label="已开放 API" value="67" emphasis={variant === "portal"} />
              <Metric label="分类" value="12" emphasis={variant === "portal"} />
              <Metric label="近 1 小时成功率" value="99.2%" />
            </div>
          </Section>

          <Section id="type" title="字号阶梯" description="只此六档；等宽字体用于技术标识。">
            {(Object.keys(typography.size) as (keyof typeof typography.size)[]).map((key) => (
              <div key={key} className="uikit-type-row">
                <span className="uikit-type-meta">{key} · {typography.size[key]}/{typography.lineHeight[key]}</span>
                <span style={{ fontSize: `var(--op-font-size-${key})`, lineHeight: `var(--op-line-height-${key})` }}>订单详情查询 Order lookup 1234</span>
              </div>
            ))}
            <div className="uikit-type-row"><span className="uikit-type-meta">code · 13</span><span className="op-code">POST /api/oauth/order/v1/lookup</span></div>
          </Section>

          <Section id="buttons" title="按钮与控件" description="每个区域最多一个主按钮；控件默认高 32。">
            <div className="uikit-row">
              <Button type="primary" icon={<PlusOutlined />}>新建 API</Button>
              <Button>次要操作</Button>
              <Button type="text">文字按钮</Button>
              <Button type="link">链接按钮</Button>
              <Button danger>停用</Button>
              <Button icon={<ReloadOutlined />} aria-label="刷新" />
              <Button type="primary" disabled>不可用</Button>
            </div>
            <div className="uikit-row">
              <Input placeholder="搜索名称、service.method 或内部类" style={{ width: 320 }} allowClear />
              <Select placeholder="协议" style={{ width: 140 }} options={[{ value: "HTTP", label: "HTTP" }, { value: "DUBBO", label: "Dubbo" }]} allowClear />
              <Select mode="multiple" placeholder="发布状态" style={{ width: 220 }} defaultValue={["PUBLISHED"]} options={[{ value: "PUBLISHED", label: "已发布" }, { value: "CHANGED", label: "有未发布修改" }, { value: "UNPUBLISHED", label: "未发布" }]} maxTagCount="responsive" />
              <InputNumber defaultValue={3000} suffix="ms" style={{ width: 140 }} />
              <Switch defaultChecked aria-label="启用" />
              <Radio.Group defaultValue="url" optionType="button" options={[{ value: "url", label: "固定 URL" }, { value: "service", label: "服务名发现" }]} />
            </div>
            <div className="uikit-row">
              <Tag>回归测试</Tag><Tag color="blue">POST</Tag><Tag bordered={false}>订单</Tag>
            </div>
          </Section>

          <Section id="status" title="状态" description="圆点 + 文字；强调底色只用于需要注意的异常。">
            <div className="uikit-row">
              <StatusBadge tone="success">启用</StatusBadge>
              <StatusBadge tone="warning">有未发布修改</StatusBadge>
              <StatusBadge tone="error" detail="HTTP 403">调用失败</StatusBadge>
              <StatusBadge tone="info">待审核</StatusBadge>
              <StatusBadge tone="processing" pulse>同步中</StatusBadge>
              <StatusBadge tone="info">观察中</StatusBadge>
              <StatusBadge tone="neutral">停用</StatusBadge>
            </div>
            <div className="uikit-row">{Object.keys(apiStatus.map).map((key) => <apiStatus.Badge key={key} value={key} />)}<apiStatus.Badge value="NEW_ENUM" /></div>
          </Section>

          <Section id="ids" title="编号与人员" description="悬停看全文、点击复制；人名替代 ID。">
            <dl className="uikit-dl">
              <dt>AK</dt><dd><IdText value="c24b24015416432f935722dc0c16eaa4" label="AK" /></dd>
              <dt>requestId</dt><dd><IdText value="c1741352-f02e-4170-a33e-19fb73cb43c9" label="requestId" maxChars={36} /></dd>
              <dt>内部类</dt><dd><ClassRef className="io.github.chenyilei2016.example.order.rpc.OrderQueryFacade" method="lookup" /></dd>
              <dt>负责人</dt><dd><PersonTag name="示例人员" employeeNo="E1001" tenantName="示例租户" id="9007199254740995" /></dd>
              <dt>未登记</dt><dd><PersonTag name={null} id="chenyilei" /></dd>
              <dt>租户</dt><dd><TenantTag name="示例租户" id="9007199254740993" /> · <TenantTag id="9007199254740993" /></dd>
            </dl>
          </Section>

          <Section id="header" title="页头" description="标题 + 计数；右侧最多一个主按钮，低频动作进“更多”。">
            <PageHeader title="API 列表" count={67} secondaryActions={<Button>导入</Button>} primaryAction={<Button type="primary" icon={<PlusOutlined />}>新建 API</Button>} moreActions={[{ key: "categories", label: "分类管理" }, { key: "export", label: "导出" }]} />
            <PageHeader breadcrumb={<a href="#header">API 列表</a>} title="订单详情查询" meta={<><apiStatus.Badge value="CHANGED" detail="草稿 r5 · 生效 r3" /> <span className="op-code">order.lookup · v1</span></>} secondaryActions={<Button>调试</Button>} primaryAction={<Button type="primary">提交发布</Button>} />
          </Section>

          <Section id="table" title="表格密度" description="单行约 36px，两行主列约 52px；1440×900 首屏 ≥ 12 行（109 实现 DataTable）。">
            <Table
              size="middle"
              pagination={false}
              dataSource={sampleRows}
              rowSelection={{}}
              columns={[
                { title: "接口", dataIndex: "name", render: (_, row) => <div className="uikit-cell-main"><a href="#table">{row.name}</a><IdText value={row.id} copyable={false} maxChars={40} /></div> },
                { title: "协议 · 版本", render: (_, row) => <span className="op-code">{row.protocol} · {row.version}</span>, width: 130 },
                { title: "状态", render: (_, row) => <apiStatus.Badge value={row.status} detail={row.detail} />, width: 240 },
                { title: "负责人", render: (_, row) => <PersonTag name={row.owner[0]} employeeNo={row.owner[1]} />, width: 170 },
                { title: "更新时间", dataIndex: "updated", width: 120, sorter: true },
                { title: "操作", width: 130, render: () => <span className="uikit-row uikit-row--tight"><Button type="link" size="small">编辑</Button><Button type="link" size="small">调试</Button></span> },
              ]}
            />
          </Section>

          <Section id="form" title="表单分区" description="左侧分区标题，右侧字段网格；只读项是文字不是禁用框；说明悬停可见。">
            <FormSection title="基本信息" description="对外展示的名称、分类与负责人。" columns={3}>
              <label><FieldLabel label="接口名称" required /><Input defaultValue="订单详情查询" /></label>
              <label><FieldLabel label="展示分类" required help="客户在门户中看到的分组；可在分类管理中维护。" /><Select defaultValue="order" options={[{ value: "order", label: "联调示例 · 订单" }]} style={{ width: "100%" }} /></label>
              <label><FieldLabel label="负责人" required /><Select defaultValue="me" options={[{ value: "me", label: "示例人员 · E1001" }]} style={{ width: "100%" }} /></label>
              <ReadonlyField label="服务标识" value="order" code reason="已发布后不可修改，需新建外部版本" />
              <ReadonlyField label="操作标识" value="lookup" code reason="已发布后不可修改，需新建外部版本" />
              <ReadonlyField label="外部版本" value="v1" code reason="已发布后不可修改" />
            </FormSection>
            <FormSection title="调用目标" description="平台如何调用内部服务。" columns={3}>
              <div className="op-span-all"><FieldLabel label="协议" /><Segmented value={protocol} onChange={(value) => setProtocol(String(value))} options={["HTTP", "DUBBO"]} /></div>
              <label className="op-span-all"><FieldLabel label="请求地址" required help={<>可写路径变量，如 <span className="op-code">{"{orderNo}"}</span>，会自动生成 PATH 参数。</>} /><Space.Compact block><Select defaultValue="POST" style={{ width: 96 }} options={["GET", "POST", "PUT", "DELETE"].map((value) => ({ value, label: value }))} /><Input defaultValue="http://order-svc/internal/orders/{orderNo}" className="op-code" /></Space.Compact></label>
              <label><FieldLabel label="最长等待" /><InputNumber defaultValue={3000} suffix="ms" style={{ width: "100%" }} /></label>
              <div className="uikit-span-2"><ReadonlyField label="调用地址" code value={<IdText value="POST /api/oauth/order/v1/lookup" label="调用地址" maxChars={60} />} reason="由服务标识、外部版本和操作标识自动生成" help="客户调用平台时使用的地址。" /></div>
            </FormSection>
          </Section>

          <Section id="drawer" title="抽屉" description="全站唯一详情形态；Esc 关闭，关闭后焦点回到触发按钮。">
            <Button onClick={() => setDrawer(true)}>打开凭据详情</Button>
            <EntityDrawer
              open={drawer}
              width="lg"
              title="联调 · OpenAPI 订单凭据"
              status={<StatusBadge tone="success">启用</StatusBadge>}
              subtitle={<IdText value="c24b24015416432f935722dc0c16eaa4" label="AK" />}
              actions={<Button>调整权限</Button>}
              onClose={() => setDrawer(false)}
              activeTab={drawerTab}
              onTabChange={setDrawerTab}
              tabs={[
                { key: "overview", label: "概览", children: <dl className="uikit-dl"><dt>租户</dt><dd><TenantTag name="示例租户" id="9007199254740993" /></dd><dt>权限组</dt><dd>3 个</dd><dt>最近调用</dt><dd>2026-09-30 23:25</dd></dl> },
                { key: "grants", label: "授权租户与人员", children: <EmptyState title="暂无人员授权" action={<Button type="primary">添加授权</Button>} /> },
                { key: "tokens", label: "Token", children: <EmptyState kind="noResult" action={<Button>清除筛选</Button>} /> },
                { key: "keys", label: "签名密钥", children: "…" },
                { key: "audit", label: "操作记录", children: "…" },
              ]}
            />
          </Section>

          <Section id="confirm" title="确认" description="轻量操作用气泡确认；影响较大的操作要求填写原因。">
            <div className="uikit-row">
              <ConfirmAction title="撤销这个 Token？" description="撤销后接入方需重新获取 Token。" danger onConfirm={() => undefined}><Button danger>撤销 Token</Button></ConfirmAction>
              <ConfirmAction title="停用当前环境 API" description="停用后所有调用将被拒绝，直到重新启用。" danger okText="停用" reason={{ label: "停用原因", placeholder: "例如：提供方维护" }} onConfirm={() => undefined}><Button danger>停用 API…</Button></ConfirmAction>
            </div>
          </Section>

          <Section id="empty" title="空态" description="无数据、无结果、无权限、失败四种。">
            <div className="uikit-grid-4">
              <EmptyState title="还没有 API" description="从 cURL、OpenAPI 或 Dubbo 签名快速创建。" action={<Button type="primary" icon={<PlusOutlined />}>新建 API</Button>} />
              <EmptyState kind="noResult" description="试试减少筛选条件。" action={<Button>清除筛选</Button>} />
              <EmptyState kind="forbidden" description="需要“API 管理”权限，请联系总管理员。" action={<Button>查看管理员</Button>} />
              <EmptyState kind="error" description="网络超时（requestId 7e1d30f1）" action={<Button icon={<ReloadOutlined />}>重试</Button>} />
            </div>
          </Section>

          <Section id="actionbar" title="底部操作栏" description="编辑页底部固定；左侧保存状态，右侧主操作。">
            <Tabs items={[{ key: "a", label: "配置", children: <div className="uikit-actionbar-demo"><p className="op-muted">…配置内容…</p><StickyActionBar status={<><StatusBadge tone="warning">3 处改动未保存为修订</StatusBadge> <span className="op-muted">已暂存 12:03</span></>}><Button>校验</Button><Button type="primary">保存为修订 r6</Button></StickyActionBar></div> }]} />
          </Section>
        </main>
      </div>
    </PlatformTheme>
  );
}
