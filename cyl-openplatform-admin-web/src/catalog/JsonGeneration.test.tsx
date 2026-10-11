import { useState } from "react";
import { afterEach, expect, test, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  parseJson,
  stringifyJson,
} from "@cyl/open-platform-web-shared/json";
import type { AdminApi } from "../access/api";
import { adapterForm } from "./ResponseAdapterEditor";
import JsonSchemaButton from "./JsonSchemaButton";
import DefaultMappingButton from "./DefaultMappingButton";
import type { Mapping } from "./SchemaEditor";
afterEach(cleanup);
const api = vi.fn(async (_path: string, options: any) =>
  parseJson(options.bodyText),
) as unknown as AdminApi;
async function adopt() {
  const button = screen.getByRole("button", { name: "应用到草稿" });
  await waitFor(() => expect(button).toHaveProperty("disabled", false), {
    timeout: 3000,
  });
  fireEvent.click(button);
}

test("生成请求字段可同时补齐映射，采用及撤销为一个草稿操作，没有保存或发业务", async () => {
  const changed = vi.fn();
  function Harness() {
    const [schema, setSchema] = useState('{"type":"OBJECT","properties":{}}'),
      [maps, setMaps] = useState("[]");
    return (
      <JsonSchemaButton
        api={api}
        request
        schemaText={schema}
        mappingSource={{
          binding: { protocol: "HTTP", timeoutMillis: 1000 },
          bindingText: '{"protocol":"HTTP"}',
          mappingsText: maps,
        }}
        onApply={(value) => {
          changed(value);
          setSchema(value.schemaText);
          if (value.mappingsText !== undefined) setMaps(value.mappingsText);
        }}
      />
    );
  }
  render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "JSON 生成字段" }));
  fireEvent.change(screen.getByLabelText("生成字段的 JSON 样例"), {
    target: { value: '{"orderId":"A","count":9007199254740993}' },
  });
  await waitFor(
    () =>
      expect(
        screen.getByRole("checkbox", { name: "同时补齐默认映射" }),
      ).toHaveProperty("disabled", false),
    { timeout: 3000 },
  );
  fireEvent.click(screen.getByRole("checkbox", { name: "同时补齐默认映射" }));
  await adopt();
  await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
  expect(changed.mock.calls[0][0].schemaText).toContain("9007199254740993");
  expect(
    parseJson<Mapping[]>(changed.mock.calls[0][0].mappingsText).map(
      (item) => item.target,
    ),
  ).toEqual(["orderId", "count"]);
  fireEvent.click(screen.getByRole("button", { name: "撤销字段生成" }));
  expect(changed.mock.calls[1][0].mappingsText).toBe("[]");
});
test("响应按data生成且保留已声明业务约束，避免把旧外壳合并回来", async () => {
  const changed = vi.fn();
  render(
    <JsonSchemaButton
      api={api}
      schemaText='{"type":"OBJECT","properties":{"errCode":{"type":"STRING","required":true},"data":{"type":"OBJECT","properties":{"id":{"type":"STRING","required":true,"description":"业务主键"}}}}}'
      adapter={adapterForm({
        mode: "ENVELOPE",
        successPath: "errCode",
        successValues: ["0"],
        dataPath: "data",
      })}
      onApply={changed}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "JSON 生成字段" }));
  fireEvent.change(screen.getByLabelText("生成字段的 JSON 样例"), {
    target: { value: '{"errCode":"0","data":{"id":"A","active":true}}' },
  });
  await adopt();
  const schema = parseJson<any>(changed.mock.calls[0][0].schemaText);
  expect(Object.keys(schema.properties)).toEqual(["id", "active"]);
  expect(schema.properties.id).toMatchObject({
    required: true,
    description: "业务主键",
  });
  expect(changed.mock.calls[0][0].adapter).toBeUndefined();
});
test("严格原文校验失败或父配置已变化不能采用，取消保留原配置", async () => {
  const changed = vi.fn(),
    reject = vi.fn(async () => {
      throw new Error("重复字段 orderId");
    });
  const props = {
    api: reject as AdminApi,
    request: true,
    schemaText: '{"type":"OBJECT"}',
    onApply: changed,
  };
  const view = render(<JsonSchemaButton {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "JSON 生成字段" }));
  fireEvent.change(screen.getByLabelText("生成字段的 JSON 样例"), {
    target: { value: '{"orderId":"A","orderId":"B"}' },
  });
  expect(await screen.findByText("重复字段 orderId")).toBeTruthy();
  expect(screen.getByRole("button", { name: "应用到草稿" })).toHaveProperty(
    "disabled",
    true,
  );
  view.rerender(
    <JsonSchemaButton
      {...props}
      schemaText='{"type":"OBJECT","description":"另一处更新"}'
    />,
  );
  expect(screen.getByText(/原配置已变化/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /取\s*消/ }));
  expect(changed).not.toHaveBeenCalled();
});
test("默认映射一次补齐HTTP、保留固定值且可撤销", () => {
  const original: Mapping[] = [
    { target: "id", source: "FIXED", value: "fixed" },
  ];
  const change = vi.fn();
  function Harness() {
    const [maps, setMaps] = useState(original);
    return (
      <DefaultMappingButton
        schema={{
          type: "OBJECT",
          properties: { id: { type: "STRING" }, name: { type: "STRING" } },
        }}
        binding={{ protocol: "HTTP", timeoutMillis: 1000 }}
        mappings={maps}
        onChange={(value) => {
          change(value);
          setMaps(value);
        }}
      />
    );
  }
  render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "补齐默认映射" }));
  expect(change.mock.calls[0][0]).toEqual([
    ...original,
    { target: "name", source: "REQUEST", path: "name", location: "BODY" },
  ]);
  fireEvent.click(screen.getByRole("button", { name: "补齐默认映射" }));
  expect(change).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "撤销补齐" }));
  expect(change.mock.calls[1][0]).toEqual(original);
});

test("批量新字段必填可同时更新根示例，旧字段说明与非必填仍保留", async () => {
  const changed = vi.fn();
  render(
    <JsonSchemaButton
      api={api}
      request
      schemaText='{"type":"OBJECT","properties":{"kept":{"type":"STRING","required":false,"description":"原说明"}},"example":{"kept":"old"}}'
      onApply={changed}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "JSON 生成字段" }));
  fireEvent.change(screen.getByLabelText("生成字段的 JSON 样例"), {
    target: { value: '{"kept":"new","added":1}' },
  });
  fireEvent.click(screen.getByRole("checkbox", { name: "新字段设为必填" }));
  fireEvent.click(
    screen.getByRole("checkbox", { name: "同时更新文档中的请求示例" }),
  );
  await adopt();
  const schema = parseJson<any>(changed.mock.calls[0][0].schemaText);
  expect(schema.properties.kept).toMatchObject({
    required: false,
    description: "原说明",
  });
  expect(schema.properties.added.required).toBe(true);
  expect(schema.example).toEqual({ kept: "new", added: 1 });
});

test("从DIRECT选择data时同屏确认成功规则，数值errCode不误设为字符串", async () => {
  const changed = vi.fn();
  render(
    <JsonSchemaButton
      api={api}
      schemaText=""
      adapter={adapterForm()}
      onApply={changed}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "JSON 生成字段" }));
  fireEvent.change(screen.getByLabelText("生成字段的 JSON 样例"), {
    target: { value: '{"errCode":0,"data":{"id":"A"}}' },
  });
  await screen.findByText("errCode", { exact: false });
  fireEvent.mouseDown(screen.getByRole("combobox", { name: "用于生成字段的返回内容" }));
  fireEvent.click(
    await screen.findByText("只使用 data 里的内容", {
      selector: ".ant-select-item-option-content",
    }),
  );
  expect(screen.getByLabelText("生成时成功值")).toHaveProperty("value", "[0]");
  await adopt();
  expect(changed.mock.calls[0][0].adapter).toMatchObject({
    mode: "ENVELOPE",
    successPath: "errCode",
    successValues: "[0]",
    dataPath: "data",
  });
  expect(
    Object.keys(parseJson<any>(changed.mock.calls[0][0].schemaText).properties),
  ).toEqual(["id"]);
});

test("重建删字段会提前显示失效映射，明确处理后才采用且保留平台身份", async () => {
  const changed = vi.fn();
  render(
    <JsonSchemaButton
      api={api}
      request
      schemaText='{"type":"OBJECT","properties":{"old":{"type":"STRING"}}}'
      mappingSource={{
        binding: { protocol: "HTTP", timeoutMillis: 1000 },
        bindingText: '{"protocol":"HTTP"}',
        mappingsText:
          '[{"target":"old","source":"REQUEST","path":"old"},{"target":"tenantId","source":"CONTEXT","path":"tenantId"}]',
      }}
      onApply={changed}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "JSON 生成字段" }));
  fireEvent.click(screen.getByRole("radio", { name: "重新生成结构" }));
  fireEvent.change(screen.getByLabelText("生成字段的 JSON 样例"), {
    target: { value: '{"newField":"A"}' },
  });
  expect(await screen.findByText(/old ← old/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "应用到草稿" })).toHaveProperty(
    "disabled",
    true,
  );
  fireEvent.click(
    screen.getByRole("checkbox", { name: "同时移除这 1 条失效请求映射" }),
  );
  await adopt();
  await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
  expect(parseJson(changed.mock.calls[0][0].mappingsText)).toEqual([
    { target: "tenantId", source: "CONTEXT", path: "tenantId" },
  ]);
});

test("样例变化扩大失效映射范围时，旧移除确认失效", async () => {
  render(
    <JsonSchemaButton
      api={api}
      request
      schemaText='{"type":"OBJECT","properties":{"a":{"type":"STRING"},"b":{"type":"STRING"}}}'
      mappingSource={{
        binding: { protocol: "HTTP", timeoutMillis: 1000 },
        bindingText: '{"protocol":"HTTP"}',
        mappingsText:
          '[{"target":"a","source":"REQUEST","path":"a"},{"target":"b","source":"REQUEST","path":"b"}]',
      }}
      onApply={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "JSON 生成字段" }));
  fireEvent.click(screen.getByRole("radio", { name: "重新生成结构" }));
  fireEvent.change(screen.getByLabelText("生成字段的 JSON 样例"), {
    target: { value: '{"a":"A"}' },
  });
  fireEvent.click(
    await screen.findByRole("checkbox", {
      name: "同时移除这 1 条失效请求映射",
    }),
  );
  await waitFor(
    () =>
      expect(screen.getByRole("button", { name: "应用到草稿" })).toHaveProperty(
        "disabled",
        false,
      ),
    { timeout: 3000 },
  );
  fireEvent.change(screen.getByLabelText("生成字段的 JSON 样例"), {
    target: { value: '{"c":"C"}' },
  });
  expect(
    await screen.findByRole("checkbox", {
      name: "同时移除这 2 条失效请求映射",
    }),
  ).toHaveProperty("checked", false);
  expect(screen.getByRole("button", { name: "应用到草稿" })).toHaveProperty(
    "disabled",
    true,
  );
});

test('用内容类型区分完整返回与只贴业务内容，后者保持原返回规则',async()=>{
 const changed=vi.fn();
 const adapter=adapterForm({mode:'ENVELOPE',successPath:'errCode',successValues:['0'],dataPath:'data'});
 render(<JsonSchemaButton api={api} schemaText='' adapter={adapter} onApply={changed}/>);
 fireEvent.click(screen.getByRole('button',{name:'JSON 生成字段'}));
 expect(screen.getByRole('radio',{name:'提供方的完整返回'})).toHaveProperty('checked',true);
 fireEvent.click(screen.getByRole('radio',{name:'只贴了业务内容'}));
 expect(screen.queryByRole('combobox',{name:'用于生成字段的返回内容'})).toBeNull();
 fireEvent.change(screen.getByLabelText('生成字段的 JSON 样例'),{target:{value:'{"orderNo":"A001"}'}});
 await adopt();
 expect(changed.mock.calls[0][0].adapter).toBeUndefined();
 expect(Object.keys(parseJson<any>(changed.mock.calls[0][0].schemaText).properties)).toEqual(['orderNo']);
});
