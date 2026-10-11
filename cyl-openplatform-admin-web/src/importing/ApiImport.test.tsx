import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { createAdminApi } from "../access/api";
import ApiImport from "./ApiImport";
import ApiOnboarding from "./ApiOnboarding";
import { AdminNavigationProvider } from "../navigation/AdminNavigation";

const source = '{"name":"订单","amount":0.123456789012345678901}';
const preview = {
  documentDigest: "a".repeat(64),
  items: [
    {
      index: 0,
      operation: { service: "orders", version: "v1", method: "query" },
      change: "UPDATE",
      expectedRevision: 2,
      changedFields: ["name"],
      before: { name: "旧订单" },
      after: { name: "新订单" },
      errors: [],
    },
    {
      index: 1,
      operation: null,
      change: "ERROR",
      expectedRevision: 0,
      changedFields: [],
      before: null,
      after: null,
      errors: ["权限组不存在"],
    },
    {
      index: 2,
      operation: { service: "orders", version: "v1", method: "same" },
      change: "UNCHANGED",
      expectedRevision: 1,
      changedFields: [],
      before: {},
      after: {},
      errors: [],
    },
  ],
};
function setup(
  confirm = Response.json({
    code: 200,
    data: {
      committed: true,
      items: [
        { index: 0, change: "UPDATE", apiId: "api-1", revision: 3, errors: [] },
      ],
    },
  }),
) {
  const fetchMock = vi.fn(async (url: string, _init?: RequestInit) =>
    url.endsWith("/preview")
      ? Response.json({ code: 200, data: preview })
      : confirm,
  );
  vi.stubGlobal("fetch", fetchMock);
  const done = vi.fn();
  const view = render(
    <AdminNavigationProvider>
      <ApiImport api={createAdminApi("csrf", vi.fn())} onReturn={done} operatorKey="test-actor" />
    </AdminNavigationProvider>,
  );
  return { fetchMock, done, view };
}
async function openPreview() {
  fireEvent.change(screen.getByLabelText("接口配置 JSON"), {
    target: { value: source },
  });
  fireEvent.click(screen.getByRole("button", { name: "预览导入差异" }));
  await screen.findByText("orders/v1/query");
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  sessionStorage.clear();
});

test("差异明确展示，默认不选，错误与无变化不可选，修改来源废弃预览", async () => {
  setup();
  await openPreview();
  const choices = screen.getAllByRole("checkbox") as HTMLInputElement[];
  expect(choices.every((choice) => !choice.checked)).toBe(true);
  expect(choices.map((choice) => choice.disabled)).toEqual([false, true, true]);
  fireEvent.click(screen.getAllByRole("button", { name: "字段差异" })[0]);
  expect(screen.getByText(/旧订单/)).toBeTruthy();
  expect(screen.getByText(/新订单/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "返回差异列表" }));
  fireEvent.click(screen.getByLabelText("第 1 项 · 更新"));
  fireEvent.change(screen.getByLabelText("接口配置 JSON"), {
    target: { value: "{}" },
  });
  expect(screen.queryByText("orders/v1/query")).toBeNull();
  expect(screen.queryByRole("button", { name: "确认写入草稿" })).toBeNull();
});

test("同页明确确认并保持来源精度，成功显示修订且返回目录", async () => {
  const { fetchMock, done } = setup();
  await openPreview();
  fireEvent.click(screen.getAllByRole("checkbox")[0]);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("region", { name: "保存与操作" }).textContent).toContain("完整替换");
  expect(screen.queryByRole("alertdialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "确认写入草稿" }));
  expect(await screen.findByText(/api-1/)).toBeTruthy();
  const init = fetchMock.mock.calls[1][1] as RequestInit;
  expect(String(init.body)).toContain(`"document":${source}`);
  expect(String(init.body)).toContain(
    '"selections":[{"index":0,"expectedRevision":2}]',
  );
  fireEvent.click(screen.getByRole("button", { name: "返回并刷新 API 目录" }));
  expect(done).toHaveBeenCalledOnce();
});

test("确认冲突显示逐项结果，不自动重试且要求重新预览", async () => {
  const { fetchMock } = setup(
    Response.json(
      {
        code: 40900001,
        resultMsg: "修订冲突",
        requestId: "conflict-1",
        data: {
          committed: false,
          items: [
            {
              index: 0,
              change: "ERROR",
              apiId: null,
              revision: null,
              errors: ["草稿已修改"],
            },
          ],
        },
      },
      { status: 409 },
    ),
  );
  await openPreview();
  fireEvent.click(screen.getAllByRole("checkbox")[0]);
  fireEvent.click(screen.getByRole("button", { name: "确认写入草稿" }));
  expect(await screen.findByText(/草稿已修改/)).toBeTruthy();
  expect(screen.getByRole("alert").textContent).toContain("conflict-1");
  expect(screen.getByText(/选中集未写入/)).toBeTruthy();
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole("button", { name: "确认写入草稿" })).toBeNull();
});

test("超限文本与批次在提交前拒绝", async () => {
  const { fetchMock } = setup();
  fireEvent.change(screen.getByLabelText("接口配置 JSON"), {
    target: {
      value: JSON.stringify({ apis: Array.from({ length: 21 }, () => ({})) }),
    },
  });
  fireEvent.click(screen.getByRole("button", { name: "预览导入差异" }));
  expect((await screen.findByRole("alert")).textContent).toContain("1–20");
  fireEvent.change(screen.getByLabelText("接口配置 JSON"), {
    target: { value: `{"name":"${"中".repeat(100000)}"}` },
  });
  fireEvent.click(screen.getByRole("button", { name: "预览导入差异" }));
  expect((await screen.findByRole("alert")).textContent).toContain("256 KiB");
  expect(fetchMock).not.toHaveBeenCalled();
});

test("文件内容替换文本并废弃已选预览", async () => {
  setup();
  await openPreview();
  fireEvent.click(screen.getAllByRole("checkbox")[0]);
  const file = new File(["{}"], "contract.json", { type: "application/json" });
  Object.defineProperty(file, "text", { value: async () => "{}" });
  fireEvent.change(screen.getByLabelText("上传接口配置 JSON 文件"), {
    target: { files: [file] },
  });
  await waitFor(() =>
    expect(
      (screen.getByLabelText("接口配置 JSON") as HTMLTextAreaElement).value,
    ).toBe("{}"),
  );
  expect(screen.queryByText("orders/v1/query")).toBeNull();
});

test("网络结果未知锁定原提交，查询404后以原键原文重试", async () => {
  setup();
  await openPreview();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("disconnected");
    }),
  );
  fireEvent.click(screen.getAllByRole("checkbox")[0]);
  fireEvent.click(screen.getByRole("button", { name: "确认写入草稿" }));
  expect((await screen.findByRole("alert")).textContent).toContain(
    "未收到操作结果",
  );
  expect(screen.queryByText(/选中集未写入/)).toBeNull();
  expect(screen.getByRole("button", { name: "确认写入草稿" })).toHaveProperty("disabled",true);
  const retries = vi.fn(async (url: string) =>
    url.includes("/requests/")
      ? Response.json(
          { code: 40400001, message: "暂无成功回执" },
          { status: 404 },
        )
      : Response.json({
          code: 200,
          data: {
            committed: true,
            items: [
              {
                index: 0,
                change: "UPDATE",
                apiId: "api-1",
                revision: 3,
                errors: [],
              },
            ],
          },
        }),
  );
  vi.stubGlobal("fetch", retries);
  fireEvent.click(screen.getByRole("button", { name: "查询原提交结果" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "使用原标识和原内容重试" }),
  );
  await screen.findByText("选中集已写入草稿");
  const queryKey = retries.mock.calls[0][0].split("/").pop();
  const retryBody = JSON.parse(
    (retries.mock.calls[1] as unknown as [string, RequestInit])[1]
      .body as string,
  );
  expect(retryBody.submissionKey).toBe(queryKey);
});

test("提交前只持久化白名单恢复信息，刷新重进向导查询成功后保留结果入口", async () => {
  const { view } = setup();
  await openPreview();
  const write = vi.fn(async () => {
    const saved = JSON.parse(sessionStorage.getItem(sessionStorage.key(0)!)!);
    expect(Object.keys(saved).sort()).toEqual(["documentDigest", "key", "selections", "sourceDigest", "sourceKind"]);
    expect(saved.selections).toEqual([{ index: 0, expectedRevision: 2 }]);
    expect(JSON.stringify(saved)).not.toContain("amount");
    throw new Error("disconnected");
  });
  vi.stubGlobal("fetch", write);
  fireEvent.click(screen.getAllByRole("checkbox")[0]);
  fireEvent.click(screen.getByRole("button", { name: "确认写入草稿" }));
  await screen.findByText(/提交结果未知/);
  const metadata = JSON.parse(sessionStorage.getItem(sessionStorage.key(0)!)!);
  view.unmount();
  const onOpen = vi.fn();
  const query = vi.fn(async (_url: string) => Response.json({ code: 200, data: { committed: true,
    items: [{ index: 0, change: "UPDATE", apiId: "api-1", revision: 3, errors: [] }] } }));
  vi.stubGlobal("fetch", query);
  render(<AdminNavigationProvider><ApiOnboarding api={createAdminApi("csrf", vi.fn())} operatorKey="test-actor"
    onReturn={vi.fn()} onManual={vi.fn()}  onOpen={onOpen} /></AdminNavigationProvider>);
  expect(screen.queryByLabelText("来源文本")).toBeNull();
  expect(screen.queryByRole("button", { name: "改用其他新建方式" })).toBeNull();
  expect(screen.getByLabelText("接口配置 JSON")).toHaveProperty("value", "");
  fireEvent.click(screen.getByRole("button", { name: "查询原提交结果" }));
  await screen.findByText("选中集已写入草稿");
  expect(query.mock.calls[0][0]).toBe(`/admin-api/api-imports/requests/${metadata.key}`);
  expect(sessionStorage.length).toBe(0);
  fireEvent.click(screen.getByRole("button", { name: "打开 API 继续测试与发布" }));
  expect(onOpen).toHaveBeenCalledWith("api-1");
});

test.each([200, 409])("刷新后404需补回原完整配置，同key原修订重试返回%d后清除未决", async status => {
  const { view } = setup();
  await openPreview();
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("disconnected"); }));
  fireEvent.click(screen.getAllByRole("checkbox")[0]);
  fireEvent.click(screen.getByRole("button", { name: "确认写入草稿" }));
  await screen.findByText(/提交结果未知/);
  const metadata = JSON.parse(sessionStorage.getItem(sessionStorage.key(0)!)!);
  view.unmount();
  let matching = false;
  const restored = vi.fn(async (url: string, _options?: RequestInit) => {
    if (url.includes("/requests/")) return Response.json({ code: 40400001, resultMsg: "暂无回执" }, { status: 404 });
    if (url.endsWith("/preview")) return Response.json({ code: 200, data: { ...preview,
      documentDigest: matching ? metadata.documentDigest : "b".repeat(64),
      items: [{ ...preview.items[0], expectedRevision: 99 }] } });
    return status === 200 ? Response.json({ code: 200, data: { committed: true,
      items: [{ index: 0, change: "UPDATE", apiId: "api-1", revision: 3, errors: [] }] } })
      : Response.json({ code: 40900001, resultMsg: "原修订已变化，本批未写入" }, { status });
  });
  vi.stubGlobal("fetch", restored);
  render(<AdminNavigationProvider><ApiImport api={createAdminApi("csrf", vi.fn())} operatorKey="test-actor" onReturn={vi.fn()} /></AdminNavigationProvider>);
  fireEvent.click(screen.getByRole("button", { name: "查询原提交结果" }));
  const original = await screen.findByLabelText("原提交的完整平台配置 JSON");
  expect(screen.queryByRole("button", { name: "使用原标识和原内容重试" })).toBeNull();
  expect(screen.getByRole("button", { name: "返回 API 目录" })).toHaveProperty("disabled", true);
  fireEvent.change(original, { target: { value: source } });
  fireEvent.click(screen.getByRole("button", { name: "核对原配置摘要" }));
  await screen.findByText(/配置摘要与原提交不一致/);
  expect(screen.queryByRole("button", { name: "使用原标识和原内容重试" })).toBeNull();
  matching = true;
  fireEvent.click(screen.getByRole("button", { name: "核对原配置摘要" }));
  fireEvent.click(await screen.findByRole("button", { name: "使用原标识和原内容重试" }));
  if (status === 200) await screen.findByText("选中集已写入草稿");
  else {
    await screen.findByText(/原修订已变化，本批未写入/);
    expect(screen.getByLabelText("接口配置 JSON")).toHaveProperty("value", source);
    expect(screen.getByRole("button", { name: "预览导入差异" })).toHaveProperty("disabled", false);
  }
  const confirmations = restored.mock.calls.filter(([url]) => url.endsWith("/confirm"));
  expect(confirmations).toHaveLength(1);
  const body = JSON.parse(confirmations[0][1]!.body as string);
  expect(body).toMatchObject({ submissionKey: metadata.key, documentDigest: metadata.documentDigest,
    sourceKind: metadata.sourceKind, sourceDigest: metadata.sourceDigest, selections: [{ index: 0, expectedRevision: 2 }] });
  expect(String(confirmations[0][1]!.body)).toContain(`"document":${source}`);
  expect(sessionStorage.length).toBe(0);
});

test.each([401, 403])("权限%d不清除未决提交，其他账号不能恢复或重用它", async status => {
  const { view } = setup();
  await openPreview();
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ code: status * 100000 + 1, resultMsg: "请恢复原账号权限" }, { status })));
  fireEvent.click(screen.getAllByRole("checkbox")[0]);
  fireEvent.click(screen.getByRole("button", { name: "确认写入草稿" }));
  await screen.findByText(/提交结果未知/);
  expect(sessionStorage.length).toBe(1);
  const saved = sessionStorage.getItem(sessionStorage.key(0)!);
  fireEvent.click(screen.getByRole("button", { name: "查询原提交结果" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "查询原提交结果" })).toHaveProperty("disabled", false));
  expect(sessionStorage.getItem(sessionStorage.key(0)!)).toBe(saved);
  view.unmount();
  render(<AdminNavigationProvider><ApiOnboarding api={createAdminApi("csrf", vi.fn())} operatorKey="another-actor"
    onReturn={vi.fn()} onManual={vi.fn()}  onOpen={vi.fn()} /></AdminNavigationProvider>);
  expect(screen.getByLabelText("来源文本")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "查询原提交结果" })).toBeNull();
  expect(sessionStorage.getItem(sessionStorage.key(0)!)).toBe(saved);
});

test("无法保存恢复标记时不发送导入写请求", async () => {
  const { fetchMock } = setup();
  await openPreview();
  vi.spyOn(Object.getPrototypeOf(sessionStorage), "setItem").mockImplementation(() => { throw new DOMException("blocked"); });
  fireEvent.click(screen.getAllByRole("checkbox")[0]);
  fireEvent.click(screen.getByRole("button", { name: "确认写入草稿" }));
  await screen.findByText(/尚未发送写入请求/);
  expect(fetchMock.mock.calls.filter(([url]) => url.endsWith("/confirm"))).toHaveLength(0);
});

test("刷新后的畸形成功回执不清恢复信息或开放新提交", async () => {
  sessionStorage.setItem("szopen.api-import.pending:test-actor", JSON.stringify({ key: crypto.randomUUID(),
    documentDigest: "a".repeat(64), selections: [{ index: 0, expectedRevision: 2 }], sourceKind: "PLATFORM", sourceDigest: "a".repeat(64) }));
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ code: 200, data: { committed: true, items: [null] } })));
  render(<AdminNavigationProvider><ApiImport api={createAdminApi("csrf", vi.fn())} operatorKey="test-actor" onReturn={vi.fn()} /></AdminNavigationProvider>);
  fireEvent.click(screen.getByRole("button", { name: "查询原提交结果" }));
  await screen.findByText(/原提交结果格式不完整/);
  expect(sessionStorage.length).toBe(1);
  expect(screen.getByRole("button", { name: "返回 API 目录" })).toHaveProperty("disabled", true);
});

test('已补齐批次自动预览，只默认选择新增项，配置原文收进高级区', async () => {
  const data = { ...preview, items: [...preview.items, { ...preview.items[0], index: 3, change: 'CREATE', expectedRevision: 0, before: null, operation: { service: 'orders', version: 'v1', method: 'new_query' } }] };
  const calls = vi.fn(async () => Response.json({ code: 200, data }));
  vi.stubGlobal('fetch', calls);
  render(<AdminNavigationProvider><ApiImport api={createAdminApi('csrf', vi.fn())} onReturn={vi.fn()} initialDocument={source} preparedBatch returnLabel="返回候选列表" /></AdminNavigationProvider>);
  await screen.findByText('orders/v1/new_query');
  expect(calls).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText('第 1 项 · 更新')).toHaveProperty('checked', false);
  expect(screen.getByLabelText('第 4 项 · 新增')).toHaveProperty('checked', true);
  expect(screen.getByText('接口配置 JSON（高级）').closest('details')).toHaveProperty('open', false);
  expect(screen.getByRole('button', { name: '返回候选列表' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '确认写入草稿' })).toBeTruthy();
});
