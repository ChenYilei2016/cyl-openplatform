import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { AdminApi } from "../access/api";
import { curlCommand } from "./curl";
import DraftDebug from "./DraftDebug";
import { forgetIdentity, rememberedIdentity } from "./identity";
import { readSamples } from "./samples";
import type { DebugDefinition, DebugResult } from "./types";

const capture = (value: unknown) => ({ available: true, redacted: false, truncated: false, value });
const result = (patch: Partial<DebugResult> = {}): DebugResult => ({
  requestId: "req-1",
  draftRevision: 1,
  durationMillis: 12,
  outcome: "SUCCEEDED",
  providerDispatch: "SENT",
  checks: [],
  mappedInput: capture({ orderNo: "A1" }),
  providerResponse: capture({ code: 0, data: { orderNo: "A1" } }),
  adaptedData: capture({ orderNo: "A1" }),
  publicResponse: capture({ code: 200, data: { orderNo: "A1" } }),
  identity: { applicationId: "app1", appKey: "k", tenantId: "t1", expiresAt: null },
  ...patch,
});
const definition = (patch: Partial<DebugDefinition> = {}): DebugDefinition => ({
  id: "api-1",
  draftRevision: 1,
  name: "订单",
  service: "orders",
  version: "v1",
  method: "query",
  scopeCodes: ["orders"],
  requestSchema: { type: "OBJECT", properties: { orderNo: { type: "STRING", required: true } } },
  ...patch,
});
const candidates = {
  items: [
    { tenantGrantId: "tg1", applicationId: "app1", applicationName: "订单联调凭据", appKeyTail: "9f3a", tenantId: "t1", tenantName: "示例租户", note: "测试" },
    { tenantGrantId: "tg2", applicationId: "app2", applicationName: "看板", appKeyTail: "71c2", tenantId: "t2", tenantName: null, note: null },
  ],
  total: 2,
};
const employees = { items: [{ userGrantId: "ug1", employeeNo: "E1001", displayName: "示例人员" }], total: 1 };
type Call = [string, { method?: string; bodyText?: string; bearerToken?: string } | undefined];
function client(run: (path: string) => unknown = () => result()) {
  const calls: Call[] = [];
  const api = (async (path: string, options?: Call[1]) => {
    calls.push([path, options]);
    if (path.includes("/employees")) return employees;
    if (path.includes("/debug/identities")) return candidates;
    return run(path);
  }) as unknown as AdminApi;
  return { api, calls };
}
beforeEach(() => {
  forgetIdentity();
  localStorage.clear();
});
afterEach(cleanup);

async function pick(label: string, option: string) {
  fireEvent.mouseDown(screen.getByRole("combobox", { name: label }));
  fireEvent.click(await screen.findByText(option, {}, { timeout: 2000 }));
}
const fillOrder = () => {
  fireEvent.click(screen.getByRole("button", { name: "JSON" }));
  fireEvent.change(screen.getByLabelText("调试请求 JSON"), { target: { value: '{"orderNo":"A1"}' } });
};

test("默认选凭据调试：请求体携带所选授权、不带业务 Token；选择在切换 API 后沿用", async () => {
  const { api, calls } = client();
  const view = render(<DraftDebug api={api} definition={definition()} />);
  expect(screen.getByRole("button", { name: "执行调试" }).matches(":disabled")).toBe(true);
  expect(screen.getByText("先选择调用身份。")).toBeTruthy();
  await pick("调用凭据", "订单联调凭据");
  expect(calls.find(([path]) => path.includes("/debug/identities"))![0]).toBe("/apis/api-1/debug/identities?page=1&pageSize=20");
  fillOrder();
  fireEvent.click(screen.getByRole("button", { name: "执行调试" }));
  await screen.findByText("调用成功");
  const [path, options] = calls.find(([url]) => url === "/apis/api-1/debug")!;
  expect(path).toBe("/apis/api-1/debug");
  expect(options?.bearerToken).toBeUndefined();
  expect(JSON.parse(options!.bodyText!)).toEqual({ expectedRevision: 1, input: { orderNo: "A1" }, identity: { tenantGrantId: "tg1" } });
  expect(rememberedIdentity().choice?.candidate.tenantGrantId).toBe("tg1");
  view.unmount();
  render(<DraftDebug api={api} definition={definition({ id: "api-2" })} />);
  expect(screen.getByText("订单联调凭据 · 示例租户 · AK …9f3a")).toBeTruthy();
  expect(screen.queryByText("先选择调用身份。")).toBeNull();
});

test("要求指定员工时，未选人员不能调试；选择后请求体带人员授权", async () => {
  const { api, calls } = client();
  render(<DraftDebug api={api} definition={definition({ employeeRequired: true })} />);
  await pick("调用凭据", "订单联调凭据");
  fillOrder();
  expect(screen.getByText("此API要求指定调用员工，请在调用身份中选择人员。")).toBeTruthy();
  expect(screen.getByRole("button", { name: "执行调试" }).matches(":disabled")).toBe(true);
  await pick("调用员工", "示例人员（E1001）");
  expect(calls.some(([path]) => path === "/apis/api-1/debug/identities/tg1/employees?page=1&pageSize=20")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "检查准备情况" }));
  await screen.findByText("预检通过 · 尚未执行业务");
  const [, options] = calls.find(([url]) => url === "/apis/api-1/debug/preflight")!;
  expect(JSON.parse(options!.bodyText!).identity).toEqual({ tenantGrantId: "tg1", userGrantId: "ug1" });
});

test.each([
  ["业务失败", result({ outcome: "FAILED", checks: [{ stage: "BUSINESS", status: "FAILED", summary: "提供方拒绝", issues: [] }], providerMessage: { value: "订单不存在", truncated: false } }), "提供方消息：订单不存在"],
  ["调用失败", result({ outcome: "FAILED", checks: [{ stage: "PROVIDER_CALL", status: "FAILED", summary: "连接被拒绝", issues: [] }] }), "提供方调用：连接被拒绝"],
  ["结果未知", result({ outcome: "UNKNOWN", providerDispatch: "UNKNOWN" }), "提供方是否执行无法确认"],
])("结果先给结论：%s", async (title, value, reason) => {
  const { api } = client(() => value);
  render(<DraftDebug api={api} definition={definition()} />);
  await pick("调用凭据", "订单联调凭据");
  fillOrder();
  fireEvent.click(screen.getByRole("button", { name: "执行调试" }));
  const verdict = (await screen.findByText(title)).closest(".op-debug-verdict") as HTMLElement;
  expect(verdict.textContent).toContain(reason);
  expect(verdict.textContent).toContain("12 ms");
});

test("高级 Token 方式仍走 Authorization 头，且请求体不带调用身份", async () => {
  const { api, calls } = client();
  render(<DraftDebug api={api} definition={definition()} />);
  fireEvent.click(screen.getByRole("button", { name: "高级：使用业务 Token" }));
  fireEvent.change(screen.getByLabelText("业务访问 Token"), { target: { value: "private-token" } });
  fillOrder();
  fireEvent.click(screen.getByRole("button", { name: "执行调试" }));
  await screen.findByText("调用成功");
  const [, options] = calls.find(([url]) => url === "/apis/api-1/debug")!;
  expect(options?.bearerToken).toBe("private-token");
  expect(JSON.parse(options!.bodyText!).identity).toBeUndefined();
  expect(rememberedIdentity().mode).toBe("token");
});

test("复制 cURL 使用网关地址、Token 占位符，并保持原始数字精度", async () => {
  const writeText = vi.fn(async (_text: string) => {});
  Object.assign(navigator, { clipboard: { writeText } });
  const { api } = client();
  render(<DraftDebug api={api} definition={definition()} />);
  fireEvent.click(screen.getByRole("button", { name: "JSON" }));
  fireEvent.change(screen.getByLabelText("调试请求 JSON"), { target: { value: '{"orderNo":"it\'s","amount":9007199254740993}' } });
  fireEvent.click(screen.getByRole("button", { name: /复制 cURL/ }));
  const command = writeText.mock.calls[0][0] as string;
  expect(command).toContain(`'${window.location.origin}/api/oauth/orders/v1/query'`);
  expect(command).toContain("Authorization: Bearer <业务 Token>");
  expect(command).toContain(`--data-raw '{"orderNo":"it'\\''s","amount":9007199254740993}'`);
  expect(curlCommand("https://x", {}, "{bad")).toContain("--data-raw '{bad'");
});

test("常用参数存为样例（移除秘密字段）、套用与删除，只存在当前浏览器", async () => {
  const { api } = client();
  render(<DraftDebug api={api} definition={definition()} />);
  fireEvent.click(screen.getByRole("button", { name: "JSON" }));
  fireEvent.change(screen.getByLabelText("调试请求 JSON"), { target: { value: '{"orderNo":"A9","accessToken":"never-store"}' } });
  fireEvent.click(screen.getByRole("button", { name: "样例" }));
  fireEvent.click(await screen.findByText("把当前参数存为样例…"));
  fireEvent.change(await screen.findByLabelText("样例名称"), { target: { value: "正常订单" } });
  fireEvent.click(screen.getByRole("button", { name: "保存样例" }));
  await waitFor(() => expect(readSamples("api-1").map((item) => item.name)).toEqual(["正常订单"]));
  expect(readSamples("api-1")[0].input).not.toContain("never-store");
  fireEvent.change(screen.getByLabelText("调试请求 JSON"), { target: { value: "{}" } });
  fireEvent.click(screen.getByRole("button", { name: "样例（1）" }));
  fireEvent.click(await screen.findByText("正常订单"));
  expect((screen.getByLabelText("调试请求 JSON") as HTMLTextAreaElement).value).toContain('"A9"');
  fireEvent.click(screen.getByRole("button", { name: "样例（1）" }));
  await act(async () => fireEvent.click(await screen.findByRole("button", { name: "删除样例 正常订单" })));
  expect(readSamples("api-1")).toEqual([]);
  expect(within(document.body).queryByText("never-store")).toBeNull();
});
