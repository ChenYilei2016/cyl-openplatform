import { expect, test } from "vitest";
import {
  parseJson,
  stringifyJson,
} from "@cyl/open-platform-web-shared/json";
import { inferSampleSchema, mergeSampleSchema, sampleAt } from "./sampleSchema";

test("对象数组合并形状，保留精确数值与业务示例，不猜必填", () => {
  const source = parseJson(
    '{"amount":0.123456789012345678901,"count":9007199254740993,"items":[{"sku":"A","price":null},{"sku":"B","price":1.5,"stock":1}]}',
  );
  const value = inferSampleSchema(source, true);
  expect(value.questions).toEqual([]);
  expect(value.schema.properties?.amount.type).toBe("NUMBER");
  expect(value.schema.properties?.count.type).toBe("INTEGER");
  expect(value.schema.properties?.items.items?.properties?.price).toMatchObject(
    { type: "NUMBER", nullable: true, required: false },
  );
  expect(
    Object.keys(value.schema.properties?.items.items?.properties ?? {}),
  ).toEqual(["sku", "price", "stock"]);
  expect(stringifyJson(value.schema.example)).toContain("9007199254740993");
  expect(stringifyJson(value.schema.example)).toContain(
    "0.123456789012345678901",
  );
});
test("null与空数组原位选类型，可沿用既有类型，不把未知值默认为字符串", () => {
  const sample = { name: null, items: [] };
  expect(
    inferSampleSchema(sample, true).questions.map((item) => item.path),
  ).toEqual(["$.name", "$.items[]"]);
  const result = inferSampleSchema(sample, true, {
    "$.name": "STRING",
    "$.items[]": "OBJECT",
  });
  expect(result.questions).toEqual([]);
  expect(result.schema.properties?.name.nullable).toBe(true);
  expect(inferSampleSchema(sample, true, {}, result.schema).questions).toEqual(
    [],
  );
});
test("补齐保留人工约束与原示例，类型冲突必须明确决定", () => {
  const old = {
    type: "OBJECT",
    description: "已维护",
    properties: {
      name: {
        type: "STRING",
        required: true,
        nullable: false,
        enumValues: ["A"],
        description: "姓名",
        defaultValue: "A",
      },
    },
    example: { name: "A" },
  };
  const next = inferSampleSchema({ name: 12, newField: true }, true).schema;
  const merged = mergeSampleSchema(old, next);
  expect(merged.conflicts.map((item) => item.path)).toEqual(["$.name"]);
  expect(
    mergeSampleSchema(old, next, { "$.name": "existing" }).schema.properties
      ?.name,
  ).toEqual(old.properties.name);
  expect(
    mergeSampleSchema(old, next, { "$.name": "sample" }).schema.properties?.name
      .type,
  ).toBe("INTEGER");
  expect(merged.schema.example).toEqual({ name: "A" });
  expect(merged.schema.properties?.newField.type).toBe("BOOLEAN");
});
test("请求身份字段移出公开输入和示例，响应允许业务身份，字段规模提前阻断", () => {
  const input = { tenantId: "101", order: { employee_id: "p", id: "A" } };
  const result = inferSampleSchema(input, true);
  expect(result.excluded).toEqual(["$.tenantId", "$.order.employee_id"]);
  expect(result.schema.example).toEqual({ order: { id: "A" } });
  expect(inferSampleSchema(input, false).schema.properties?.tenantId.type).toBe(
    "STRING",
  );
  expect(() => inferSampleSchema([1], true)).toThrow("JSON 对象");
  expect(() => inferSampleSchema({ items: [1, "two"] }, true)).toThrow(
    "类型不一致",
  );
  expect(() =>
    inferSampleSchema(
      Object.fromEntries(Array.from({ length: 51 }, (_, i) => ["f" + i, i])),
      true,
    ),
  ).toThrow("50");
  expect(() => sampleAt({ data: {} }, "result.data")).toThrow("没有");
  expect(sampleAt({ data: { id: "A" } }, "data")).toEqual({ id: "A" });
});

test("采用类型仍保留人工说明和必填，只清理不兼容取值，并处理父级旧示例", async () => {
  const { reconcileSchemaValues } = await import("./sampleSchema");
  const old = {
    type: "OBJECT",
    properties: {
      name: {
        type: "STRING",
        required: true,
        nullable: false,
        description: "保留说明",
        enumValues: ["A"],
        defaultValue: "A",
      },
    },
    example: { name: "A" },
  };
  const next = inferSampleSchema({ name: 12 }, true).schema;
  const result = reconcileSchemaValues(
    mergeSampleSchema(old, next, { "$.name": "sample" }).schema,
  );
  expect(result.schema.properties?.name).toMatchObject({
    type: "INTEGER",
    required: true,
    nullable: false,
    description: "保留说明",
    enumValues: [],
    defaultValue: null,
  });
  expect(result.schema.example).toBeNull();
  expect(result.adjustments).toContain("$.name 的旧默认值");
  expect(result.adjustments).toContain("$ 的旧示例");
  const compatible = reconcileSchemaValues(
    mergeSampleSchema(
      {
        type: "INTEGER",
        required: true,
        enumValues: [1],
        defaultValue: 1,
        example: 1,
      },
      { type: "NUMBER" },
      { $: "sample" },
    ).schema,
  );
  expect(compatible.schema).toMatchObject({
    type: "NUMBER",
    enumValues: [1],
    defaultValue: 1,
    example: 1,
    required: true,
  });
  expect(compatible.adjustments).toEqual([]);
});

test("合法同名字段不能读取JavaScript继承属性作为旧字段定义", () => {
  const generated = inferSampleSchema(
    { constructor: "业务字段", toString: "字段值" },
    true,
  ).schema;
  const merged = mergeSampleSchema(
    { type: "OBJECT", properties: {} },
    generated,
  );
  expect(merged.conflicts).toEqual([]);
  expect(merged.schema.properties?.constructor).toMatchObject({
    type: "STRING",
  });
});

test("批量必填只影响新字段，数组元素节点与既有约束不被改写", () => {
  const original = {
    type: "OBJECT",
    properties: { kept: { type: "STRING", required: false } },
  };
  const generated = inferSampleSchema(
    { kept: "A", added: 1, items: [{ sku: "S" }] },
    true,
    {},
    original,
    true,
  ).schema;
  const result = mergeSampleSchema(original, generated).schema;
  expect(result.properties?.kept.required).toBe(false);
  expect(result.properties?.added.required).toBe(true);
  expect(result.properties?.items.required).toBe(true);
  expect(result.properties?.items.items?.required).toBe(false);
  expect(result.properties?.items.items?.properties?.sku.required).toBe(true);
});

test('0.00和科学计数样例保留数值意图，不推断成仅允许整数',()=>{
 const result=inferSampleSchema(parseJson('{"amount":0.00,"ratio":1.0,"scale":1e3}'),true);
 expect(Object.values(result.schema.properties??{}).map(node=>node.type)).toEqual(['NUMBER','NUMBER','NUMBER']);
 expect(stringifyJson(result.schema.example)).toContain('0.00');
});
