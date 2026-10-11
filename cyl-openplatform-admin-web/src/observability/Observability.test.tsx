import { AdminNavigationProvider } from "../navigation/AdminNavigation";
import { cleanup, fireEvent, render as renderView, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { createAdminApi } from "../access/api";
import ObservabilityPanel from "./ObservabilityPanel";

const render = (ui: React.ReactNode) => renderView(ui, { wrapper: AdminNavigationProvider });
afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
  window.localStorage.clear();
  vi.unstubAllGlobals();
});
const page = (items: object[], total = items.length) => Response.json({ code: 200, data: { items, total, page: 1, pageSize: 20 } });
/** 按 id 参数区分列表与详情请求，模拟服务端精确定位。 */
const serve = (rows: object[], total?: number) =>
  vi.fn(async (url: string, _options?: RequestInit) => {
    const id = new URL(url, "http://test.local").searchParams.get("id");
    const items = rows.filter((row) => !id || (row as { id: string }).id === id);
    return page(items, id ? items.length : (total ?? items.length));
  });
const listCalls = (fetchMock: ReturnType<typeof serve>, path = "/observability/calls") =>
  fetchMock.mock.calls.map(([url]) => String(url)).filter((url) => url.includes(path) && !new URL(url, "http://test.local").searchParams.get("id"));
const param = (url: string, key: string) => new URL(url, "http://test.local").searchParams.get(key);
const hashParams = () => new URLSearchParams(window.location.hash.split("?")[1] ?? "");

const businessFailure = {
  id: "business-failure", requestId: "req-business-failure", mode: "DRAFT_DEBUG",
  service: "orders", version: "v1", method: "query", outcome: "FAILURE",
  errorCode: 50200002, httpStatus: 200, durationMillis: 875,
  tenantId: "9007199254740993", tenantName: "示例测试租户", employeeNo: "E1001", employeeName: "张三",
  operatorTenantId: "operator-tenant", operatorEmployeeNo: "operator-1",
  occurredAt: "2026-09-30T00:00:00Z",
};

test("单行显示时间、API、租户名 · 人员名、结果与耗时，失败行醒目；业务失败先于平台HTTP状态", async () => {
  window.history.replaceState({}, "", "/#/logs");
  const success = { ...businessFailure, id: "next-call", requestId: "req-next-call", outcome: "SUCCESS", errorCode: null, tenantName: null, employeeName: null };
  const fetchMock = serve([businessFailure, success]);
  vi.stubGlobal("fetch", fetchMock);
  render(<ObservabilityPanel api={createAdminApi("proof", vi.fn())} permissions={["VIEW_AUDIT"]} />);
  const table = await screen.findByRole("table");
  await within(table).findByText("示例测试租户 · 张三");
  expect(within(table).getAllByText("orders.query")).toHaveLength(2);
  expect(within(table).getByText("业务失败")).toBeTruthy();
  expect(within(table).getByText("50200002 · HTTP 200")).toBeTruthy();
  expect(within(table).getAllByText("875 ms")).toHaveLength(2);
  // 缺档案时回退编号，不伪造姓名。
  expect(within(table).getByText(/租户 9007.*· 工号 E1001/)).toBeTruthy();
  const failureRow = within(table).getByText("业务失败").closest("tr")!;
  expect(failureRow.className).toContain("observation-row--failure");
  expect(within(table).getByText("调用成功").closest("tr")!.className).not.toContain("observation-row--failure");
  // 请求号默认收进列设置，行内不再堆叠多行文字。
  expect(within(table).queryByText(businessFailure.requestId)).toBeNull();
  // 只有审计权限时不读取 API 列表。
  expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/admin-api/apis"))).toBe(false);
});

test("点击行打开结论先行的详情抽屉：结论、原因、身份、HTTP来源，上一条/下一条与焦点回到触发处", async () => {
  window.history.replaceState({}, "", "/#/logs");
  const nextEntry = { ...businessFailure, id: "next-call", requestId: "req-next-call", outcome: "SUCCESS", errorCode: null };
  vi.stubGlobal("fetch", serve([businessFailure, nextEntry]));
  render(<ObservabilityPanel api={createAdminApi("proof", vi.fn())} />);
  const trigger = await screen.findByRole("button", { name: `查看 ${businessFailure.requestId} 详情` });
  trigger.focus();
  fireEvent.click(trigger);
  const dialog = await screen.findByRole("dialog");
  await within(dialog).findByText("平台响应 HTTP 200");
  const content = dialog.textContent ?? "";
  expect(content.indexOf("业务失败")).toBeLessThan(content.indexOf("错误码 50200002"));
  expect(content.indexOf("错误码 50200002")).toBeLessThan(content.indexOf("平台响应 HTTP 200"));
  expect(content.indexOf("平台响应 HTTP 200")).toBeLessThan(content.indexOf("调用身份"));
  expect(content).toContain("提供方返回业务错误（错误码 50200002）");
  expect(content).not.toContain("提供方返回 HTTP");
  expect(within(dialog).getByText("示例测试租户")).toBeTruthy();
  expect(within(dialog).getByText("调用员工号")).toBeTruthy();
  expect(within(dialog).getByText("操作员工号")).toBeTruthy();
  expect(within(dialog).getByRole("heading", { name: "HTTP 来源与耗时" })).toBeTruthy();
  expect(within(dialog).getAllByRole("button", { name: "Close" })).toHaveLength(1);
  expect(hashParams().get("record")).toBe(businessFailure.id);
  const next = within(dialog).getByRole("button", { name: "下一条" });
  next.focus();
  fireEvent.click(next);
  await within(dialog).findByText(nextEntry.requestId);
  expect(document.activeElement).toBe(next);
  expect(next.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(next);
  expect(within(dialog).getByText(nextEntry.requestId)).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
  await waitFor(() => expect(document.activeElement).toBe(trigger));
  // 点击行本身（非按钮）同样打开详情。
  fireEvent.click(screen.getAllByText("orders.query", { selector: "span" })[0].closest("td")!);
  await waitFor(() => expect(hashParams().get("record")).toBeTruthy());
});

test("粘贴 requestId 立即精确查询并打开该次调用详情，地址只写设置过的条件", async () => {
  window.history.replaceState({}, "", "/#/logs");
  const located = { ...businessFailure, id: "located", requestId: "req-located" };
  const fetchMock = vi.fn(async (url: string) => {
    const search = new URL(url, "http://test.local").searchParams;
    if (search.get("id")) return page(search.get("id") === "located" ? [located] : []);
    return page(search.get("requestId") === "req-located" ? [located] : [businessFailure]);
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<ObservabilityPanel api={createAdminApi("proof", vi.fn())} />);
  await screen.findByText("示例测试租户 · 张三");
  expect(window.location.hash).toBe("#/logs");
  fireEvent.paste(screen.getByLabelText("请求号（精确）"), { clipboardData: { getData: () => "  req-located \n" } });
  await waitFor(() => expect(hashParams().get("record")).toBe("located"));
  expect(hashParams().get("filter.logs.requestId")).toBe("req-located");
  expect([...hashParams().keys()].filter((key) => key.startsWith("filter."))).toEqual(["filter.logs.requestId"]);
  expect(listCalls(fetchMock).some((url) => param(url, "requestId") === "req-located")).toBe(true);
  const dialog = await screen.findByRole("dialog");
  await within(dialog).findByText("req-located");
  expect(screen.getByRole("group", { name: "已生效的筛选条件" }).textContent).toContain("请求号：req-located");
});

test("更多筛选中的组合条件只在“应用”后发请求，取消不生效", async () => {
  window.history.replaceState({}, "", "/#/logs");
  const fetchMock = serve([businessFailure]);
  vi.stubGlobal("fetch", fetchMock);
  render(<ObservabilityPanel api={createAdminApi("proof", vi.fn())} />);
  await screen.findByText("示例测试租户 · 张三");
  fireEvent.click(screen.getByRole("button", { name: /更多筛选/ }));
  fireEvent.change(await screen.findByLabelText("凭据 ID"), { target: { value: "app-1" } });
  fireEvent.change(screen.getByLabelText("业务租户 ID"), { target: { value: "tenant-1" } });
  fireEvent.change(screen.getByLabelText("耗时下限"), { target: { value: "500" } });
  fireEvent.change(screen.getByLabelText("耗时上限"), { target: { value: "100" } });
  expect(await screen.findByText("耗时下限不能大于上限")).toBeTruthy();
  expect(screen.getByRole("button", { name: /^应\s?用$/ }).hasAttribute("disabled")).toBe(true);
  fireEvent.change(screen.getByLabelText("耗时上限"), { target: { value: "2000" } });
  expect(listCalls(fetchMock).some((url) => url.includes("applicationId") || url.includes("durationMin"))).toBe(false);
  expect(window.location.hash).toBe("#/logs");
  fireEvent.click(screen.getByRole("button", { name: /^应\s?用$/ }));
  await waitFor(() =>
    expect(
      listCalls(fetchMock).some(
        (url) => param(url, "applicationId") === "app-1" && param(url, "tenantId") === "tenant-1" && param(url, "durationMin") === "500" && param(url, "durationMax") === "2000",
      ),
    ).toBe(true),
  );
  expect(hashParams().get("filter.logs.applicationId")).toBe("app-1");
  expect(screen.getByRole("group", { name: "已生效的筛选条件" }).textContent).toContain("耗时下限：500 ms");
  // 再次打开改动后取消：不发请求、不改地址。
  const before = listCalls(fetchMock).length;
  fireEvent.click(screen.getByRole("button", { name: /更多筛选/ }));
  fireEvent.change(await screen.findByLabelText("人员工号"), { target: { value: "E-9" } });
  fireEvent.click(screen.getByRole("button", { name: /^取\s?消$/ }));
  await waitFor(() => expect(screen.queryByLabelText("人员工号")).toBeNull());
  expect(listCalls(fetchMock).length).toBe(before);
  expect(hashParams().get("filter.logs.employeeNo")).toBeNull();
  // 删除租户标签即时生效并回到干净条件。
  fireEvent.click(screen.getByRole("button", { name: "清除 租户：tenant-1" }));
  await waitFor(() => expect(hashParams().get("filter.logs.tenantId")).toBeNull());
});

test("时间快捷项即时生效，翻页沿用同一时间窗口且未提交的请求号不发送", async () => {
  window.history.replaceState({}, "", "/#/logs");
  const fetchMock = serve([{ ...businessFailure, id: "c1", requestId: "page-request" }], 45);
  vi.stubGlobal("fetch", fetchMock);
  render(<ObservabilityPanel api={createAdminApi("proof", vi.fn())} />);
  await screen.findByText("示例测试租户 · 张三");
  const first = listCalls(fetchMock)[0];
  expect(Date.parse(param(first, "to")!) - Date.parse(param(first, "from")!)).toBe(86400000);
  fireEvent.click(screen.getByText("近 1 小时"));
  await waitFor(() => expect(hashParams().get("filter.logs.range")).toBe("1h"));
  await waitFor(() => {
    const last = listCalls(fetchMock).at(-1)!;
    expect(Date.parse(param(last, "to")!) - Date.parse(param(last, "from")!)).toBe(3600000);
  });
  fireEvent.change(screen.getByLabelText("请求号（精确）"), { target: { value: "未提交请求号" } });
  const windowBefore = listCalls(fetchMock).at(-1)!;
  fireEvent.click(screen.getByTitle("2"));
  await waitFor(() => expect(listCalls(fetchMock).some((url) => param(url, "page") === "2")).toBe(true));
  const second = listCalls(fetchMock).find((url) => param(url, "page") === "2")!;
  expect(param(second, "from")).toBe(param(windowBefore, "from"));
  expect(screen.getByLabelText("请求号（精确）")).toHaveProperty("value", "未提交请求号");
  expect(fetchMock.mock.calls.every(([url]) => !String(url).includes(encodeURIComponent("未提交请求号")))).toBe(true);
});

test("无效或超过31天的时间链接不发送无界查询，可一键恢复", async () => {
  window.history.replaceState({}, "", "/#/logs?filter.logs.from=badZ");
  const fetchMock = serve([]);
  vi.stubGlobal("fetch", fetchMock);
  const view = render(<ObservabilityPanel initialView="calls" api={createAdminApi("proof", vi.fn())} />);
  await screen.findByText("时间范围无效");
  expect(fetchMock.mock.calls).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "恢复近 24 小时" }));
  await waitFor(() => expect(fetchMock.mock.calls).toHaveLength(1));
  expect(screen.queryByText("时间范围无效")).toBeNull();
  view.unmount();
  window.history.replaceState({}, "", "/#/logs?filter.logs.from=2026-01-01T00:00:00Z&filter.logs.to=2026-03-01T00:00:00Z");
  const longRange = serve([]);
  vi.stubGlobal("fetch", longRange);
  render(<ObservabilityPanel initialView="calls" api={createAdminApi("proof", vi.fn())} />);
  await screen.findByText("时间范围无效");
  expect(longRange.mock.calls).toHaveLength(0);
});

test("旧命名空间 calls 的分享链接迁移为 logs，from/to、规则与治理条件还原为同一视图", async () => {
  window.history.replaceState(
    {},
    "",
    "/#/logs?filter.calls.from=2026-09-30T00:00:00.000Z&filter.calls.to=2026-09-30T01:00:00.000Z&filter.calls.ruleId=API:x&filter.calls.governanceOutcome=REJECTED&filter.calls.page=1",
  );
  const fetchMock = serve([]);
  vi.stubGlobal("fetch", fetchMock);
  render(<ObservabilityPanel initialView="calls" api={createAdminApi("proof", vi.fn())} />);
  await waitFor(() => expect(listCalls(fetchMock)).toHaveLength(1));
  const url = listCalls(fetchMock)[0];
  expect(param(url, "from")).toBe("2026-09-30T00:00:00.000Z");
  expect(param(url, "ruleId")).toBe("API:x");
  expect(param(url, "governanceOutcome")).toBe("REJECTED");
  const chips = screen.getByRole("group", { name: "已生效的筛选条件" }).textContent ?? "";
  expect(chips).toContain("规则：API:x");
  expect(chips).toContain("治理结果：实际拒绝");
  expect(hashParams().get("filter.logs.ruleId")).toBe("API:x");
  expect([...hashParams().keys()].some((key) => key.startsWith("filter.calls."))).toBe(false);
  expect(hashParams().get("filter.logs.page")).toBeNull();
});

test("工作台等入口以 range/outcome/tenantId/employeeNo 与 record/recordAt 打开即定位", async () => {
  window.history.replaceState({}, "", `/#/logs?filter.logs.range=1h&filter.logs.outcome=FAILURE&filter.logs.tenantId=t-1&filter.logs.employeeNo=E1001&record=${businessFailure.id}&recordAt=${businessFailure.occurredAt}`);
  const fetchMock = serve([businessFailure]);
  vi.stubGlobal("fetch", fetchMock);
  render(<ObservabilityPanel initialView="calls" api={createAdminApi("proof", vi.fn())} />);
  const dialog = await screen.findByRole("dialog");
  await within(dialog).findByText("平台响应 HTTP 200");
  const url = listCalls(fetchMock)[0];
  expect(Date.parse(param(url, "to")!) - Date.parse(param(url, "from")!)).toBe(3600000);
  expect(param(url, "outcome")).toBe("FAILURE");
  expect(param(url, "tenantId")).toBe("t-1");
  expect(param(url, "employeeNo")).toBe("E1001");
});

test("草稿内置限额不冒充可配置规则，真实治理规则仍能打开", async () => {
  const entry = {
    id: "call-debug-limit", requestId: "request-debug-limit", mode: "DRAFT_DEBUG",
    apiId: "API_demo_logging", outcome: "SUCCESS", httpStatus: 200, durationMillis: 12,
    occurredAt: "2026-09-27T08:48:19.002098Z",
    governance: {
      allowed: true, denialReason: "NONE", retryAfterSeconds: 0,
      hits: [
        { ruleId: "DRAFT_DEBUG_LIMIT:API_demo_logging", version: 0, targetType: "API", mode: "ENFORCE", algorithm: "TOKEN_BUCKET", reason: "NONE", retryAfterSeconds: 0 },
        { ruleId: "API:API_demo_logging", version: 3, targetType: "API", mode: "ENFORCE", algorithm: "TOKEN_BUCKET", reason: "NONE", retryAfterSeconds: 0 },
      ],
    },
  };
  vi.stubGlobal("fetch", serve([entry]));
  render(<ObservabilityPanel api={createAdminApi("proof", vi.fn())} permissions={["VIEW_AUDIT", "MANAGE_APIS"]} />);
  fireEvent.click(await screen.findByRole("button", { name: `查看 ${entry.requestId} 详情` }));
  await screen.findByText(entry.governance.hits[0].ruleId);
  expect(screen.getAllByRole("button", { name: "打开当前规则" })).toHaveLength(1);
  expect(screen.getByText("草稿调试内置限额")).toBeTruthy();
  expect(screen.getByText("平台内置 · 按 API 独立计数，无独立规则配置")).toBeTruthy();
  expect(screen.queryByText(/· v0/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "打开当前规则" }));
  expect(hashParams().get("rule")).toBe(entry.governance.hits[1].ruleId);
});

test("发布记录按当次快照解释并精确跳转，审计只读身份不展示无权限入口", async () => {
  const entry = {
    id: "CAL_" + "a".repeat(32), requestId: "release-call", releaseId: "REL_" + "b".repeat(32), apiId: "API_" + "c".repeat(32),
    applicationId: "app-1", mode: "PRODUCTION", outcome: "SUCCESS", httpStatus: 200, durationMillis: 10, occurredAt: "2026-09-27T08:48:17Z",
  };
  vi.stubGlobal("fetch", serve([entry]));
  const first = render(<ObservabilityPanel api={createAdminApi("proof", vi.fn())} permissions={["VIEW_AUDIT"]} />);
  fireEvent.click(await screen.findByRole("button", { name: "查看 release-call 详情" }));
  await screen.findByText(entry.releaseId);
  expect(screen.queryByRole("button", { name: "查看发布快照" })).toBeNull();
  expect(screen.queryByRole("button", { name: "查看凭据授权" })).toBeNull();
  expect(screen.queryByRole("button", { name: "打开当前 API 工作区" })).toBeNull();
  first.unmount();
  window.history.replaceState({}, "", "/");
  const openCredential = vi.fn();
  render(<ObservabilityPanel api={createAdminApi("proof", vi.fn())} permissions={["VIEW_AUDIT", "PUBLISH_APIS"]} onOpenCredential={openCredential} />);
  fireEvent.click(await screen.findByRole("button", { name: "查看 release-call 详情" }));
  fireEvent.click(await screen.findByRole("button", { name: "查看凭据授权" }));
  expect(openCredential).toHaveBeenCalledWith("app-1");
  fireEvent.click(await screen.findByRole("button", { name: "查看发布快照" }));
  expect(hashParams().get("release")).toBe(entry.releaseId);
  expect(window.location.hash).toContain("/reviews");
});

const auditEntry = {
  id: "a1", source: "PUBLICATION", requestId: "release-request", apiId: "api-1", action: "APPROVE", outcome: "SUCCESS",
  releaseId: "release-1", operatorEmployeeNo: "reviewer", operatorTenantId: "101", operatorName: "李审核", occurredAt: "2026-09-09T00:00:00Z",
};

test("管理审计同一列表范式：操作人显示姓名，点击看来源与发布关联详情", async () => {
  window.history.replaceState({}, "", "/#/audits");
  const unnamed = { ...auditEntry, id: "a2", source: "ACCESS", action: "CREATE_APPLICATION", operatorName: null, operatorEmployeeNo: "E1001", outcome: "FAILURE" };
  const fetchMock = serve([auditEntry, unnamed]);
  vi.stubGlobal("fetch", fetchMock);
  render(<ObservabilityPanel initialView="audits" api={createAdminApi("proof", vi.fn())} />);
  const table = await screen.findByRole("table");
  await within(table).findByText("李审核");
  expect(within(table).getByText("工号 E1001")).toBeTruthy();
  expect(within(table).getByText("审核通过")).toBeTruthy();
  expect(within(table).getByText("失败").closest("tr")!.className).toContain("observation-row--failure");
  fireEvent.click(within(table).getByText("李审核").closest("td")!);
  const dialog = await screen.findByRole("dialog");
  expect(await within(dialog).findByText("release-1")).toBeTruthy();
  expect(within(dialog).getAllByText(/发布/).length).toBeGreaterThan(0);
  expect(within(dialog).getByText("李审核")).toBeTruthy();
  await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes("id=a1") && String(url).includes("source=PUBLICATION"))).toBe(true));
  expect(hashParams().get("recordSource")).toBe("PUBLICATION");
});

test("管理审计按来源即时筛选、操作人在应用后筛选", async () => {
  window.history.replaceState({}, "", "/#/audits");
  const fetchMock = serve([auditEntry]);
  vi.stubGlobal("fetch", fetchMock);
  render(<ObservabilityPanel initialView="audits" api={createAdminApi("proof", vi.fn())} />);
  await screen.findByText("李审核");
  fireEvent.mouseDown(screen.getByRole("combobox", { name: "来源" }));
  fireEvent.click(await screen.findByTitle("令牌操作"));
  await waitFor(() => expect(hashParams().getAll("filter.audits.source")).toEqual(["TOKEN"]));
  await waitFor(() => expect(listCalls(fetchMock, "/observability/audits").some((url) => param(url, "source") === "TOKEN")).toBe(true));
  fireEvent.click(screen.getByRole("button", { name: /更多筛选/ }));
  fireEvent.change(await screen.findByLabelText("操作人工号"), { target: { value: "reviewer" } });
  expect(listCalls(fetchMock, "/observability/audits").some((url) => url.includes("operatorEmployeeNo"))).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: /^应\s?用$/ }));
  await waitFor(() => expect(listCalls(fetchMock, "/observability/audits").some((url) => param(url, "operatorEmployeeNo") === "reviewer")).toBe(true));
  expect(hashParams().get("filter.audits.operatorEmployeeNo")).toBe("reviewer");
});

test("详情关闭保留未提交请求号输入，审计ID与来源共同定位", async () => {
  window.history.replaceState({}, "", "/#/audits");
  const entry = { id: "audit-1", source: "ACCESS", requestId: "request-1", action: "CREATE_APPLICATION", outcome: "SUCCESS", occurredAt: "2026-09-27T08:00:00Z", operatorEmployeeNo: "E1001", applicationId: "app-1" };
  const fetchMock = serve([entry]);
  vi.stubGlobal("fetch", fetchMock);
  render(<ObservabilityPanel initialView="audits" api={createAdminApi("proof", vi.fn())} />);
  const trigger = await screen.findByRole("button", { name: "查看 request-1 审计详情" });
  fireEvent.change(screen.getByLabelText("请求号（精确）"), { target: { value: "还未提交" } });
  fireEvent.click(trigger);
  await screen.findByText("复制详情链接");
  await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes("id=audit-1") && String(url).includes("source=ACCESS"))).toBe(true));
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }));
  expect(screen.getByLabelText("请求号（精确）")).toHaveProperty("value", "还未提交");
  expect(fetchMock.mock.calls.every(([url]) => !String(url).includes(encodeURIComponent("还未提交")))).toBe(true);
});

test("无来源的审计详情链接不任意取同ID第一条", async () => {
  window.history.replaceState({}, "", "/#/audits?record=same-id");
  const fetchMock = serve([]);
  vi.stubGlobal("fetch", fetchMock);
  render(<ObservabilityPanel initialView="audits" api={createAdminApi("proof", vi.fn())} />);
  await screen.findByText("审计详情链接缺少来源，请关闭后从列表选择记录。");
  expect(fetchMock.mock.calls.every(([url]) => !String(url).includes("id=same-id"))).toBe(true);
});
