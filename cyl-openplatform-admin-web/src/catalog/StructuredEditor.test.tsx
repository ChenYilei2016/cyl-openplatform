import { useState } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createAdminApi } from '../access/api';
import ResponseExampleEditor from './ResponseExampleEditor';
import { BindingEditor, type Binding } from './BindingEditor';
import type { SchemaNode } from '@cyl/open-platform-web-shared/documentation/types';
import { parseJson, stringifyJson } from '@cyl/open-platform-web-shared/json';

const okRaw = (text: string) =>
  new Response(`{"code":200,"data":${text}}`, {
    headers: { 'Content-Type': 'application/json' },
  });
const bad = (message: string) =>
  Response.json({ code: 40000001, resultMsg: message }, { status: 400 });
const schema: SchemaNode = {
  type: 'OBJECT',
  properties: {
    orderId: { type: 'STRING', required: true, example: 'private-order' },
    count: { type: 'INTEGER', required: false },
  },
};
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test('粘贴签名先预览再应用，保留版本/组/固定连接，失败与取消不改原字段', async () => {
  const initial: Binding = { protocol: 'DUBBO', timeoutMillis: 3000, dubbo: { interfaceName: 'com.example.OldService', method: 'old', version: '2.0', group: 'sales', connectionId: 'c1', connectionRevision: 8, parameterTypes: ['int'] } };
  const apply = vi.fn();
  const calls = vi.fn(async (_path: string) => ({ id: 'c1', name: '固定连接', activeRevision: 8, enabled: true }));
  const api = calls as unknown as import('../access/api').AdminApi;
  function Host() {
    const [binding, setBinding] = useState(initial);
    return <BindingEditor api={api} value={binding} mappingCount={1} protectSignature={false} onChange={setBinding} onRequestChange={value => { apply(value); setBinding(value); }} />;
  }
  render(<Host />);
  const input = screen.getByLabelText('完整Java方法签名');
  fireEvent.change(input, { target: { value: 'com.example.NewService#lookup(java.util.List<Order>)' } });
  fireEvent.click(screen.getByRole('button', { name: '解析预览' }));
  expect(await screen.findByText(/擦除泛型/)).toBeTruthy();
  expect(screen.getByLabelText('接口全限定名')).toHaveProperty('value', 'com.example.OldService');
  fireEvent.change(input, { target: { value: 'com.example.NewService.lookup(java.lang.String, int)' } });
  fireEvent.click(screen.getByRole('button', { name: '解析预览' }));
  expect(screen.getByRole('region', { name: '签名解析预览' })).toBeTruthy();
  expect(apply).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '取消预览' }));
  expect(screen.queryByRole('region', { name: '签名解析预览' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '解析预览' }));
  fireEvent.click(screen.getByRole('button', { name: '填入下方字段' }));
  expect(apply).toHaveBeenCalledWith({ ...initial, dubbo: { ...initial.dubbo, interfaceName: 'com.example.NewService', method: 'lookup', parameterTypes: ['java.lang.String', 'int'] } });
  expect(screen.getByLabelText('arg0 Java类型')).toHaveProperty('value', 'java.lang.String');
  expect(screen.getByLabelText('arg1 Java类型')).toHaveProperty('value', 'int');
  expect(calls.mock.calls.every(call => !/services|methods|diagnostics/.test(call[0]))).toBe(true);
});

test('响应候选默认不选，逐字段替换后旧预览失效，显式确认只交回当前草稿', async () => {
  const source = { orderId: 'private-order', count: 2 };
  const applied = vi.fn();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => okRaw(String(init?.body))),
  );
  render(
    <ResponseExampleEditor
      api={createAdminApi('csrf', vi.fn())}
      schema={schema}
      source={source}
      onApply={applied}
      onCancel={vi.fn()}
    />,
  );
  expect((screen.getByLabelText('公开业务 data（JSON）') as HTMLTextAreaElement).value).toBe('');
  fireEvent.click(screen.getByRole('checkbox', { name: /orderId/ }));
  fireEvent.click(screen.getByRole('button', { name: '用所选字段替换编辑区' }));
  fireEvent.click(screen.getByText('逐字段编辑 / 辅助脱敏'));
  fireEvent.click(screen.getByRole('button', { name: '读取可编辑字段' }));
  fireEvent.change(await screen.findByLabelText('替换 orderId'), {
    target: { value: '"DEMO-001"' },
  });
  fireEvent.click(screen.getByRole('button', { name: '应用 JSON 值' }));
  await waitFor(() =>
    expect((screen.getByLabelText('公开业务 data（JSON）') as HTMLTextAreaElement).value).toContain(
      'DEMO-001',
    ),
  );
  fireEvent.click(screen.getByRole('button', { name: '校验并预览公开内容' }));
  fireEvent.click(await screen.findByRole('checkbox', { name: /我已逐项核对/ }));
  expect(
    (
      screen.getByRole('button', {
        name: '确认写入当前草稿',
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(false);
  fireEvent.change(screen.getByLabelText('公开业务 data（JSON）'), {
    target: { value: '{"orderId":"DEMO-002"}' },
  });
  expect(
    (
      screen.getByRole('button', {
        name: '确认写入当前草稿',
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  expect(screen.queryByText('客户将看到的业务响应示例')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '校验并预览公开内容' }));
  fireEvent.click(await screen.findByRole('checkbox', { name: /我已逐项核对/ }));
  fireEvent.click(screen.getByRole('button', { name: '确认写入当前草稿' }));
  expect(applied).toHaveBeenCalledOnce();
  expect(applied.mock.calls[0][0].example).toEqual({ orderId: 'DEMO-002' });
  expect(applied.mock.calls[0][0].properties.orderId.example).toBeNull();
  expect(source).toEqual({ orderId: 'private-order', count: 2 });
});

test('响应候选先严格解析单值，字段注入或Schema失败保留原文且不可确认', async () => {
  const calls = vi.fn(async (url: string, init?: RequestInit) =>
    url.includes('kind=schema')
      ? bad('JSON对象缺少必填字段')
      : String(init?.body).includes('"required":')
        ? bad('尾随字段')
        : okRaw(String(init?.body)),
  );
  vi.stubGlobal('fetch', calls);
  render(
    <ResponseExampleEditor
      api={createAdminApi('csrf', vi.fn())}
      schema={schema}
      source={{}}
      onApply={vi.fn()}
      onCancel={vi.fn()}
    />,
  );
  const input = screen.getByLabelText('公开业务 data（JSON）');
  fireEvent.change(input, { target: { value: '1,"required":true' } });
  fireEvent.click(screen.getByRole('button', { name: '校验并预览公开内容' }));
  expect((await screen.findByRole('alert')).textContent).toContain('尾随字段');
  expect(calls.mock.calls).toHaveLength(1);
  fireEvent.change(input, { target: { value: '{}' } });
  fireEvent.click(screen.getByRole('button', { name: '校验并预览公开内容' }));
  expect((await screen.findByRole('alert')).textContent).toContain('缺少必填字段');
  expect((input as HTMLTextAreaElement).value).toBe('{}');
  expect(
    (
      screen.getByRole('button', {
        name: '确认写入当前草稿',
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
});
