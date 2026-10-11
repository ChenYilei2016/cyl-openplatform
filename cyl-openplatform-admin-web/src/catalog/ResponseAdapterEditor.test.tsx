import { useState } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { parseJson, stringifyJson } from '@cyl/open-platform-web-shared/json';
import type { AdminApi } from '../access/api';
import ResponseAdapterEditor, { adapterForm, responseAdapter } from './ResponseAdapterEditor';
afterEach(cleanup);

test('切换DIRECT忽略保留的外壳输入，成功值校验不舍入数字或混用类型', () => {
  const form = { ...adapterForm(), mode: 'ENVELOPE' as const, successValues: '[9007199254740993.000000000001]' };
  expect(stringifyJson(responseAdapter(form))).toContain('9007199254740993.000000000001');
  expect(() => responseAdapter({ ...form, successValues: '[0,"0"]' })).toThrow('同类型');
  expect(responseAdapter({ ...form, mode: 'DIRECT', successValues: '尚未完成' })).toEqual({ mode: 'DIRECT' });
});

test('无副作用预览保留原始JSON，编辑样例后不再展示旧结果', async () => {
  const api = vi.fn(async (_path, options) => {
    expect(options.bodyText).toContain('9007199254740993.000000000001');
    expect(parseJson<{ responseAdapter: unknown }>(options.bodyText).responseAdapter).toEqual({ mode: 'DIRECT' });
    const content = { available: true, redacted: false, truncated: false };
    return { succeeded: true, publicResponse: { ...content, value: { code: 200, data: 12 } }, adaptedData: { ...content, value: 12 }, providerResponse: { ...content, value: parseJson('9007199254740993.000000000001') }, warnings: [] };
  }) as unknown as AdminApi;
  function Editor() {
    const [form, setForm] = useState(adapterForm());
    return <ResponseAdapterEditor api={api} form={form} onChange={setForm} schemaText='{"type":"NUMBER"}' />;
  }
  render(<Editor />);
  fireEvent.click(screen.getByText('用返回样例验证规则（无需调用）'));
  fireEvent.change(screen.getByLabelText('提供方返回样例'), { target: { value: '9007199254740993.000000000001' } });
  fireEvent.click(screen.getByRole('button', { name: '预览返回处理' }));
  await waitFor(() => expect(screen.getByText('规则校验通过')).toBeTruthy());
  expect(api).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('tab', { name: '提供方原始' }));
  await waitFor(() => expect(screen.getByRole('tabpanel').textContent).toContain('9007199254740993.000000000001'));
  fireEvent.click(screen.getByRole('tab', { name: '公开响应' }));
  expect(screen.getByRole('tabpanel').textContent).toContain('200');
  fireEvent.change(screen.getByLabelText('提供方返回样例'), { target: { value: '12' } });
  expect(screen.queryByText('规则校验通过')).toBeNull();
});

test('识别完整Response后只明确采用才迁移，保留内层约束和精确示例', async () => {
  const form = adapterForm({mode:'ENVELOPE',successPath:'errCode',successValues:['0'],dataPath:'data'});
  const original = '{"type":"OBJECT","properties":{"errCode":{"type":"STRING","required":true},"data":{"type":"OBJECT","nullable":true,"description":"业务结果","properties":{"amount":{"type":"NUMBER","required":true,"enumValues":[9007199254740993]}}}},"example":{"errCode":"0","data":{"amount":9007199254740993}}}';
  const change = vi.fn();
  function Editor() {
    const [schema,setSchema] = useState(original);
    return <ResponseAdapterEditor api={vi.fn()} form={form} onChange={vi.fn()} schemaText={schema} onSchemaChange={text=>{change(text);setSchema(text);}}/>;
  }
  render(<Editor/>);
  const button = screen.getByRole('button',{name:'使用 data 内的结构'});
  expect(change).not.toHaveBeenCalled();
  fireEvent.click(button);
  await waitFor(()=>expect(change).toHaveBeenCalledTimes(1));
  const text = change.mock.calls[0][0];
  expect(text).not.toContain('errCode');
  expect(text).toContain('9007199254740993');
  expect(parseJson(text)).toMatchObject({description:'业务结果',nullable:true,properties:{amount:{required:true}}});
  expect(screen.queryByRole('button',{name:'使用 data 内的结构'})).toBeNull();
});

test('结构迁移严格校验失败或回包前输入变化都保留原文',async()=>{
 const form=adapterForm({mode:'ENVELOPE',successPath:'code',successValues:[0],dataPath:'data'});
 const raw='{"type":"OBJECT","properties":{"code":{"type":"INTEGER"},"data":{"type":"OBJECT","properties":{"amount":{"type":"STRING"},"amount":{"type":"NUMBER"}}}}}';
 const change=vi.fn();
 let complete!:(value:unknown)=>void;
 const api=vi.fn().mockRejectedValueOnce(new Error('重复字段 amount')).mockImplementation(()=>new Promise(resolve=>{complete=resolve;}));
 const props={api:api as AdminApi,form,onChange:vi.fn(),schemaText:raw,onSchemaChange:change};
 const view=render(<ResponseAdapterEditor {...props}/>);
 fireEvent.click(screen.getByRole('button',{name:'使用 data 内的结构'}));
 expect(await screen.findByText('重复字段 amount')).toBeTruthy();
 expect(change).not.toHaveBeenCalled();
 expect(api.mock.calls[0][1].bodyText).toBe(raw);
 fireEvent.click(screen.getByRole('button',{name:'使用 data 内的结构'}));
 view.rerender(<ResponseAdapterEditor {...props} schemaText='{"type":"OBJECT"}'/>);
 complete({});
 await waitFor(()=>expect(screen.queryByRole('button',{name:'使用 data 内的结构'})).toBeNull());
 expect(change).not.toHaveBeenCalled();
});
