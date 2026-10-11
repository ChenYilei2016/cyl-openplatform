import { expect, test } from "vitest";
import { appendMappings, proposeMappings } from "./defaultMappings";
import type { Binding } from "./BindingEditor";
import type { Mapping } from "./SchemaEditor";
const http: Binding = { protocol: "HTTP", timeoutMillis: 1000, http: { method: "POST", url: "https://provider.example/orders" } };
const schema = {
  type: "OBJECT",
  properties: {
    orderId: { type: "STRING" },
    items: { type: "ARRAY", items: { type: "STRING" } },
  },
};
const dubbo = (types: string[]): Binding => ({
  protocol: "DUBBO",
  timeoutMillis: 1000,
  dubbo: {
    interfaceName: "example.Service",
    method: "call",
    version: null,
    group: null,
    parameterTypes: types,
  },
});
test("HTTP对象数组整体传递，保留人工/身份/固定值，不覆盖祖先子路径，不突破条数", () => {
  const plan = proposeMappings(schema, {
    protocol: "HTTP",
    timeoutMillis: 1000,
  });
  expect(plan.mappings).toEqual([
    { target: "orderId", source: "REQUEST", path: "orderId", location: "BODY" },
    { target: "items", source: "REQUEST", path: "items", location: "BODY" },
  ]);
  const existing: Mapping[] = [
    { target: "orderId", source: "FIXED", value: "manual" },
    { target: "tenantId", source: "CONTEXT", path: "tenantId" },
  ];
  const merged = appendMappings(existing, plan.mappings, http);
  expect(merged.mappings.slice(0, 2)).toEqual(existing);
  expect(merged.added).toBe(1);
  expect(
    appendMappings(
      [{ target: "order.tenantId", source: "CONTEXT", path: "tenantId" }],
      [{ target: "order", source: "REQUEST", path: "order" }],
      http,
    ).added,
  ).toBe(0);
  expect(() =>
    appendMappings(
      Array.from({ length: 100 }, (_, i) => ({
        target: "f" + i,
        source: "FIXED" as const,
        value: 0,
      })),
      plan.mappings,
      http,
    ),
  ).toThrow("100");
});
test("Dubbo单标量唯一匹配自动补齐，单对象和多参数明确选择，不猜参数顺序", () => {
  expect(proposeMappings(schema, dubbo(["java.lang.String"])).mappings).toEqual(
    [{ target: "arg0", source: "REQUEST", path: "orderId" }],
  );
  expect(
    proposeMappings(schema, dubbo(["example.OrderRequest"])).pending,
  ).toEqual(["arg0"]);
  expect(
    proposeMappings(schema, dubbo(["example.OrderRequest"]), {
      arg0: "$",
    }).mappings.map((item) => item.target),
  ).toEqual(["arg0.orderId", "arg0.items"]);
  expect(
    proposeMappings(schema, dubbo(["java.lang.String", "java.util.List"]))
      .pending,
  ).toEqual(["arg0", "arg1"]);
  expect(
    proposeMappings(schema, dubbo(["java.lang.String", "java.util.List"]), {
      arg0: "orderId",
      arg1: "items",
    }).pending,
  ).toEqual([]);
});
