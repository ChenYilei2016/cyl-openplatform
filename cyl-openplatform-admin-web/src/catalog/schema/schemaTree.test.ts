import { expect, test } from "vitest";
import type { SchemaNode } from "@cyl/open-platform-web-shared/documentation/types";
import {
  addField,
  affectedMappings,
  canAddChild,
  canBeContainer,
  containerKeys,
  indentField,
  moveField,
  nameError,
  outdentField,
  pathFromPointer,
  pathKey,
  removeField,
  renameField,
  shiftField,
  visibleRows,
} from "./schemaTree";

const order: SchemaNode = {
  type: "OBJECT",
  properties: {
    orderNo: { type: "STRING", required: true },
    buyer: { type: "OBJECT", properties: { name: { type: "STRING" } } },
    amount: { type: "NUMBER" },
    lines: { type: "ARRAY", items: { type: "OBJECT", properties: { sku: { type: "STRING" }, qty: { type: "INTEGER" } } } },
  },
};
const keysOf = (node: SchemaNode) => Object.keys(node.properties ?? {});

test("在指定字段后新增同级字段，名称自动不重复", () => {
  const first = addField(order, [], { after: "orderNo" });
  expect(first.path).toEqual(["field1"]);
  expect(keysOf(first.schema)).toEqual(["orderNo", "field1", "buyer", "amount", "lines"]);
  const second = addField(first.schema, [], { after: "field1", type: "ARRAY" });
  expect(second.path).toEqual(["field2"]);
  expect(second.schema.properties!.field2.items).toEqual({ type: "STRING" });
  const inItems = addField(order, ["lines", "[]"]);
  expect(keysOf(inItems.schema.properties!.lines.items!)).toEqual(["sku", "qty", "field1"]);
});

test("改名保持字段顺序，删除只移除该字段", () => {
  expect(keysOf(renameField(order, ["buyer"], "customer"))).toEqual(["orderNo", "customer", "amount", "lines"]);
  expect(keysOf(removeField(order, ["amount"]))).toEqual(["orderNo", "buyer", "lines"]);
  expect(() => removeField(order, ["lines", "[]"])).toThrow("数组元素");
});

test("同级上移下移、拖动到目标前后；到边界不动", () => {
  expect(keysOf(shiftField(order, ["amount"], -1)!)).toEqual(["orderNo", "amount", "buyer", "lines"]);
  expect(keysOf(shiftField(order, ["orderNo"], 1)!)).toEqual(["buyer", "orderNo", "amount", "lines"]);
  expect(shiftField(order, ["orderNo"], -1)).toBeNull();
  expect(shiftField(order, ["lines"], 1)).toBeNull();
  expect(keysOf(moveField(order, ["lines"], "orderNo"))).toEqual(["lines", "orderNo", "buyer", "amount"]);
  expect(keysOf(moveField(order, ["orderNo"], "amount", true))).toEqual(["buyer", "amount", "orderNo", "lines"]);
});

test("缩进为上方对象的子字段，提升到所属对象之后；数组元素对象提升到数组字段之后", () => {
  const indented = indentField(order, ["amount"]);
  expect(indented.path).toEqual(["buyer", "amount"]);
  expect(keysOf(indented.schema)).toEqual(["orderNo", "buyer", "lines"]);
  expect(keysOf(indented.schema.properties!.buyer)).toEqual(["name", "amount"]);
  expect(() => indentField(order, ["buyer"])).toThrow("上方需要一个对象字段");
  const outdented = outdentField(indented.schema, ["buyer", "amount"]);
  expect(outdented.path).toEqual(["amount"]);
  expect(keysOf(outdented.schema)).toEqual(["orderNo", "buyer", "amount", "lines"]);
  const fromItems = outdentField(order, ["lines", "[]", "qty"]);
  expect(keysOf(fromItems.schema)).toEqual(["orderNo", "buyer", "amount", "lines", "qty"]);
  expect(() => outdentField(order, ["orderNo"])).toThrow("最外层");
  const clash = { ...order, properties: { ...order.properties, buyer: { type: "OBJECT", properties: { amount: { type: "STRING" } } } } };
  expect(() => indentField(clash, ["amount"])).toThrow("已有字段 amount");
});

test("层数、节点与字段上限：数组需要多一层和一个元素节点", () => {
  let nested: SchemaNode = { type: "OBJECT", properties: {} };
  for (let index = 5; index >= 0; index--) nested = { type: "OBJECT", properties: { [`level${index}`]: nested } };
  const deepest = ["level0", "level1", "level2", "level3", "level4", "level5"];
  expect(canAddChild(nested, deepest)).toBe(true);
  const added = addField(nested, deepest).path;
  expect(canBeContainer(nested, added, "ARRAY")).toBe(false);
  expect(canBeContainer(nested, added, "STRING")).toBe(true);
  const object = addField(nested, deepest, { type: "OBJECT" });
  expect(canAddChild(object.schema, object.path)).toBe(false);
  const wide: SchemaNode = { type: "OBJECT", properties: Object.fromEntries(Array.from({ length: 50 }, (_, index) => [`f${index}`, { type: "STRING" }])) };
  expect(canAddChild(wide, [])).toBe(false);
  expect(() => addField(wide, [])).toThrow("50");
  const deepObject: SchemaNode = { type: "OBJECT", properties: { a: { type: "OBJECT", properties: {} }, b: nested } };
  expect(() => indentField(deepObject, ["b"])).toThrow("超过 8 层");
});

test("字段名规则：格式、同层重名、请求中的可信身份字段", () => {
  expect(nameError("1abc", [], false)).toContain("英文字母开头");
  expect(nameError("amount", ["amount"], false)).toContain("已有字段");
  expect(nameError("amount", ["amount"], false, "amount")).toBe("");
  expect(nameError("tenant_id", [], true)).toContain("可信身份");
  expect(nameError("tenant_id", [], false)).toBe("");
});

test("可见行按折叠状态展平；指针与路径互转；受影响映射含子字段", () => {
  expect(visibleRows(order, new Set()).map((row) => row.path.join("."))).toEqual([
    "orderNo",
    "buyer",
    "buyer.name",
    "amount",
    "lines",
    "lines.[]",
    "lines.[].sku",
    "lines.[].qty",
  ]);
  const collapsed = new Set([pathKey(["lines"])]);
  expect(visibleRows(order, collapsed).map((row) => row.path.join("."))).toEqual(["orderNo", "buyer", "buyer.name", "amount", "lines"]);
  expect(containerKeys(order)).toEqual([pathKey(["buyer"]), pathKey(["lines"]), pathKey(["lines", "[]"])]);
  expect(pathFromPointer("/requestSchema/properties/lines/items/properties/sku/example", true)).toEqual(["lines", "[]", "sku"]);
  expect(pathFromPointer("/responseSchema/properties/a", true)).toBeNull();
  const mappings = [
    { target: "a", source: "REQUEST" as const, path: "buyer.name" },
    { target: "b", source: "REQUEST" as const, path: "buyerX" },
    { target: "c", source: "CONTEXT" as const, path: "buyer" },
  ];
  expect(affectedMappings(mappings, ["buyer"]).map((item) => item.target)).toEqual(["a"]);
});
