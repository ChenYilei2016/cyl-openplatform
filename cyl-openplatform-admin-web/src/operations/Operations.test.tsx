import { PlatformTheme } from "@cyl/open-platform-web-shared/ui/PlatformTheme";
import { AdminNavigationProvider, useAdminNavigation } from "../navigation/AdminNavigation";
import { cleanup, fireEvent, render as renderView, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { createAdminApi } from "../access/api";
import OperationsPanel from "./OperationsPanel";
import OperationsAlerts from "./OperationsAlerts";
import { analyticsDefaults, analyticsWindow, chartGroups, statisticsQuery } from "./model";
const policy = {
  version: 0,
  windowMinutes: 5,
  minRequests: 100,
  failureEnabled: false,
  failureRateThreshold: 5,
  latencyEnabled: false,
  averageLatencyThresholdMillis: 1000,
};
const empty = {
  requests: 0,
  successes: 0,
  clientErrors: 0,
  serverErrors: 0,
  authRejected: 0,
  rateLimited: 0,
  slowCalls: 0,
  unattributed: 0,
  governanceRejected: 0,
  observedRequests: 0,
  ruleHits: 0,
  ipDenied: 0,
  tokenBucketRejected: 0,
  dailyQuotaRejected: 0,
  durationSum: 0,
  maxDuration: 0,
  successRate: null,
  averageLatencyMillis: null,
};
const busy = { ...empty, requests: 10, successes: 8, governanceRejected: 1, tokenBucketRejected: 1, successRate: "80.00", averageLatencyMillis: "12.50", maxDuration: 40 };
const statistics = {
  from: "2026-09-10T01:00:00Z",
  to: "2026-09-10T02:00:00Z",
  mode: "PRODUCTION" as const,
  bucket: "FIVE_MINUTES",
  retentionDays: 90,
  dimension: "TENANT" as const,
  sort: "REQUESTS" as const,
  top: 10,
  identityCoverageStart: null,
  rankings: [],
  summary: empty,
  points: [{ bucketStart: "2026-09-10T01:00:00Z", totals: empty }],
};
const state = {
  metric: "FAILURE_RATE" as const,
  status: "NO_DATA" as const,
  value: null,
  sampleCount: 0,
  windowStart: "2026-09-10T01:00:00Z",
  windowEnd: "2026-09-10T01:05:00Z",
  policyVersion: 0,
  evaluatedAt: "2026-09-10T01:06:00Z",
};
function setup(response?: (url: string, options?: RequestInit) => Response | undefined) {
  const calls = vi.fn(async (url: string, options?: RequestInit) => {
    const replacement = response?.(url, options);
    if (replacement) return replacement;
    let data: unknown;
    if (url.includes("/statistics?")) {
      const params = new URL(url, "http://test").searchParams;
      data = { ...statistics, mode: params.get("mode"), dimension: params.get("dimension") };
    } else if (url.includes("/targets?"))
      data = { items: [{ id: "API_" + "a".repeat(32), name: "订单查询", description: "orders/v1/query" }], total: 1, page: 1, pageSize: 20 };
    else if (url.includes("/events?")) data = { items: [], total: 0, page: 1, pageSize: 20 };
    else if (url.endsWith("/policy")) data = policy;
    else data = { policy, states: [state], stale: true };
    return Response.json({ code: 200, data });
  });
  vi.stubGlobal("fetch", calls);
  return calls;
}
const api = () => createAdminApi("proof", vi.fn());
const render = (ui: React.ReactNode, hash?: string) => {
  if (hash) window.history.replaceState({}, "", "/" + hash);
  return renderView(
    <PlatformTheme>
      <AdminNavigationProvider>{ui}</AdminNavigationProvider>
    </PlatformTheme>,
  );
};
const params = () => new URLSearchParams(window.location.hash.split("?")[1]);
const statisticsCalls = (calls: ReturnType<typeof setup>) => calls.mock.calls.map(([url]) => String(url)).filter((url) => url.includes("/statistics?"));
afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const choose = (label: string, text: string) => {
  fireEvent.mouseDown(screen.getByRole("combobox", { name: label }));
  fireEvent.click(screen.getAllByText(text, { selector: ".ant-select-item-option-content" }).at(-1)!);
};

test("默认视图地址不写条件；即时条件只写非默认值，旧 104 长地址仍能打开", async () => {
  const calls = setup();
  render(<OperationsPanel api={api()} permissions={["VIEW_AUDIT"]} />, "#/analytics");
  await screen.findByRole("region", { name: "统计结果" });
  expect(window.location.hash).toBe("#/analytics");
  expect(statisticsCalls(calls).at(-1)).toContain("mode=PRODUCTION");
  choose("调用方式", "草稿调试");
  await waitFor(() => expect(window.location.hash).toBe("#/analytics?filter.analytics.mode=DRAFT_DEBUG"));
  await waitFor(() => expect(statisticsCalls(calls).at(-1)).toContain("mode=DRAFT_DEBUG"));
  choose("调用方式", "正式调用");
  await waitFor(() => expect(window.location.hash).toBe("#/analytics"));
  cleanup();
  render(<OperationsPanel api={api()} permissions={["VIEW_AUDIT"]} />, "#/operations?filter.operations.from=&filter.operations.apiId=&filter.operations.page=1&filter.operations.mode=PRODUCTION");
  expect(await screen.findByRole("region", { name: "统计结果" })).toBeTruthy();
  // 空值、默认值与页码不带入新地址。
  await waitFor(() => expect(window.location.hash).toBe("#/analytics"));
  cleanup();
  // 旧链接中的有效条件迁移到 analytics 命名空间并生效。
  render(<OperationsPanel api={api()} permissions={["VIEW_AUDIT"]} />, "#/operations?filter.operations.ruleId=rule-1&filter.operations.ruleVersion=2&filter.operations.mode=DRAFT_DEBUG");
  await waitFor(() => expect(window.location.hash).toContain("filter.analytics.ruleId=rule-1"));
  expect(window.location.hash).toContain("filter.analytics.mode=DRAFT_DEBUG");
  expect(window.location.hash).not.toContain("filter.operations.");
  await waitFor(() => expect(statisticsCalls(calls).at(-1)).toContain("ruleId=rule-1"));
});

test("更多筛选的对象条件只在应用后发请求，地址只写应用的条件", async () => {
  const calls = setup();
  render(<OperationsPanel api={api()} permissions={["VIEW_AUDIT"]} />, "#/analytics");
  await screen.findByRole("region", { name: "统计结果" });
  fireEvent.click(screen.getByRole("button", { name: /更多筛选/ }));
  const drawer = await screen.findByRole("dialog");
  fireEvent.click(within(drawer).getAllByRole("button", { name: "全部 API" })[0]);
  fireEvent.click(await screen.findByRole("button", { name: "选择" }));
  const before = statisticsCalls(calls).length;
  await screen.findByText("条件已修改，应用后更新统计");
  expect(statisticsCalls(calls)).toHaveLength(before);
  expect(window.location.hash).toBe("#/analytics");
  fireEvent.click(within(drawer).getByRole("button", { name: "应用" }));
  await waitFor(() => expect(statisticsCalls(calls).at(-1)).toContain("apiId=API_"));
  expect(window.location.hash).toBe(`#/analytics?filter.analytics.apiId=API_${"a".repeat(32)}`);
  expect(screen.getByRole("button", { name: `清除 API：API_${"a".repeat(32)}` })).toBeTruthy();
});

test("点击趋势分段跳转日志带该时段条件；点击失败部分只看失败", async () => {
  const points = [0, 1].map((i) => ({ bucketStart: new Date(Date.parse(statistics.from) + i * 300000).toISOString(), totals: busy }));
  setup((url) => (url.includes("/statistics?") ? Response.json({ code: 200, data: { ...statistics, summary: busy, points } }) : undefined));
  render(<OperationsPanel api={api()} permissions={["VIEW_AUDIT"]} />, `#/analytics?filter.analytics.apiId=API_${"a".repeat(32)}`);
  const bars = await screen.findByRole("group", { name: "请求量趋势，点击分段查看调用日志" });
  const second = within(bars).getAllByRole("button")[1];
  fireEvent.mouseEnter(second);
  expect(screen.getByText(/点击红色部分只看失败/)).toBeTruthy();
  fireEvent.click(second);
  expect(window.location.hash.startsWith("#/logs?")).toBe(true);
  let p = params();
  expect(p.get("filter.logs.range")).toBe("custom");
  expect(p.get("filter.logs.from")).toBe("2026-09-10T01:05:00.000Z");
  expect(p.get("filter.logs.to")).toBe("2026-09-10T01:10:00.000Z");
  expect(p.get("filter.logs.mode")).toBe("PRODUCTION");
  expect(p.get("filter.logs.apiId")).toBe("API_" + "a".repeat(32));
  expect(p.get("filter.logs.outcome")).toBeNull();
  expect([...p.keys()].every((key) => key.startsWith("filter.logs."))).toBe(true);
  cleanup();
  render(<OperationsPanel api={api()} permissions={["VIEW_AUDIT"]} />, "#/analytics");
  const again = await screen.findByRole("group", { name: "请求量趋势，点击分段查看调用日志" });
  fireEvent.click(again.querySelector('[data-part="failure"]')!);
  p = params();
  expect(p.get("filter.logs.from")).toBe("2026-09-10T01:00:00.000Z");
  expect(p.get("filter.logs.outcome")).toBe("FAILURE");
});

test("四个指标卡：无样本不展示 0ms 健康假象；成功率与拒绝原因下钻到日志", async () => {
  setup();
  render(<OperationsPanel api={api()} permissions={["VIEW_AUDIT"]} />, "#/analytics");
  await screen.findByRole("region", { name: "统计结果" });
  expect(screen.getAllByText("无样本").length).toBeGreaterThan(1);
  expect(screen.queryByText("0 ms")).toBeNull();
  expect(screen.getByText("此范围没有已记录调用")).toBeTruthy();
  cleanup();
  setup((url) => (url.includes("/statistics?") ? Response.json({ code: 200, data: { ...statistics, summary: busy } }) : undefined));
  render(<OperationsPanel api={api()} permissions={["VIEW_AUDIT"]} />, "#/analytics?filter.analytics.mode=DRAFT_DEBUG");
  fireEvent.click(await screen.findByRole("button", { name: /成功率 80.00，查看失败调用日志/ }));
  let p = params();
  expect(p.get("filter.logs.from")).toBe(statistics.from);
  expect(p.get("filter.logs.to")).toBe(statistics.to);
  expect(p.get("filter.logs.outcome")).toBe("FAILURE");
  expect(p.get("filter.logs.mode")).toBe("DRAFT_DEBUG");
  window.history.back();
  fireEvent.click(await screen.findByRole("button", { name: /令牌桶拒绝 1/ }));
  p = params();
  expect(p.get("filter.logs.denialReason")).toBe("TOKEN_BUCKET_LIMIT");
});

test("排行按维度即时切换并显示名称，行下钻带人员工号与租户", async () => {
  const calls = setup((url) =>
    url.includes("dimension=PERSON")
      ? Response.json({
          code: 200,
          data: {
            ...statistics,
            summary: busy,
            dimension: "PERSON",
            rankings: [{ tenantId: "tenant-a", employeeId: "employee-a", identityKind: "EMPLOYEE", apiId: "", name: "张三", employeeNo: "E1001", tenantName: "租户A", totals: busy }],
          },
        })
      : undefined,
  );
  render(<OperationsPanel api={api()} permissions={["VIEW_AUDIT"]} />, "#/analytics");
  await screen.findByRole("region", { name: "统计结果" });
  fireEvent.click(screen.getByText("人员", { selector: ".ant-segmented-item-label" }));
  await screen.findByText("张三");
  expect(window.location.hash).toBe("#/analytics?filter.analytics.dimension=PERSON");
  expect(statisticsCalls(calls).at(-1)).toContain("dimension=PERSON");
  fireEvent.click(screen.getByRole("button", { name: "查看日志" }));
  const p = params();
  expect(p.get("filter.logs.tenantId")).toBe("tenant-a");
  expect(p.get("filter.logs.employeeNo")).toBe("E1001");
  expect(p.get("filter.logs.employeeId")).toBeNull();
  expect(p.get("filter.logs.identityKind")).toBe("EMPLOYEE");
});

test("大整数和服务端小数展示保精度，合并图覆盖完整区间且不超60段", async () => {
  setup((url) =>
    url.includes("/statistics?")
      ? new Response(
          JSON.stringify({ code: 200, data: { ...statistics, summary: { ...empty, requests: "RAW", successRate: "99.99", averageLatencyMillis: "123.45" } } }).replace('"RAW"', "9007199254740993"),
        )
      : undefined,
  );
  render(<OperationsPanel api={api()} permissions={["VIEW_AUDIT"]} />, "#/analytics");
  expect((await screen.findAllByText("9007199254740993")).length).toBeGreaterThan(0);
  expect(screen.getByText("99.99%")).toBeTruthy();
  expect(screen.getByText("123.45 ms")).toBeTruthy();
  const points = Array.from({ length: 121 }, (_, i) => ({ bucketStart: new Date(Date.parse(statistics.from) + i * 60000).toISOString(), totals: { ...empty, requests: 1 } }));
  const data = { ...statistics, bucket: "MINUTE", to: new Date(Date.parse(statistics.from) + 121 * 60000).toISOString(), points };
  const groups = chartGroups(data);
  expect(groups.length).toBeLessThanOrEqual(60);
  expect(groups[0].from).toBe(new Date(statistics.from).toISOString());
  expect(groups.at(-1)?.to).toBe(data.to);
  expect(groups.reduce((n, g) => n + BigInt(g.requests), 0n)).toBe(121n);
  expect(groups.reduce((n, g) => n + BigInt(g.failures), 0n)).toBe(121n);
});

test("快捷范围按整分钟换算，超过桶上限或倒置时间给出修正建议且不请求", async () => {
  const now = Date.parse("2026-09-10T02:00:30Z");
  expect(analyticsWindow({ ...analyticsDefaults, range: "24h" }, now)).toMatchObject({ from: "2026-09-09T02:00:00.000Z", to: "2026-09-10T02:00:00.000Z", bucket: "FIVE_MINUTES" });
  expect(analyticsWindow({ ...analyticsDefaults, range: "7d" }, now).bucket).toBe("HOUR");
  expect(() => statisticsQuery(analyticsWindow({ ...analyticsDefaults, range: "custom", from: "2026-09-01T01:00:00Z", to: "2026-09-10T02:00:00Z", bucket: "MINUTE" }))).toThrow(/1440/);
  const calls = setup();
  render(<OperationsPanel api={api()} permissions={["VIEW_AUDIT"]} />, "#/analytics?filter.analytics.range=custom&filter.analytics.from=2030-01-01T00%3A00%3A00Z&filter.analytics.to=2026-09-10T02%3A00%3A00Z");
  expect(await screen.findByText("结束时间须晚于开始时间，请调整时间范围。")).toBeTruthy();
  expect(statisticsCalls(calls)).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "改为近 1 小时" }));
  await screen.findByRole("region", { name: "统计结果" });
  expect(window.location.hash).toBe("#/analytics");
});

test("分桶明细页码写入地址，逐桶下钻到日志", async () => {
  setup((url) =>
    url.includes("/statistics?")
      ? Response.json({ code: 200, data: { ...statistics, points: Array.from({ length: 25 }, (_, i) => ({ bucketStart: new Date(Date.parse(statistics.from) + i * 60000).toISOString(), totals: empty })) } })
      : undefined,
  );
  render(<OperationsPanel api={api()} permissions={["VIEW_AUDIT"]} />, "#/analytics?filter.analytics.page=2");
  await screen.findByRole("region", { name: "统计结果" });
  expect(document.querySelector(".ant-pagination-item-active")?.textContent).toBe("2");
  expect(screen.getAllByRole("button", { name: "查看该桶日志" })).toHaveLength(5);
  fireEvent.click(screen.getAllByRole("button", { name: "查看该桶日志" })[0]);
  expect(params().get("filter.logs.from")).toBe("2026-09-10T01:20:00.000Z");
});

test("告警列表：级别、对象、首次/最近触发；一键查看日志用当时窗口，失败率只看失败", async () => {
  setup((url) => {
    if (url.endsWith("/state"))
      return Response.json({ code: 200, data: { policy: { ...policy, failureEnabled: true }, stale: false, states: [{ ...state, status: "NORMAL" }, { ...state, metric: "AVERAGE_LATENCY" }] } });
    if (url.includes("/events?"))
      return Response.json({
        code: 200,
        data: {
          items: [
            { ...state, id: "e2", previousStatus: "FIRING", status: "NORMAL", occurredAt: "2026-09-10T01:30:00Z" },
            { ...state, id: "e1", previousStatus: "NORMAL", status: "FIRING", occurredAt: "2026-09-10T01:10:00Z" },
          ],
          total: 2,
          page: 1,
          pageSize: 20,
        },
      });
  });
  render(<OperationsAlerts api={api()} canManage={false} />);
  const table = await screen.findByRole("table", { name: "告警列表" });
  expect(within(table).getByText("严重")).toBeTruthy();
  expect(within(table).getByText("平台正式调用 · 失败率")).toBeTruthy();
  expect(within(table).getByText("失败率 ≥ 5%")).toBeTruthy();
  expect(await within(table).findByText(new Date("2026-09-10T01:10:00Z").toLocaleString("zh-CN", { hour12: false }))).toBeTruthy();
  expect(within(table).getByText("已离开告警")).toBeTruthy();
  expect(within(table).getByText("近期未触发")).toBeTruthy();
  fireEvent.click(within(table).getByRole("button", { name: "查看失败日志" }));
  let p = params();
  expect(window.location.hash.startsWith("#/logs?")).toBe(true);
  expect(p.get("filter.logs.from")).toBe(state.windowStart);
  expect(p.get("filter.logs.to")).toBe(state.windowEnd);
  expect(p.get("filter.logs.outcome")).toBe("FAILURE");
  expect(p.get("filter.logs.mode")).toBe("PRODUCTION");
  fireEvent.click(within(table).getByRole("button", { name: "查看窗口日志" }));
  p = params();
  expect(p.getAll("filter.logs.outcome")).toEqual([]);
  expect(screen.queryByRole("button", { name: "立即评估" })).toBeNull();
});

test("策略CAS版本与阈值保精度；关闭指标不必填写隐藏阈值", async () => {
  const calls = setup((url, options) =>
    url.endsWith("/state")
      ? new Response(JSON.stringify({ code: 200, data: { policy: { ...policy, version: "RAW", failureRateThreshold: 25.55 }, states: [state], stale: true } }).replace('"RAW"', "9007199254740993"))
      : options?.method === "PUT"
        ? Response.json({ code: 200, data: policy })
        : undefined,
  );
  render(<OperationsAlerts api={api()} canManage />);
  fireEvent.click(await screen.findByRole("button", { name: "配置策略" }));
  expect(screen.queryByLabelText("失败率阈值（%）")).toBeNull();
  fireEvent.click(screen.getByLabelText("启用失败率告警"));
  fireEvent.click(screen.getByRole("button", { name: "保存告警策略" }));
  await screen.findByText("告警策略已保存；状态以当前策略重新评估为准。");
  const write = calls.mock.calls.find(([, options]) => options?.method === "PUT")![1]!;
  expect(String(write.body)).toContain('"expectedVersion":9007199254740993');
  expect(String(write.body)).toContain('"failureRateThreshold":25.55');
  expect(write.headers).toMatchObject({ 'X-CSRF-Token': "proof" });
  fireEvent.click(await screen.findByRole("button", { name: "立即评估" }));
  await screen.findByText("评估已完成，已重新读取当前状态与事件。");
});

test("冲突输入保留，读最新版本后才能重新保存，事件有界分页", async () => {
  let current = policy,
    writes = 0;
  const calls = setup((url, options) => {
    if (options?.method === "PUT") {
      if (++writes === 1) {
        current = { ...policy, version: 1, minRequests: 200 };
        return Response.json({ code: 40900001, resultMsg: "策略版本冲突" }, { status: 409 });
      }
      current = { ...current, ...JSON.parse(options.body as string), version: 2 };
      return Response.json({ code: 200, data: current });
    }
    if (url.endsWith("/policy")) return Response.json({ code: 200, data: current });
    if (url.endsWith("/state")) return Response.json({ code: 200, data: { policy: current, states: [], stale: true } });
    if (url.includes("/events?")) return Response.json({ code: 200, data: { items: [], total: 21, page: 1, pageSize: 20 } });
  });
  render(<OperationsAlerts api={api()} canManage />);
  fireEvent.click(await screen.findByRole("button", { name: "配置策略" }));
  fireEvent.change(screen.getByLabelText("最少样本数"), { target: { value: "123" } });
  fireEvent.click(screen.getByRole("button", { name: "保存告警策略" }));
  await screen.findByRole("button", { name: "保留输入，以最新版本继续编辑" });
  expect(screen.getByLabelText("最少样本数")).toHaveProperty("value", "123");
  expect(screen.getByRole("button", { name: "保存告警策略" })).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByRole("button", { name: "关闭错误提示" }));
  fireEvent.click(screen.getByRole("button", { name: "保留输入，以最新版本继续编辑" }));
  fireEvent.click(screen.getByRole("button", { name: "保存告警策略" }));
  await screen.findByText("告警策略已保存；状态以当前策略重新评估为准。");
  expect(calls.mock.calls.filter(([, o]) => o?.method === "PUT").map(([, o]) => JSON.parse(o!.body as string).expectedVersion)).toEqual([0, 1]);
  await waitFor(() => expect(document.querySelector(".ant-pagination-next button")).toBeTruthy());
  fireEvent.click(document.querySelector(".ant-pagination-next button")!);
  await waitFor(() => expect(calls.mock.calls.some(([url]) => url.includes("/events?page=2"))).toBe(true));
  expect(window.location.hash).toContain("filter.alerts.page=2");
});

test("评估失败不伪造新事实，关闭提示仍可核对且不自动重发", async () => {
  const calls = setup((url, options) => (url.endsWith("/evaluate") && options?.method === "POST" ? Response.json({ code: 50300001, resultMsg: "依赖不可用" }, { status: 503 }) : undefined));
  render(<OperationsAlerts api={api()} canManage />);
  await screen.findByRole("table", { name: "告警列表" });
  await waitFor(() => expect(screen.getByRole("button", { name: "立即评估" })).toHaveProperty("disabled", false));
  fireEvent.click(screen.getByRole("button", { name: "立即评估" }));
  await screen.findByRole("button", { name: "核对当前状态" });
  fireEvent.click(screen.getByRole("button", { name: "关闭错误提示" }));
  expect(screen.getByText("评估结果未知，先读取实际窗口与状态。")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "核对当前状态" }));
  await screen.findByText("已读取实际评估状态；以记录窗口和策略版本为准。");
  expect(calls.mock.calls.filter(([url]) => url.endsWith("/evaluate"))).toHaveLength(1);
  expect(screen.getByText(/上次/)).toBeTruthy();
  expect(screen.getByText("数据不足")).toBeTruthy();
});

test("保存回包丢失先核对当前设置，小数尾零差异不误判冲突", async () => {
  let current = { ...policy, failureEnabled: true, failureRateThreshold: 25.5 };
  const calls = setup((url, options) => {
    if (options?.method === "PUT") {
      current = { ...current, minRequests: 101, version: 1 };
      return Response.json({ code: 50300001, resultMsg: "回包丢失" }, { status: 503 });
    }
    if (url.endsWith("/policy")) return Response.json({ code: 200, data: current });
    if (url.endsWith("/state")) return Response.json({ code: 200, data: { policy: current, states: [state], stale: true } });
  });
  render(<OperationsAlerts api={api()} canManage />);
  fireEvent.click(await screen.findByRole("button", { name: "配置策略" }));
  fireEvent.change(screen.getByLabelText("最少样本数"), { target: { value: "101" } });
  fireEvent.change(screen.getByLabelText("失败率阈值（%）"), { target: { value: "25.50" } });
  fireEvent.click(screen.getByRole("button", { name: "保存告警策略" }));
  await screen.findByRole("button", { name: "核对当前状态" });
  fireEvent.click(screen.getByRole("button", { name: "关闭错误提示" }));
  fireEvent.click(screen.getByRole("button", { name: "核对当前状态" }));
  await screen.findByText("已核对：当前策略与本次设置一致。");
  expect(calls.mock.calls.filter(([, o]) => o?.method === "PUT")).toHaveLength(1);
});

function GoAnalytics() {
  const navigation = useAdminNavigation();
  return (
    <button type="button" onClick={() => navigation.navigate({ ...navigation.route, operationsView: "statistics" })}>
      去调用分析
    </button>
  );
}

test("非法阈值就近关联字段并阻止保存；未保存策略离开告警页需确认", async () => {
  setup();
  render(
    <>
      <GoAnalytics />
      <OperationsPanel api={api()} permissions={["VIEW_AUDIT", "MANAGE_OPERATIONS"]} />
    </>,
    "#/alerts",
  );
  fireEvent.click(await screen.findByRole("button", { name: "配置策略" }));
  fireEvent.change(screen.getByLabelText("最少样本数"), { target: { value: "321" } });
  fireEvent.click(screen.getByLabelText("启用失败率告警"));
  fireEvent.change(screen.getByLabelText("失败率阈值（%）"), { target: { value: "200" } });
  const field = screen.getByLabelText("失败率阈值（%）");
  expect(field.getAttribute("aria-invalid")).toBe("true");
  expect(screen.getAllByText("请修正 1 项标红设置后保存").length).toBeGreaterThan(0);
  expect(document.getElementById(field.getAttribute("aria-describedby")!)?.textContent).toContain("0–100");
  expect(screen.getByRole("button", { name: "保存告警策略" })).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByRole("button", { name: "去调用分析" }));
  expect(await screen.findByText("告警策略还有未保存输入，离开后将丢失。")).toBeTruthy();
  expect(window.location.hash).toBe("#/alerts");
  expect(screen.getByLabelText("最少样本数")).toHaveProperty("value", "321");
});

test("告警事件到达偏移上限仍能返回上一页", async () => {
  const calls = setup((url) => (url.includes("/events?") ? Response.json({ code: 200, data: { items: [], total: 200000, page: 5001, pageSize: 20 } }) : undefined));
  render(<OperationsAlerts api={api()} canManage={false} />, "#/alerts?filter.alerts.page=5001");
  await waitFor(() => expect(document.querySelector(".ant-pagination-next")).toBeTruthy());
  expect(document.querySelector(".ant-pagination-next")?.className).toContain("disabled");
  fireEvent.click(document.querySelector(".ant-pagination-prev button")!);
  await waitFor(() => expect(calls.mock.calls.some(([url]) => url.includes("/events?page=5000"))).toBe(true));
});
