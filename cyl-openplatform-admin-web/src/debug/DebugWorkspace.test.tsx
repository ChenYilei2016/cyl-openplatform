import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { parseJson, stringifyJson } from '@cyl/open-platform-web-shared/json';
import type { ApiDefinition } from '../catalog/CatalogPanel';
import { AdminApiError, type AdminApi } from '../access/api';
import { adapterForm } from '../catalog/ResponseAdapterEditor';
import DraftDebug from './DraftDebug';
import RequestEditor, { withoutSecrets } from './RequestEditor';
import type { DebugEditorActions, DebugResult } from './types';
import { rememberIdentity } from './identity';
beforeEach(() => rememberIdentity('token', null));
afterEach(cleanup);
const capture = (value: unknown) => ({ available: true, redacted: false, truncated: false, value });
const result = (revision = 1): DebugResult => ({ requestId: 'call-new', draftRevision: revision, durationMillis: 5,
  outcome: 'SUCCEEDED', providerDispatch: 'SENT', checks: [], mappedInput: capture({}), providerResponse: capture({ count: 7 }),
  adaptedData: capture({ count: 7 }), publicResponse: capture({ code: 200, data: { count: 7 } }),
  identity: { applicationId: 'app', appKey: 'key', tenantId: 'tenant', expiresAt: '2027-01-01T00:00:00Z' } });
const definition: ApiDefinition = { id: 'api-1', service: 'orders', version: 'v1', method: 'query', name: '订单', category: '订单', owner: '负责人', protocol: 'HTTP', draftRevision: 1, scopeCodes: ['orders'],
  requestSchema: { type: 'OBJECT', properties: { count: { type: 'INTEGER', required: true } } }, responseSchema: { type: 'OBJECT', properties: {} },
  binding: { protocol: 'HTTP', timeoutMillis: 2000, http: { url: 'http://provider/query', method: 'POST' } }, mappings: [], errorDefinitions: [] };
function client(action: (path: string, options?: any) => Promise<unknown>): AdminApi {
  return ((path: string, options?: any) => path.startsWith('/publications/') ? Promise.resolve({ enabled: true, liveReleaseId: null }) : action(path, options)) as AdminApi;
}
function input(value = '{"count":7}') {
  fireEvent.change(screen.getByLabelText('业务访问 Token'), { target: { value: 'private-token' } });
  fireEvent.click(screen.getByRole('button', { name: 'JSON' }));
  fireEvent.change(screen.getByLabelText('调试请求 JSON'), { target: { value } });
}

test('参数表单与JSON共享精确数字、数组和null；错误类型在执行前可见', () => {
  const changed = vi.fn();
  const schema = { type: 'OBJECT', properties: { count: { type: 'INTEGER', required: true }, list: { type: 'ARRAY', items: { type: 'STRING' }, nullable: true } } };
  function Editor() { const [text, setText] = useState('{}'); return <RequestEditor text={text} schema={schema} disabled={false} onChange={value => { changed(value); setText(value); }} onInvalid={() => {}} />; }
  render(<Editor />);
  expect(screen.getByRole('alert').textContent).toContain('$.count');
  fireEvent.change(screen.getByLabelText('参数 count'), { target: { value: '9007199254740993' } });
  fireEvent.change(screen.getByLabelText('参数 list'), { target: { value: '["a","b"]' } });
  fireEvent.click(screen.getByRole('button', { name: 'JSON' }));
  expect(screen.getByLabelText('调试请求 JSON')).toHaveProperty('value', '{\n  "count": 9007199254740993,\n  "list": [\n    "a",\n    "b"\n  ]\n}');
  fireEvent.change(screen.getByLabelText('调试请求 JSON'), { target: { value: '{"count":"7","list":null}' } });
  expect(screen.getByRole('alert').textContent).toContain('需要 INTEGER');
  expect(changed).toHaveBeenCalled();
});

test('取消等待不撤销业务，晚到成功不能覆盖未知结果，双击只发一次', async () => {
  let complete!: (value: DebugResult) => void;
  const call = vi.fn(() => new Promise<DebugResult>(resolve => { complete = resolve; }));
  render(<DraftDebug api={client(call)} definition={definition} />);
  input();
  const button = screen.getByRole('button', { name: '执行调试' });
  fireEvent.click(button); fireEvent.click(button);
  expect(call).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: '停止等待' }));
  expect(screen.getByRole('alert').textContent).toContain('业务请求可能仍在执行');
  await act(async () => complete(result()));
  expect(screen.queryByText('call-new')).toBeNull();
  expect(screen.getByLabelText('调试请求 JSON')).toHaveProperty('value', '{"count":7}');
  expect(call).toHaveBeenCalledTimes(1);
});

test('保存并测试使用新修订，保留当前Token及精确参数', async () => {
  const call = vi.fn(async () => result(2));
  const saved = vi.fn();
  function Workspace() {
    const [current, setCurrent] = useState(definition);
    const [dirty, setDirty] = useState(true);
    const editor: DebugEditorActions = { dirty: () => dirty, save: async () => {
      const next = { ...current, draftRevision: 2 }; saved(); setCurrent(next); setDirty(false); return next;
    }, setBusy: () => {}, adapter: adapterForm(), responseSchemaText: '{"type":"OBJECT"}', changeAdapter: () => {}, changeResponseSchema: () => {}, configureTarget: () => {}, reload: () => {} };
    return <DraftDebug api={client(call)} definition={current} editor={editor} />;
  }
  render(<Workspace />);
  input('{"count":9007199254740993}');
  fireEvent.click(screen.getByRole('button', { name: '保存并调试' }));
  await screen.findByText('call-new');
  expect(saved).toHaveBeenCalledOnce();
  const options = (call.mock.calls as unknown as [string, { bodyText: string }][])[0][1];
  expect(options.bodyText).toContain('"expectedRevision":2');
  expect(options.bodyText).toContain('9007199254740993');
  expect(screen.getByLabelText('业务访问 Token')).toHaveProperty('value','private-token');
  expect(screen.getByText('已核验')).toBeTruthy();
  expect(screen.getByLabelText('调试请求 JSON')).toHaveProperty('value', '{"count":9007199254740993}');
});

test('保存冲突后不执行业务，保留输入；预检只调用preflight', async () => {
  const call = vi.fn(async () => ({ ...result(), providerDispatch: 'NOT_SENT', publicResponse: { available: false, value: null } }));
  const editor: DebugEditorActions = { dirty: () => true, save: async () => null, setBusy: () => {}, adapter: adapterForm(), responseSchemaText: '{"type":"OBJECT"}', changeAdapter: () => {}, changeResponseSchema: () => {}, configureTarget: () => {}, reload: () => {} };
  const view = render(<DraftDebug api={client(call)} definition={definition} editor={editor} />);
  input(); fireEvent.click(screen.getByRole('button', { name: '保存并调试' }));
  await screen.findByRole('alert'); expect(call).not.toHaveBeenCalled();
  expect(screen.getByLabelText('调试请求 JSON')).toHaveProperty('value', '{"count":7}');
  view.rerender(<DraftDebug api={client(call)} definition={definition} />);
  fireEvent.click(screen.getByRole('button', { name: '检查准备情况' }));
  await screen.findByText('预检通过 · 尚未执行业务');
  expect(call).toHaveBeenCalledTimes(1);
  expect((call.mock.calls as unknown as [string][])[0][0]).toBe('/apis/api-1/debug/preflight');
});

test('清业务身份保留普通参数与精度，移除秘密字段', () => {
  const cleaned = withoutSecrets('{"count":9007199254740993,"password":"private","nested":{"accessToken":"private","keep":true}}');
  expect(cleaned).toContain('9007199254740993');
  expect(cleaned).not.toContain('private');
  expect(stringifyJson(parseJson(cleaned))).toBe('{"count":9007199254740993,"nested":{"keep":true}}');
});

test('结构问题带着本次返回到配置页修复；清除身份同步销毁交出的临时样例', async () => {
  const failure = { ...result(), outcome: 'FAILED', providerResponse: capture({ rawMarker: 'temporary-provider-result' }),
    checks: [{ stage: 'SCHEMA', status: 'FAILED', summary: '结构不匹配', issues: [] }] };
  const repairResponse = vi.fn(), setResponseSample = vi.fn();
  const editor: DebugEditorActions = { dirty: () => false, save: async () => definition, setBusy: () => {}, adapter: adapterForm(), responseSchemaText: '{"type":"OBJECT"}', changeAdapter: () => {}, changeResponseSchema: () => {}, configureTarget: () => {}, reload: () => {}, repairResponse, setResponseSample };
  render(<DraftDebug api={client(async () => failure)} definition={definition} editor={editor} />);
  input(); fireEvent.click(screen.getByRole('button', { name: '执行调试' }));
  fireEvent.click(await screen.findByRole('button', { name: '到配置页修复返回规则 / 公开结构' }));
  expect(repairResponse).toHaveBeenCalledWith('{\n  "rawMarker": "temporary-provider-result"\n}', true);
  fireEvent.click(screen.getByRole('button', { name: '清除调试身份与结果' }));
  expect(setResponseSample).toHaveBeenLastCalledWith(undefined);
  expect(screen.queryByText('call-new')).toBeNull();
});

test('缺少业务身份时前置说明并禁用调用，不引向配置冲突',()=>{
  const call=vi.fn(async()=>result());
  const editor:DebugEditorActions={dirty:()=>false,save:async()=>definition,setBusy:()=>{},adapter:adapterForm(),responseSchemaText:'{"type":"OBJECT"}',changeAdapter:()=>{},changeResponseSchema:()=>{},configureTarget:()=>{},reload:()=>{}};
  render(<DraftDebug api={client(call)} definition={definition} editor={editor} initialInput='{"count":7}'/>);
  expect(screen.getByRole('button',{name:'执行调试'})).toHaveProperty('disabled',true);
  expect(screen.getByText('先提供业务Token；也可用AK与Secret就地获取。')).toBeTruthy();
  expect(screen.queryByRole('button',{name:'核对服务端最新配置'})).toBeNull();
  expect(call).not.toHaveBeenCalled();
});

test('保存未确认或取消保存等待时不发送业务，晚到保存不能自动接续',async()=>{
  let complete!:(value:ApiDefinition|null)=>void;
  const call=vi.fn(async()=>result());
  const editor:DebugEditorActions={dirty:()=>true,save:()=>new Promise(resolve=>{complete=resolve}),setBusy:()=>{},adapter:adapterForm(),responseSchemaText:'{"type":"OBJECT"}',changeAdapter:()=>{},changeResponseSchema:()=>{},configureTarget:()=>{},reload:()=>{}};
  render(<DraftDebug api={client(call)} definition={definition} editor={editor}/>);
  input();fireEvent.click(screen.getByRole('button',{name:'保存并调试'}));
  fireEvent.click(screen.getByRole('button',{name:'停止等待'}));
  await act(async()=>complete({...definition,draftRevision:2}));
  expect(call).not.toHaveBeenCalled();
  expect(screen.getByRole('alert').textContent).toContain('未发送提供方业务');
  expect(screen.getByLabelText('调试请求 JSON')).toHaveProperty('value','{"count":7}');
});

test('同API配置往返保留身份，离开时旧业务结果不能覆盖返回后的上下文',async()=>{
  let complete!:(value:DebugResult)=>void;
  const call=vi.fn(()=>new Promise<DebugResult>(resolve=>{complete=resolve}));
  const api=client(call);
  const view=render(<DraftDebug api={api} definition={definition}/>);
  input();fireEvent.click(screen.getByRole('button',{name:'执行调试'}));
  view.rerender(<DraftDebug api={api} definition={definition} isActive={false}/>);
  view.rerender(<DraftDebug api={api} definition={definition} isActive/>);
  await act(async()=>complete(result()));
  expect(screen.queryByText('call-new')).toBeNull();
  expect(screen.getByLabelText('业务访问 Token')).toHaveProperty('value','private-token');
  expect(screen.getByRole('alert').textContent).toContain('业务请求可能仍在执行');
  expect(call).toHaveBeenCalledOnce();
});

test('保存过程中离开API，晚到保存不得启动业务',async()=>{
  let complete!:(value:ApiDefinition|null)=>void;
  const call=vi.fn(async()=>result());
  const editor:DebugEditorActions={dirty:()=>true,save:()=>new Promise(resolve=>{complete=resolve}),setBusy:()=>{},adapter:adapterForm(),responseSchemaText:'{"type":"OBJECT"}',changeAdapter:()=>{},changeResponseSchema:()=>{},configureTarget:()=>{},reload:()=>{}};
  const view=render(<DraftDebug api={client(call)} definition={definition} editor={editor}/>);
  input();fireEvent.click(screen.getByRole('button',{name:'保存并调试'}));
  view.unmount();await act(async()=>complete({...definition,draftRevision:2}));
  expect(call).not.toHaveBeenCalled();
});

test('业务拒绝先引导核对请求，不把正常业务错误当作结构修复',async()=>{
  const rejected={...result(),outcome:'FAILED',checks:[{stage:'BUSINESS',status:'FAILED',summary:'当前租户内无此订单',issues:[]}]};
  const editor:DebugEditorActions={dirty:()=>false,save:async()=>definition,setBusy:()=>{},adapter:adapterForm(),responseSchemaText:'{"type":"OBJECT"}',changeAdapter:()=>{},changeResponseSchema:()=>{},configureTarget:()=>{},reload:()=>{},repairResponse:vi.fn()};
  render(<DraftDebug api={client(async()=>rejected)} definition={definition} editor={editor}/>);
  input();fireEvent.click(screen.getByRole('button',{name:'执行调试'}));
  await screen.findByRole('button',{name:'核对请求参数'});
  expect(screen.getByRole('button',{name:'检查返回规则'})).toBeTruthy();
  expect(screen.queryByRole('button',{name:'到配置页修复返回规则 / 公开结构'})).toBeNull();
});


test.each([504,50000001])('业务请求超时或响应未知(%s)保留输入且不自动重复',async(code)=>{
  const call=vi.fn(async()=>{throw new AdminApiError('响应结果暂不可确认',code)});
  render(<DraftDebug api={client(call)} definition={definition}/>);
  input();fireEvent.click(screen.getByRole('button',{name:'执行调试'}));
  await screen.findByText(/无法确认业务执行结果/);
  expect(screen.getByLabelText('调试请求 JSON')).toHaveProperty('value','{"count":7}');
  expect(call).toHaveBeenCalledOnce();
});
