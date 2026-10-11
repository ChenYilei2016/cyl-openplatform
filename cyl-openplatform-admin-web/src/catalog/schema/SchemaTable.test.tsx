import { useState } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { SchemaNode } from "@cyl/open-platform-web-shared/documentation/types";
import { parseJson, stringifyJson } from "@cyl/open-platform-web-shared/json";
import { createAdminApi } from "../../access/api";
import SchemaEditor, { type Mapping } from "../SchemaEditor";

const okRaw = (text: string) => new Response(`{"code":200,"data":${text}}`, { headers: { "Content-Type": "application/json" } });
const bad = (message: string) => Response.json({ code: 40000001, resultMsg: message }, { status: 400 });
const echo = vi.fn(async (_url: string, init?: RequestInit) => okRaw(String(init?.body)));
const schema: SchemaNode = {
  type: "OBJECT",
  properties: {
    orderId: { type: "STRING", required: true, example: "private-order" },
    count: { type: "INTEGER", required: false },
  },
};
beforeEach(() => vi.stubGlobal("fetch", echo));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  echo.mockClear();
});
const mappingsDefault: Mapping[] = [{ source: "REQUEST", target: "arg0", path: "orderId" }];
function Harness({ initial = stringifyJson(schema), mappings = mappingsDefault }: { initial?: string; mappings?: Mapping[] }) {
  const [text, setText] = useState(initial);
  return (
    <>
      <SchemaEditor api={createAdminApi("csrf", vi.fn())} title="请求结构" request text={text} onChange={setText} mappings={mappings} />
      <output data-testid="text">{text}</output>
    </>
  );
}
const current = () => parseJson<SchemaNode>(screen.getByTestId("text").textContent!);
const keys = (path: string[] = []) => {
  let node = current();
  for (const part of path) node = part === "[]" ? node.items! : node.properties![part];
  return Object.keys(node.properties ?? {});
};
const nameInput = (path: string) => screen.getByLabelText(`请求结构字段 ${path} 名称`) as HTMLInputElement;
const rowOf = (path: string) => nameInput(path).closest("tr")!;
const openValues = (path: string) => fireEvent.click(within(rowOf(path)).getByRole("button", { name: `${path} 值设置` }));
const dialog = () => screen.getByRole("dialog");
const pickType = async (label: string, type: string) => {
  fireEvent.mouseDown(screen.getByLabelText(label));
  const options = await screen.findAllByTitle(type);
  fireEvent.click(options.find((item) => item.closest(".ant-select-item-option"))!);
};

test("高级JSON严格校验失败保留原文，成功切回字段表保持大整数、小数、false及空字符串", async () => {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    const text = String(init?.body);
    if (text.includes("duplicate")) return bad("重复键或尾随文本");
    return okRaw(text);
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "高级 JSON" }));
  const input = screen.getByLabelText("请求结构 JSON");
  const raw = '{"type":"OBJECT","duplicate":1,"duplicate":2}';
  fireEvent.change(input, { target: { value: raw } });
  fireEvent.click(screen.getByRole("button", { name: "校验并切回字段表" }));
  expect((await screen.findByRole("alert")).textContent).toContain("重复键");
  expect((input as HTMLTextAreaElement).value).toBe(raw);
  const precise =
    '{"type":"OBJECT","properties":{"sequence":{"type":"INTEGER","example":9007199254740993},"amount":{"type":"NUMBER","defaultValue":0.1234567890123456789},"enabled":{"type":"BOOLEAN","defaultValue":false},"label":{"type":"STRING","example":""}}}';
  fireEvent.change(input, { target: { value: precise } });
  fireEvent.click(screen.getByRole("button", { name: "校验并切回字段表" }));
  await screen.findByLabelText("请求结构字段 sequence 名称");
  const restored = screen.getByTestId("text").textContent!;
  for (const fragment of ["9007199254740993", "0.1234567890123456789", "false", '"example": ""']) expect(restored).toContain(fragment);
  expect(fetchMock.mock.calls[0][1]?.body).toBe(raw);
});

test("行内改名：引用字段先列出受影响映射，取消还原输入；确认后保持顺序", async () => {
  render(<Harness />);
  fireEvent.change(nameInput("orderId"), { target: { value: "orderNo" } });
  fireEvent.blur(nameInput("orderId"));
  await waitFor(() => expect(dialog().textContent).toContain("arg0 ← orderId"));
  fireEvent.click(within(dialog()).getByRole("button", { name: /取\s*消/ }));
  await waitFor(() => expect(nameInput("orderId").value).toBe("orderId"));
  expect(keys()).toEqual(["orderId", "count"]);
  fireEvent.change(nameInput("orderId"), { target: { value: "orderNo" } });
  fireEvent.keyDown(nameInput("orderId"), { key: "Enter" });
  await screen.findByRole("dialog");
  fireEvent.click(within(dialog()).getByRole("button", { name: "确认变化" }));
  await waitFor(() => expect(keys()).toEqual(["orderNo", "count"]));
});

test("不合法或重名的字段名就地提示且不提交，Esc 还原", async () => {
  render(<Harness />);
  fireEvent.change(nameInput("count"), { target: { value: "orderId" } });
  fireEvent.blur(nameInput("count"));
  expect((await screen.findByRole("alert")).textContent).toContain("同一层已有字段 orderId");
  expect(nameInput("count").getAttribute("aria-invalid")).toBe("true");
  fireEvent.change(nameInput("count"), { target: { value: "tenantId" } });
  fireEvent.keyDown(nameInput("count"), { key: "Enter" });
  expect((await screen.findByRole("alert")).textContent).toContain("可信身份");
  expect(keys()).toEqual(["orderId", "count"]);
  fireEvent.keyDown(nameInput("count"), { key: "Escape" });
  expect(nameInput("count").value).toBe("count");
  expect(screen.queryByRole("alert")).toBeNull();
});

test("类型切换保留值并在字段旁标红，不静默清空原示例", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => bad("示例与JSON类型不符")));
  render(<Harness />);
  await pickType("请求结构orderId类型", "INTEGER");
  await waitFor(() => expect(dialog().textContent).toContain("arg0 ← orderId"));
  fireEvent.click(within(dialog()).getByRole("button", { name: "确认变化" }));
  expect((await screen.findByRole("alert")).textContent).toContain("示例与JSON类型不符");
  expect(screen.getByLabelText("请求结构orderId类型").getAttribute("aria-invalid")).toBe("true");
  expect(screen.getByTestId("text").textContent).toContain("private-order");
});

test("有子字段的类型切换先确认，并列出受影响映射", async () => {
  render(<Harness initial={stringifyJson({ type: "OBJECT", properties: { buyer: { type: "OBJECT", properties: { name: { type: "STRING" } } } } })} mappings={[{ source: "REQUEST", target: "arg0", path: "buyer.name" }]} />);
  await pickType("请求结构buyer类型", "STRING");
  await waitFor(() => expect(dialog().textContent).toContain("arg0 ← buyer.name"));
  fireEvent.click(within(dialog()).getByRole("button", { name: /取\s*消/ }));
  expect(current().properties!.buyer.type).toBe("OBJECT");
});

test("单个默认值先作为独立原文校验，不能拼接注入Schema字段", async () => {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    try {
      parseJson(String(init?.body));
      return okRaw(String(init?.body));
    } catch {
      return bad("不是单独合法JSON");
    }
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<Harness />);
  openValues("count");
  fireEvent.change(screen.getByLabelText("默认值"), { target: { value: '1,"required":true' } });
  fireEvent.click(screen.getByRole("button", { name: "校验并应用" }));
  expect((await screen.findByRole("alert")).textContent).toContain("不是单独合法JSON");
  expect(fetchMock.mock.calls[0][0]).toBe("/admin-api/apis/validate-json");
  expect(fetchMock.mock.calls[0][1]?.body).toBe('1,"required":true');
  expect(fetchMock.mock.calls.some(([url]) => url.includes("kind=schema"))).toBe(false);
  expect((screen.getByLabelText("默认值") as HTMLTextAreaElement).value).toBe('1,"required":true');
});

test("值设置在字段下方展开，允许 null 立即生效，应用后摘要显示在说明下", async () => {
  render(<Harness />);
  openValues("count");
  const region = screen.getByRole("region", { name: "count · 值设置" });
  for (const label of ["默认值", "枚举", "示例"]) expect(region.contains(screen.getByLabelText(label))).toBe(true);
  expect(within(rowOf("count")).getByRole("button", { name: "count 值设置" }).getAttribute("aria-expanded")).toBe("true");
  fireEvent.click(within(region).getByLabelText("count允许 null"));
  expect(current().properties!.count.nullable).toBe(true);
  fireEvent.change(screen.getByLabelText("默认值"), { target: { value: "0" } });
  fireEvent.click(within(region).getByRole("button", { name: "校验并应用" }));
  await waitFor(() => expect(screen.queryByRole("region", { name: "count · 值设置" })).toBeNull());
  expect(current().properties!.count.defaultValue).toBe(0);
  expect(rowOf("count").textContent).toContain("默认 0");
});

test("值编辑Esc取消后忽略迟到校验结果，不覆盖原节点", async () => {
  let finish: ((response: Response) => void) | undefined;
  let signal: AbortSignal | undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      signal = init?.signal as AbortSignal;
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    }),
  );
  render(<Harness />);
  openValues("count");
  fireEvent.change(screen.getByLabelText("默认值"), { target: { value: "5" } });
  fireEvent.click(screen.getByRole("button", { name: "校验并应用" }));
  await waitFor(() => expect(finish).toBeDefined());
  fireEvent.keyDown(screen.getByLabelText("默认值"), { key: "Escape" });
  expect(signal?.aborted).toBe(true);
  finish!(okRaw("5"));
  await waitFor(() => expect(screen.queryByLabelText("默认值")).toBeNull());
  expect(screen.getByTestId("text").textContent).not.toContain('"defaultValue"');
});

test("三栏值校验逐栏标记错误，修改一栏保留其他错误和原文", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      try {
        parseJson(String(init?.body));
        return okRaw(String(init?.body));
      } catch {
        return bad("JSON格式不合法");
      }
    }),
  );
  render(<Harness />);
  openValues("count");
  fireEvent.change(screen.getByLabelText("默认值"), { target: { value: "{bad" } });
  fireEvent.change(screen.getByLabelText("示例"), { target: { value: "[bad" } });
  fireEvent.click(screen.getByRole("button", { name: "校验并应用" }));
  await screen.findByText(/默认值：JSON格式不合法/);
  await screen.findByText(/示例：JSON格式不合法/);
  expect(screen.getByLabelText("默认值").getAttribute("aria-invalid")).toBe("true");
  expect(screen.getByLabelText("示例")).toHaveProperty("value", "[bad");
  expect(screen.getByLabelText("枚举").getAttribute("aria-invalid")).toBe("false");
  fireEvent.change(screen.getByLabelText("默认值"), { target: { value: "0" } });
  expect(screen.queryByText(/默认值：JSON格式不合法/)).toBeNull();
  expect(screen.getByText(/示例：JSON格式不合法/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText("示例"), { target: { value: "1" } });
  fireEvent.change(screen.getByLabelText("枚举"), { target: { value: "123" } });
  fireEvent.click(screen.getByRole("button", { name: "校验并应用" }));
  await screen.findByText(/枚举：请填写 JSON 数组/);
  expect(screen.getByLabelText("枚举").getAttribute("aria-invalid")).toBe("true");
  expect(screen.getByLabelText("默认值").getAttribute("aria-invalid")).toBe("false");
});

test("键盘：Enter 新增同级并聚焦、⌘↓ 移动、⌘] 缩进与 ⌘[ 提升，路径变化涉及映射时先确认", async () => {
  render(<Harness initial={stringifyJson({ type: "OBJECT", properties: { buyer: { type: "OBJECT", properties: {} }, orderId: { type: "STRING" }, count: { type: "INTEGER" } } })} />);
  fireEvent.keyDown(nameInput("buyer"), { key: "Enter" });
  await waitFor(() => expect(keys()).toEqual(["buyer", "field1", "orderId", "count"]));
  await waitFor(() => expect(document.activeElement).toBe(nameInput("field1")));
  fireEvent.change(nameInput("field1"), { target: { value: "note" } });
  fireEvent.keyDown(nameInput("field1"), { key: "ArrowDown", metaKey: true });
  await waitFor(() => expect(keys()).toEqual(["buyer", "orderId", "note", "count"]));
  fireEvent.keyDown(nameInput("orderId"), { key: "ArrowUp", ctrlKey: true });
  await waitFor(() => expect(keys()).toEqual(["orderId", "buyer", "note", "count"]));
  fireEvent.keyDown(nameInput("note"), { key: "]", metaKey: true });
  await waitFor(() => expect(keys(["buyer"])).toEqual(["note"]));
  expect(keys()).toEqual(["orderId", "buyer", "count"]);
  fireEvent.keyDown(nameInput("buyer.note"), { key: "[", metaKey: true });
  await waitFor(() => expect(keys()).toEqual(["orderId", "buyer", "note", "count"]));
  // orderId 被映射引用：缩进进入对象会改变路径，需确认。
  fireEvent.keyDown(nameInput("buyer"), { key: "ArrowUp", metaKey: true });
  await waitFor(() => expect(keys()).toEqual(["buyer", "orderId", "note", "count"]));
  fireEvent.keyDown(nameInput("orderId"), { key: "]", metaKey: true });
  await waitFor(() => expect(dialog().textContent).toContain("arg0 ← orderId"));
  fireEvent.click(within(dialog()).getByRole("button", { name: "确认变化" }));
  await waitFor(() => expect(keys(["buyer"])).toEqual(["orderId"]));
  // 不可缩进时只提示，不弹确认。
  fireEvent.keyDown(nameInput("count"), { key: "]", metaKey: true });
  expect(await screen.findByText("上方需要一个对象字段才能缩进为其子字段。")).toBeTruthy();
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("⋯ 菜单删除：无引用且无子字段直接删除；有子字段先确认", async () => {
  render(<Harness initial={stringifyJson({ type: "OBJECT", properties: { buyer: { type: "OBJECT", properties: { name: { type: "STRING" } } }, count: { type: "INTEGER" } } })} />);
  const remove = async (path: string) => {
    fireEvent.click(within(rowOf(path)).getByRole("button", { name: `${path} 更多操作` }));
    fireEvent.click((await screen.findAllByRole("menuitem", { name: "删除" })).at(-1)!);
  };
  await remove("count");
  await waitFor(() => expect(keys()).toEqual(["buyer"]));
  await remove("buyer");
  await waitFor(() => expect(dialog().textContent).toContain("移除 buyer 及其子字段"));
  fireEvent.click(within(dialog()).getByRole("button", { name: "确认变化" }));
  await waitFor(() => expect(keys()).toEqual([]));
  expect(screen.getByText(/还没有字段/)).toBeTruthy();
});

test("拖动手柄只在同级之间调整顺序", () => {
  render(<Harness initial={stringifyJson({ type: "OBJECT", properties: { a: { type: "STRING" }, b: { type: "OBJECT", properties: { x: { type: "STRING" } } }, c: { type: "STRING" } } })} />);
  const handle = (path: string) => rowOf(path).querySelector<HTMLElement>("[draggable=true]")!;
  const data = { setData: vi.fn(), effectAllowed: "" };
  fireEvent.dragStart(handle("c"), { dataTransfer: data });
  fireEvent.dragOver(rowOf("a"), { dataTransfer: data, clientY: 0 });
  fireEvent.drop(rowOf("a"), { dataTransfer: data, clientY: 0 });
  expect(keys()).toEqual(["c", "a", "b"]);
  fireEvent.dragStart(handle("b.x"), { dataTransfer: data });
  fireEvent.drop(rowOf("a"), { dataTransfer: data, clientY: 0 });
  expect(keys()).toEqual(["c", "a", "b"]);
  expect(keys(["b"])).toEqual(["x"]);
});

test("新增字段改为数组生成“每一项”，折叠展开不改变嵌套内容与精确数值", async () => {
  const precise =
    '{"type":"OBJECT","properties":{"items":{"type":"ARRAY","items":{"type":"OBJECT","properties":{"amount":{"type":"NUMBER","nullable":true,"defaultValue":0.1234567890123456789},"id":{"type":"INTEGER","example":9007199254740993}}}}}}';
  render(<Harness initial={precise} />);
  fireEvent.click(screen.getByRole("button", { name: "折叠全部" }));
  expect(screen.queryByLabelText("请求结构字段 items[].id 名称")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "展开全部" }));
  expect(await screen.findByLabelText("请求结构字段 items[].id 名称")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /添加字段/ }));
  await waitFor(() => expect(keys()).toEqual(["items", "field1"]));
  fireEvent.change(nameInput("field1"), { target: { value: "tags" } });
  fireEvent.blur(nameInput("field1"));
  await pickType("请求结构tags类型", "ARRAY");
  await waitFor(() => expect(current().properties!.tags.items).toEqual({ type: "STRING" }));
  expect(screen.getByLabelText("请求结构tags[]类型")).toBeTruthy();
  const result = screen.getByTestId("text").textContent!;
  expect(result).toContain("0.1234567890123456789");
  expect(result).toContain("9007199254740993");
  expect(result).toContain('"nullable": true');
});

test("在最深可新增层，数组因还需要元素节点而提前禁用", async () => {
  let nested: SchemaNode = { type: "OBJECT", properties: { leaf: { type: "STRING" } } };
  for (let index = 5; index >= 0; index--) nested = { type: "OBJECT", properties: { [`level${index}`]: nested } };
  render(<Harness initial={stringifyJson(nested)} />);
  fireEvent.mouseDown(screen.getByLabelText("请求结构level0.level1.level2.level3.level4.level5.leaf类型"));
  const option = (await screen.findAllByTitle("ARRAY")).find((item) => item.closest(".ant-select-item-option"))!;
  expect(option.closest(".ant-select-item-option")?.classList.contains("ant-select-item-option-disabled")).toBe(true);
});

test("对象节点从 JSON 生成：合并只补齐缺少字段，替换移除被映射引用的字段前先确认", async () => {
  render(
    <Harness
      initial={stringifyJson({ type: "OBJECT", properties: { buyer: { type: "OBJECT", properties: { name: { type: "STRING", description: "姓名", required: true } } } } })}
      mappings={[{ source: "REQUEST", target: "arg0", path: "buyer.name" }]}
    />,
  );
  const generate = async () => {
    fireEvent.click(within(rowOf("buyer")).getByRole("button", { name: "buyer 更多操作" }));
    fireEvent.click((await screen.findAllByRole("menuitem", { name: "从 JSON 生成子字段…" })).at(-1)!);
    return (await screen.findByText("从 JSON 生成 buyer 的字段")).closest<HTMLElement>(".ant-modal")!;
  };
  let modal = await generate();
  fireEvent.change(within(modal).getByLabelText("JSON 样例"), { target: { value: '{"name":"张三","phone":"138","tenantId":"t1"}' } });
  expect(await within(modal).findByText(/将新增 1 个字段：phone/)).toBeTruthy();
  expect(within(modal).getByText(/已排除可信身份字段/)).toBeTruthy();
  fireEvent.click(within(modal).getByRole("button", { name: "合并到字段表" }));
  await waitFor(() => expect(keys(["buyer"])).toEqual(["name", "phone"]));
  expect(current().properties!.buyer.properties!.name).toEqual({ type: "STRING", description: "姓名", required: true });
  expect(screen.getByTestId("text").textContent).not.toContain("张三");
  modal = await generate();
  fireEvent.click(within(modal).getByLabelText(/替换：/));
  fireEvent.change(within(modal).getByLabelText("JSON 样例"), { target: { value: '{"mobile":"138"}' } });
  expect(await within(modal).findByText(/将移除 buyer.name、buyer.phone/)).toBeTruthy();
  fireEvent.click(within(modal).getByRole("button", { name: "替换字段" }));
  await waitFor(() => expect(screen.getByText("确认字段变化").closest(".ant-modal")!.textContent).toContain("arg0 ← buyer.name"));
  fireEvent.click(screen.getByRole("button", { name: "确认变化" }));
  await waitFor(() => expect(keys(["buyer"])).toEqual(["mobile"]));
});


test("嵌套值未应用时，批量折叠和切换高级编辑保留输入", async () => {
  render(<Harness initial={stringifyJson({ type: "OBJECT", properties: { buyer: { type: "OBJECT", properties: { count: { type: "INTEGER" } } } } })} mappings={[]} />);
  openValues("buyer.count");
  fireEvent.change(screen.getByLabelText("默认值"), { target: { value: "123" } });
  for (const action of ["折叠全部", "高级 JSON"]) {
    fireEvent.click(screen.getByRole("button", { name: action }));
    expect(screen.getByLabelText("默认值")).toHaveProperty("value", "123");
    expect(screen.getByText("请先应用或取消字段修改，再切换或折叠结构。")).toBeTruthy();
  }
  expect(current().properties!.buyer.properties!.count.defaultValue).toBeUndefined();
  fireEvent.click(screen.getByRole("button", { name: "校验并应用" }));
  await waitFor(() => expect(current().properties!.buyer.properties!.count.defaultValue).toBe(123));
  fireEvent.click(screen.getByRole("button", { name: "折叠全部" }));
  expect(screen.queryByLabelText("默认值")).toBeNull();
});

test('值校验返回只更新值字段，不覆盖等待期间的新说明', async () => {
  let finish:((response:Response)=>void)|undefined;
  let sent='';
  vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>{
    if(url.includes('kind=schema')) {sent=String(init?.body);return new Promise<Response>(resolve=>{finish=resolve})}
    return okRaw(String(init?.body));
  }));
  render(<Harness mappings={[]}/>);
  openValues('count');
  fireEvent.change(screen.getByLabelText('默认值'),{target:{value:'123'}});
  fireEvent.click(screen.getByRole('button',{name:'校验并应用'}));
  await waitFor(()=>expect(finish).toBeTruthy());
  fireEvent.change(screen.getByLabelText('请求结构count说明'),{target:{value:'等待期间的新说明'}});
  finish!(okRaw(sent));
  await waitFor(()=>expect(current().properties!.count.defaultValue).toBe(123));
  expect(current().properties!.count.description).toBe('等待期间的新说明');
});
