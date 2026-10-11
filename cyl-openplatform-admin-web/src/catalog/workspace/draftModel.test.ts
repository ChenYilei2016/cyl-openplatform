import { expect, test } from "vitest";
import { adapterForm, responseAdapter } from "../ResponseAdapterEditor";
import { changedFields, contentOf, missingCandidateFields, placeholderDefinition, repositionMappings, requestBody, sectionDiffs, sectionOf, suggestions } from "./draftModel";
import { snapshotComparable } from "./compare";
import { splitWholeJson } from "./wholeJson";

const definition = {
  id: "api1",
  service: "orders",
  version: "v1",
  method: "query",
  name: "查询订单",
  category: "订单",
  owner: "EMP_00000000000000000000000000000001",
  protocol: "HTTP",
  draftRevision: 1,
  scopeCodes: ["orders"],
  requestSchema: { type: "OBJECT", properties: { orderNo: { type: "STRING", description: "订单号" } } },
  responseSchema: { type: "OBJECT", properties: {} },
  errorDefinitions: [],
  binding: { protocol: "HTTP", timeoutMillis: 3000, http: { url: "http://orders.internal/query", method: "POST" } },
  mappings: [{ target: "orderNo", source: "REQUEST", path: "orderNo" }],
};

test("服务端字段路径归入分区", () => {
  expect(sectionOf("/name")).toBe("basic");
  expect(sectionOf("/lifecycle/deprecationNotice")).toBe("basic");
  expect(sectionOf("/binding/http/url")).toBe("target");
  expect(sectionOf("/mappings/1/path")).toBe("target");
  expect(sectionOf("/requestSchema/properties/a")).toBe("request");
  expect(sectionOf("/responseAdapter/successPath")).toBe("response");
  expect(sectionOf("/errorDefinitions/0/code")).toBe("doc");
  expect(sectionOf("/description")).toBe("doc");
});

test("改动字段只比较内容，撤回后为空", () => {
  const base = contentOf(definition as never);
  expect(changedFields(base, base)).toEqual([]);
  const edited = { ...base, metadata: { ...base.metadata, name: "新" }, codes: [] };
  expect(changedFields(edited, base)).toEqual(["name", "scopeCodes"]);
});

test("建议完善不阻断，覆盖负责人、权限组、字段说明、响应与示例、接口说明", () => {
  const content = contentOf({ ...definition, scopeCodes: [] } as never);
  const messages = suggestions(content, false).map((item) => item.message).join("|");
  expect(messages).toContain("负责人只有名称");
  expect(messages).toContain("尚未选择调用权限组");
  expect(messages).toContain("响应结构还没有字段");
  expect(messages).toContain("还没有公开的响应示例");
  expect(messages).toContain("接口说明为空");
  expect(messages).not.toContain("请求字段");
});

test("按分区比较与生效版差异", () => {
  expect(sectionDiffs({ name: "a", binding: { x: 1 } }, { name: "a", binding: { x: 2 } })).toEqual(["target"]);
  expect(sectionDiffs({ name: "a" }, { name: "a" })).toEqual([]);
});

test("HTTP 方法变化时调整规范化映射；原文无效时不改写", () => {
  const previous = definition.binding as never;
  const get = JSON.stringify({ ...definition.binding, http: { ...definition.binding.http, method: "GET" } });
  const mappings = JSON.stringify([{ target: "a", source: "FIXED", value: 1 }], null, 2);
  expect(repositionMappings(get, previous, mappings, definition)).toContain('"location": "BODY"');
  expect(repositionMappings("{bad", previous, mappings, definition)).toBeUndefined();
  expect(repositionMappings(JSON.stringify(definition.binding), previous, mappings, definition)).toBeUndefined();
});

test("整份 JSON 拆分：锁定标识不可改，结构不完整的绑定整体拒绝", () => {
  const metadata = contentOf(definition as never).metadata;
  expect(() => splitWholeJson({ service: "other" }, metadata)).toThrow("service 已锁定");
  expect(() => splitWholeJson({ binding: { protocol: "HTTP" } }, metadata)).toThrow("binding 结构不完整");
  expect(() => splitWholeJson([], metadata)).toThrow("完整的 API 配置对象");
  const patch = splitWholeJson({ name: "新", description: "", mappings: [], responseAdapter: { mode: "DIRECT" }, scopeCodes: ["a", 1] }, metadata);
  expect(patch.metadata).toEqual({ name: "新", description: "" });
  expect(patch.sections).toEqual({ mappings: "[]" });
  expect(patch.codes).toEqual(["a"]);
  expect(patch.adapter).toEqual(adapterForm({ mode: "DIRECT" }));
});

test("尚未创建的草稿：整份 JSON 可改调用标识；请求正文省略 expectedRevision 并保留原始片段精度", () => {
  const content = contentOf(placeholderDefinition({ ...definition, id: undefined, draftRevision: undefined } as never));
  expect(splitWholeJson({ service: "other", method: "lookup" }, content.metadata, false).metadata).toEqual({ service: "other", method: "lookup" });
  const precise = { ...content, sections: { ...content.sections, responseSchema: '{"type":"NUMBER","example":0.123456789012345678901}' } };
  const body = requestBody(precise, null);
  expect(body).not.toContain("expectedRevision");
  expect(body).toContain('"example":0.123456789012345678901');
  expect(requestBody(content, 7)).toContain('"expectedRevision":7');
});

test("导入候选必填缺项：负责人须为人员引用，响应结构不能为空", () => {
  const metadata = { service: "orders", version: "1.0", method: "", name: "查询", category: "订单", owner: "张三", description: "" };
  expect(missingCandidateFields(metadata, "").map((issue) => issue.message)).toEqual(["请填写操作标识", "请填写负责人", "请补充真实响应结构"]);
  expect(missingCandidateFields({ ...metadata, method: "get", owner: definition.owner }, '{"type":"STRING"}')).toEqual([]);
  expect(placeholderDefinition({ binding: { protocol: "DUBBO", timeoutMillis: 3000, dubbo: { interfaceName: "", method: "", version: "", group: "", parameterTypes: [] } } })).toMatchObject({ id: "", draftRevision: 0, protocol: "DUBBO" });
});

test("发布快照中DIRECT的空外壳字段不产生虚假响应差异", () => {
  const snapshot = { ...definition, responseAdapter: { mode: "DIRECT" as const, successPath: null, successValues: [], dataPath: null, messagePath: null } };
  const saved = snapshotComparable(snapshot as never);
  const current = { ...saved, responseAdapter: responseAdapter(adapterForm(snapshot.responseAdapter)) };
  expect(sectionDiffs(current, saved)).toEqual([]);
  expect(sectionDiffs({ ...current, responseAdapter: { mode: "ENVELOPE" } }, saved)).toEqual(["response"]);
});
