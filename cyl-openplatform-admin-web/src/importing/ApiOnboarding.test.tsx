import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import ApiOnboarding from "./ApiOnboarding";
import { AdminNavigationProvider } from "../navigation/AdminNavigation";
import type { AdminApi } from "../access/api";
const definition = {
  service: "orders",
  version: "1.0",
  method: "find",
  name: "查询订单",
  category: "订单",
  owner: "EMP_00000000000000000000000000000001",
  scopeCodes: [],
  requestSchema: { type: "OBJECT", properties: {} },
  responseSchema: { type: "STRING" },
  errorDefinitions: [],
  binding: {
    protocol: "HTTP",
    timeoutMillis: 3000,
    http: { url: "https://example.test/orders", method: "POST" },
  },
  mappings: [],
};
// 候选编辑挂载完整配置页（分区、字段表、检查面板），整轮并行时单例接近 5 秒。
vi.setConfig({ testTimeout: 15000 });
afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
  vi.restoreAllMocks();
  sessionStorage.clear();
});
test("来源候选在配置页补齐，批量补充共用信息，核对后才进入导入预览，不提前写草稿", async () => {
  const api = vi.fn(async (path: string) =>
    path.startsWith('/apis/owners/') ? {id:definition.owner, displayName:'研发',employeeNo:'E1001',employeeId:'person',tenantId:'101'} : path.startsWith('/apis/categories?') ? {items:['订单'],total:1,page:1,pageSize:20} : path === "/api-imports/sources/openapi"
      ? {
          sourceDigest: "a".repeat(64),
          items: [
            {
              key: "one",
              label: "POST /orders",
              definition: {
                ...definition,
                service: "",
                version: "",
                category: "",
                owner: "",
              },
              warnings: ["核对映射"],
              blockers: [],
            },
            {
              key: "bad",
              label: "GET /cycle",
              definition: null,
              warnings: [],
              blockers: ["循环引用，请人工补齐"],
            },
          ],
        }
      : path === "/apis/validate"
        ? { valid: true, fieldIssues: [], truncated: false }
        : { items: [], total: 0 },
  );
  render(
    <AdminNavigationProvider>
      <ApiOnboarding
        api={api as AdminApi}
        onReturn={vi.fn()}
        onManual={vi.fn()}
        onOpen={vi.fn()}
      />
    </AdminNavigationProvider>,
  );
  fireEvent.change(screen.getByLabelText("来源文本"), {
    target: { value: '{"openapi":"3.0.3"}' },
  });
  fireEvent.click(screen.getByRole("button", { name: "解析来源，选择接口" }));
  expect(await screen.findByLabelText("选择 POST /orders")).toHaveProperty(
    "disabled",
    true,
  );
  fireEvent.click(screen.getByText("批量补充共用信息"));
  for (const [label, value] of [
    ["共用服务标识", "orders"],
    ["共用外部版本", "1.0"],
  ])
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  fireEvent.mouseDown(screen.getByRole('combobox',{name:'共用分类'}));
  fireEvent.click(await screen.findByText('订单',{selector:'.ant-select-item-option-content'}));
  await waitFor(()=>expect(screen.getByLabelText('共用负责人')).toHaveProperty('value','研发 · 工号 E1001'));
  fireEvent.click(screen.getByRole("button", { name: "补入共用信息" }));
  fireEvent.click(screen.getAllByRole("button", { name: "补齐配置" })[0]);
  expect(await screen.findByLabelText("接口名称")).toHaveProperty(
    "value",
    "查询订单",
  );
  expect(screen.getByLabelText("服务标识")).toHaveProperty("value", "orders");
  await waitFor(()=>expect(screen.getByLabelText("负责人")).toHaveProperty("value", "研发 · 工号 E1001"));
  fireEvent.click(screen.getByRole("button", { name: "确认候选" }));
  await waitFor(() =>
    expect(screen.getByLabelText("选择 POST /orders")).toHaveProperty(
      "checked",
      true,
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "修改候选" }));
  fireEvent.change(await screen.findByLabelText("接口名称"), {
    target: { value: "修改后的订单查询" },
  });
  fireEvent.click(screen.getByRole("button", { name: "确认候选" }));
  expect(await screen.findByLabelText("选择 POST /orders")).toHaveProperty(
    "checked",
    true,
  );
  expect(
    screen.queryByLabelText("已按来源人工核对字段、约束、响应和参数映射"),
  ).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "核对本批差异（1 / 20）" }),
  );
  expect(await screen.findByLabelText("接口配置 JSON")).toHaveProperty(
    "value",
    expect.stringContaining("修改后的订单查询"),
  );
  expect(
    api.mock.calls.filter(
      ([path]) => path === "/apis" || path === "/api-imports/confirm",
    ),
  ).toHaveLength(0);
});

test("不接受超限文件，保留当前来源；取消补齐不产生占位记录", async () => {
  const api = vi.fn();
  render(
    <AdminNavigationProvider>
      <ApiOnboarding
        api={api as AdminApi}
        onReturn={vi.fn()}
        onManual={vi.fn()}
        onOpen={vi.fn()}
      />
    </AdminNavigationProvider>,
  );
  fireEvent.change(screen.getByLabelText("来源文本"), {
    target: { value: "keep" },
  });
  const file = new File(["x".repeat(262145)], "large.json");
  fireEvent.change(screen.getByLabelText("上传来源文件"), {
    target: { files: [file] },
  });
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain("超过 256 KiB"),
  );
  expect(screen.getByLabelText("来源文本")).toHaveProperty("value", "keep");
  expect(api).not.toHaveBeenCalled();
});
