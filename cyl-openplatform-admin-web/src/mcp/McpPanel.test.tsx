import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { PlatformTheme } from "@cyl/open-platform-web-shared/ui/PlatformTheme";
import type { AdminApi } from "../access/api";
import { AdminNavigationProvider } from "../navigation/AdminNavigation";
import McpPanel from "./McpPanel";

afterEach(() => { cleanup(); history.replaceState(null, "", "/"); });

test("保存工具集后切回工具页立即显示新的成员关系", async () => {
  history.replaceState(null, "", "/#/mcp");
  let name = "旧工具集名称";
  const api = vi.fn(async (path: string, options?: { method?: string; body?: unknown }) => {
    if (path === "/mcp/gateway-credential") return { signingConfigured: false, credential: null };
    if (path.startsWith("/mcp/tools")) return { items: [{ apiId: "api1", name: "orders_query_v1", title: "查询订单", description: "查询订单状态", operationKind: "QUERY", scopeCodes: ["orders"], toolSets: [{ code: "orders", name, enabled: true, total: 1 }] }], nextCursor: null };
    const toolSet = { id: "set1", code: "orders", name, description: "", enabled: true, revision: 0 };
    if (path.startsWith("/mcp/tool-sets?")) return { items: [toolSet], total: 1, page: 1, pageSize: 20 };
    if (path === "/mcp/tool-sets/set1") {
      if (options?.method === "PUT") name = (options.body as { name: string }).name;
      return { toolSet: { ...toolSet, name }, apiIds: ["api1"], apiNames: { api1: "查询订单" } };
    }
    if (path.startsWith("/mcp/tenant-activations")) return { items: [], total: 0, page: 1, pageSize: 20 };
    throw new Error(`未提供测试响应：${path}`);
  }) as AdminApi;
  render(<PlatformTheme><AdminNavigationProvider><McpPanel api={api} /></AdminNavigationProvider></PlatformTheme>);
  fireEvent.click(screen.getByRole("tab", { name: /^工具$/ }));
  await screen.findByText("旧工具集名称");
  fireEvent.click(screen.getByRole("tab", { name: /^工具集$/ }));
  fireEvent.click(await screen.findByRole("button", { name: "旧工具集名称" }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.change(within(dialog).getByLabelText("名称"), { target: { value: "新工具集名称" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "保存工具集" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  fireEvent.click(screen.getByRole("tab", { name: /^工具$/ }));
  await waitFor(() => expect(within(screen.getByRole("region", { name: "已发布的MCP工具" })).getByText("新工具集名称")).toBeTruthy());
  expect(within(screen.getByRole("region", { name: "已发布的MCP工具" })).queryByText("旧工具集名称")).toBeNull();
});
