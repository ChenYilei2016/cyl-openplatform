import { expect, test } from "vitest";
import { parseJson } from "@cyl/open-platform-web-shared/json";
import { contentOf, requestBody, sectionOf, stringify, type DraftContent } from "./draftModel";
import { idempotencyCandidates, mcpToolBlockers, mcpToolName } from "./mcpTool";
import { splitWholeJson } from "./wholeJson";

const definition = {
  id: "api1",
  service: "orders",
  version: "v1.2-beta",
  method: "submit",
  name: "提交订单",
  category: "订单",
  owner: "EMP_00000000000000000000000000000001",
  protocol: "HTTP",
  draftRevision: 1,
  description: "提交订单",
  scopeCodes: ["orders"],
  requestSchema: {
    type: "OBJECT",
    properties: {
      order: { type: "OBJECT", properties: { orderNo: { type: "STRING" }, paid: { type: "BOOLEAN" } } },
      count: { type: "INTEGER" },
      lines: { type: "ARRAY", items: { type: "OBJECT", properties: { sku: { type: "STRING" } } } },
    },
  },
  responseSchema: { type: "OBJECT", properties: {} },
  errorDefinitions: [],
  binding: { protocol: "HTTP", timeoutMillis: 3000, http: { url: "http://orders.internal/submit", method: "POST" } },
  mappings: [],
};
const enabled = (patch: Partial<DraftContent> = {}): DraftContent => {
  const base = contentOf(definition as never);
  return { ...base, mcpTool: { enabled: true, aiDescription: "" }, ...patch };
};
const paths = (content: DraftContent) => mcpToolBlockers(content).map((blocker) => blocker.path);

test("老定义读取为会修改数据、无幂等字段、未开放，保存正文明确携带三项", () => {
  const content = contentOf(definition as never);
  expect(content.operationKind).toBe("MUTATION");
  expect(content.idempotencyField).toBe("");
  expect(content.mcpTool).toEqual({ enabled: false, aiDescription: "" });
  const body = parseJson<Record<string, unknown>>(requestBody(content, null));
  expect(body).toMatchObject({ operationKind: "MUTATION", idempotencyField: "", mcpTool: { enabled: false, aiDescription: null } });
  expect(sectionOf("/idempotencyField")).toBe("request");
  expect(sectionOf("/mcpTool/aiDescription")).toBe("mcp");
  expect(sectionOf("/operationKind")).toBe("basic");
});

test("工具名按 service_method_版本 生成，版本 . 与 - 转为 _，超过 64 字符不可生成", () => {
  expect(mcpToolName("orders", "submit", "v1.2-beta")).toBe("orders_submit_v1_2_beta");
  expect(mcpToolName("s".repeat(30), "m".repeat(30), "v1")).toHaveLength(64);
  expect(mcpToolName("s".repeat(30), "m".repeat(30), "v12")).toBeNull();
});

test("幂等字段候选只含对象下钻可达的字符串与整数字段", () => {
  expect(idempotencyCandidates(definition.requestSchema as never)).toEqual(["order.orderNo", "count"]);
  expect(idempotencyCandidates(null)).toEqual([]);
});

test("启用条件逐项就地说明，满足后无阻碍", () => {
  expect(mcpToolBlockers(contentOf(definition as never))).toEqual([]);
  expect(paths(enabled())).toEqual(["/idempotencyField"]);
  expect(paths(enabled({ idempotencyField: "order.orderNo" }))).toEqual([]);
  expect(paths(enabled({ operationKind: "QUERY" }))).toEqual([]);
  const base = enabled({ operationKind: "QUERY" });
  expect(paths({ ...base, metadata: { ...base.metadata, description: " " } })).toEqual(["/mcpTool/aiDescription"]);
  expect(paths({ ...base, metadata: { ...base.metadata, description: "说".repeat(256) } })).toEqual(["/mcpTool/aiDescription"]);
  expect(paths({ ...base, metadata: { ...base.metadata, description: "说".repeat(256) }, mcpTool: { enabled: true, aiDescription: "用途" } })).toEqual([]);
  expect(paths({ ...base, mcpTool: { enabled: true, aiDescription: "用".repeat(256) } })).toEqual(["/mcpTool/aiDescription"]);
  expect(paths({ ...base, metadata: { ...base.metadata, service: "s".repeat(50) } })).toEqual(["/mcpTool/enabled"]);
  expect(paths({ ...base, sections: { ...base.sections, requestSchema: stringify({ type: "ARRAY", items: { type: "STRING" } }) } })).toEqual(["/mcpTool/enabled"]);
});

test("整份 JSON 写回三项配置", () => {
  const patch = splitWholeJson({ operationKind: "QUERY", idempotencyField: "count", mcpTool: { enabled: true, aiDescription: "按单查询" } }, contentOf(definition as never).metadata);
  expect(patch).toMatchObject({ operationKind: "QUERY", idempotencyField: "count", mcpTool: { enabled: true, aiDescription: "按单查询" } });
});
