import { PlatformTheme } from "@cyl/open-platform-web-shared/ui/PlatformTheme";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { createAdminApi } from "../../access/api";
import { AdminNavigationProvider } from "../../navigation/AdminNavigation";
import CatalogPanel from "../CatalogPanel";
import { draftKey } from "./quickCreateModel";

const ok = (data: unknown) => Response.json({ code: 200, data, requestId: "r1" });
const page = (items: unknown[]) => ok({ items, total: items.length, page: 1, pageSize: 20 });
const owner = "EMP_00000000000000000000000000000001";
const created = {
  id: "api9",
  service: "order",
  version: "v1",
  method: "orders",
  name: "订单详情",
  category: "订单",
  owner,
  protocol: "HTTP",
  draftRevision: 1,
  scopeCodes: [],
  requestSchema: { type: "OBJECT", properties: {} },
  responseSchema: { type: "OBJECT", properties: {} },
  errorDefinitions: [],
  binding: { protocol: "HTTP", timeoutMillis: 3000, http: { url: "http://order-svc/x", method: "POST" } },
  mappings: [],
};
const existing = { ...created, id: "api1", name: "查询订单", service: "orders", method: "query" };
const connection = { id: "c1", name: "注册中心A", enabled: true, activeRevision: 2, metadataType: "INTERFACE", registryCheck: null };

function defaults(url: string, init?: RequestInit) {
  if (url.includes("/apis/owners/")) return ok({ id: owner, displayName: "研发", employeeNo: "E1001", employeeId: "person", tenantId: "101" });
  if (url.includes("/api-categories/resolve")) return ok("订单");
  if (url.includes("/categories?")) return page(["订单"]);
  if (url.includes("/dubbo-connections/options")) return page([connection]);
  if (url.includes("/dubbo-connections/c1/summary")) return ok(connection);
  if (url.endsWith("/apis/validate?newOperation=true") && init?.method === "POST") return ok({ valid: true, fieldIssues: [], truncated: false, checkedDraftRevision: null });
  if (url.endsWith("/apis") && init?.method === "POST") return ok(created);
  if (url.includes("/apis/api9/workspace")) return ok({ definition: created, publication: { apiId: "api9", stateVersion: 1, enabled: false, liveReleaseId: null, pendingReleaseId: null }, liveDraftRevision: null, pendingDraftRevision: null });
  return page([existing]);
}
function mount(route: string, handler?: (url: string, init?: RequestInit) => Response | undefined) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => handler?.(url, init) ?? defaults(url, init));
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", route);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <AdminNavigationProvider>
      <PlatformTheme>{children}</PlatformTheme>
    </AdminNavigationProvider>
  );
  render(<CatalogPanel api={createAdminApi("proof", vi.fn())} permissions={["MANAGE_APIS"]} />, { wrapper });
  return fetchMock;
}
const posted = (calls: ReturnType<typeof mount>, suffix: string) =>
  calls.mock.calls.filter(([url, init]) => url.endsWith(suffix) && init?.method === "POST").map(([, init]) => JSON.parse(String(init!.body)));
const chooseCategory = async () => {
  fireEvent.mouseDown(screen.getByRole("combobox", { name: "分类" }));
  fireEvent.click(await screen.findByText("订单", { selector: ".ant-select-item-option-content" }));
};
/** antd 测试环境下 Modal 的 aria-labelledby 使用固定 test-id，按标题文字定位面板。 */
const sourcePanel = async () => {
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByText("新建 API")).toBeTruthy();
  return dialog;
};
const ownerReady = () => waitFor(() => expect(screen.getByLabelText("负责人")).toHaveProperty("value", "研发 · 工号 E1001"));

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
  window.history.replaceState({}, "", "/#/apis");
  vi.unstubAllGlobals();
});

test("新建 API 只有一个入口：来源面板列出全部方式，按来源进入对应流程", async () => {
  mount("/#/apis/new");
  const dialog = await sourcePanel();
  for (const name of ["OpenAPI 文档", "cURL / HTTP 请求", "Dubbo 方法签名", "平台导出 JSON", "复制已有 API", "HTTP 接口", "Dubbo 接口"])
    expect(within(dialog).getByRole("button", { name: new RegExp(name.replace(/[/()]/g, "\\$&")) })).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("button", { name: /cURL \/ HTTP 请求/ }));
  expect(window.location.hash).toBe("#/apis/new?source=curl");
  expect(await screen.findByRole("heading", { name: "新建 HTTP API" })).toBeTruthy();
  expect(screen.getByLabelText("粘贴 cURL 或原始 HTTP 请求")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "更换来源" }));
  fireEvent.click(within(await sourcePanel()).getByRole("button", { name: /OpenAPI 文档/ }));
  expect(window.location.hash).toBe("#/apis/import?source=openapi");
});

test("关闭来源面板回到列表；复制已有 API 先选来源再确认新标识", async () => {
  mount("/#/apis/new");
  const dialog = await sourcePanel();
  fireEvent.click(within(dialog).getByRole("button", { name: /复制已有 API/ }));
  fireEvent.click(await screen.findByRole("button", { name: "复制 查询订单" }));
  expect(await screen.findByText("复制为新 API · 查询订单")).toBeTruthy();
  expect(screen.queryByText("从已有资料")).toBeNull();
  cleanup();
  mount("/#/apis/new");
  fireEvent.click(within(await sourcePanel()).getByRole("button", { name: "关闭新建面板" }));
  await waitFor(() => expect(window.location.hash).toBe("#/apis"));
});

test("粘贴 cURL 一次填入目标、推导标识，创建完整草稿后直接进入配置页", async () => {
  const calls = mount("/#/apis/new?source=curl");
  fireEvent.change(await screen.findByLabelText("粘贴 cURL 或原始 HTTP 请求"), {
    target: { value: `curl -X POST 'http://order-svc/internal/orders/{orderNo}' -H 'Content-Type: application/json' -H 'Authorization: Bearer x' -d '{"includeItems":true}'` },
  });
  fireEvent.click(screen.getByRole("button", { name: "识别并填入" }));
  expect(screen.getByLabelText("目标地址")).toHaveProperty("value", "http://order-svc/internal/orders/{orderNo}");
  expect(screen.getByText(/已识别路径参数/).textContent).toContain("orderNo");
  expect(screen.getByLabelText("service")).toHaveProperty("value", "order");
  expect(screen.getByLabelText("method")).toHaveProperty("value", "orders");
  expect(screen.getByText("POST /api/oauth/order/v1/orders")).toBeTruthy();
  expect((screen.getByLabelText("请求样例 JSON") as HTMLTextAreaElement).value).toContain("includeItems");
  expect(screen.getByText(/认证、Cookie/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText("名称"), { target: { value: "订单详情" } });
  await chooseCategory();
  await ownerReady();
  fireEvent.click(screen.getByRole("button", { name: "创建草稿并继续完善" }));
  await waitFor(() => expect(window.location.hash).toBe("#/apis/api9/config"));
  const [checked] = posted(calls, "/apis/validate?newOperation=true");
  const [body] = posted(calls, "/apis");
  expect(body).toEqual(checked);
  expect(body).toMatchObject({
    service: "order",
    method: "orders",
    version: "v1",
    name: "订单详情",
    category: "订单",
    owner,
    scopeCodes: [],
    responseAdapter: { mode: "DIRECT" },
    responseSchema: { type: "OBJECT", properties: {} },
    binding: { protocol: "HTTP", timeoutMillis: 3000, http: { targetMode: "URL", url: "http://order-svc/internal/orders/{orderNo}", method: "POST" } },
    mappings: [
      { target: "orderNo", source: "REQUEST", path: "orderNo", location: "PATH" },
      { target: "includeItems", source: "REQUEST", path: "includeItems", location: "BODY" },
    ],
  });
  expect(body.requestSchema.properties.orderNo).toEqual({ type: "STRING", required: true });
  expect(JSON.stringify(body)).not.toContain("Bearer");
  expect(window.sessionStorage.getItem(draftKey("curl"))).toBeNull();
});

test("错误只在离开字段或点击创建后出现，并定位到具体字段；未通过时不创建", async () => {
  const calls = mount("/#/apis/new?source=http");
  const name = await screen.findByLabelText("名称");
  expect(screen.queryByText("请填写名称")).toBeNull();
  fireEvent.blur(name);
  expect(await screen.findByText("请填写名称")).toBeTruthy();
  expect(screen.queryByText("请填写目标地址")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "创建草稿并继续完善" }));
  expect(await screen.findByText("请填写目标地址")).toBeTruthy();
  expect(screen.getByText("请选择分类")).toBeTruthy();
  expect(posted(calls, "/apis")).toHaveLength(0);
  expect(posted(calls, "/apis/validate?newOperation=true")).toHaveLength(0);
});

test("服务端字段问题回到对应字段；标识冲突在创建前预检提示", async () => {
  const calls = mount("/#/apis/new?source=http", (url, init) =>
    url.endsWith("/apis/validate?newOperation=true") && init?.method === "POST"
      ? ok({ valid: false, truncated: false, checkedDraftRevision: null, fieldIssues: [{ path: "/method", reason: "INVALID_VALUE", message: "该标识已被 API「查询订单」使用" }, { path: "/mappings/0/path", reason: "INVALID_VALUE", message: "映射来源不存在" }] })
      : undefined,
  );
  fireEvent.change(await screen.findByLabelText("目标地址"), { target: { value: "http://orders.example/query" } });
  expect(screen.getByLabelText("service")).toHaveProperty("value", "orders");
  expect(screen.getByLabelText("method")).toHaveProperty("value", "query");
  fireEvent.blur(screen.getByLabelText("method"));
  expect(await screen.findByText("该标识已被 API「查询订单」使用")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("名称"), { target: { value: "查询" } });
  await chooseCategory();
  await ownerReady();
  fireEvent.click(screen.getByRole("button", { name: "创建草稿并继续完善" }));
  expect(await screen.findByText("映射来源不存在")).toBeTruthy();
  expect(posted(calls, "/apis")).toHaveLength(0);
  fireEvent.change(screen.getByLabelText("method"), { target: { value: "query_v2" } });
  expect(screen.queryByText("该标识已被 API「查询订单」使用")).toBeNull();
  expect(screen.getByRole("button", { name: "恢复自动推导" })).toBeTruthy();
});

test("Dubbo：选连接并粘贴签名，解析接口与参数，按顺序生成 argN 映射", async () => {
  const calls = mount("/#/apis/new?source=dubbo");
  expect(await screen.findByRole("heading", { name: "新建 Dubbo API" })).toBeTruthy();
  fireEvent.mouseDown(screen.getByRole("combobox", { name: "注册中心连接" }));
  fireEvent.click(await screen.findByText(/注册中心A · r2/, { selector: ".ant-select-item-option-content" }));
  fireEvent.change(screen.getByLabelText("方法签名"), { target: { value: "com.example.order.OrderQueryFacade#queryOrder(java.lang.String, int)" } });
  expect(screen.getByText("arg0: String")).toBeTruthy();
  expect(screen.getByLabelText("service")).toHaveProperty("value", "order_query");
  expect(screen.getByLabelText("method")).toHaveProperty("value", "query_order");
  fireEvent.change(screen.getByLabelText("名称"), { target: { value: "查询订单" } });
  await chooseCategory();
  await ownerReady();
  fireEvent.click(screen.getByRole("button", { name: "创建草稿并继续完善" }));
  await waitFor(() => expect(posted(calls, "/apis")).toHaveLength(1));
  const [body] = posted(calls, "/apis");
  expect(body.binding).toEqual({
    protocol: "DUBBO",
    timeoutMillis: 3000,
    dubbo: { interfaceName: "com.example.order.OrderQueryFacade", method: "queryOrder", parameterTypes: ["java.lang.String", "int"], version: "", group: "", connectionId: "c1", connectionRevision: 2, providerApplication: null },
  });
  expect(body.mappings).toEqual([
    { target: "arg0", source: "REQUEST", path: "arg0" },
    { target: "arg1", source: "REQUEST", path: "arg1" },
  ]);
});

test("示例一键填入；输入每 3 秒暂存，误关后重新打开可恢复或丢弃", async () => {
  mount("/#/apis/new?source=example-http");
  expect(await screen.findByLabelText("名称")).toHaveProperty("value", "查询订单详情（示例）");
  fireEvent.change(screen.getByLabelText("名称"), { target: { value: "我的示例" } });
  await waitFor(() => expect(window.sessionStorage.getItem(draftKey("example-http"))).toContain("我的示例"), { timeout: 4500 });
  cleanup();
  mount("/#/apis/new?source=example-http");
  expect(await screen.findByText(/已恢复 .* 暂存的输入/)).toBeTruthy();
  expect(screen.getByLabelText("名称")).toHaveProperty("value", "我的示例");
  fireEvent.click(screen.getByRole("button", { name: "丢弃，重新开始" }));
  expect(screen.getByLabelText("名称")).toHaveProperty("value", "查询订单详情（示例）");
  expect(window.sessionStorage.getItem(draftKey("example-http"))).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  expect(window.location.hash).toBe("#/apis");
}, 10_000);
