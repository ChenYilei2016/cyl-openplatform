import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import Portal from './Portal';
import { businessRequest, createPortalApi } from './api';
import { stringifyJson } from '@cyl/open-platform-web-shared/json';
import { PlatformTheme } from '@cyl/open-platform-web-shared/ui/PlatformTheme';

// 与生产一致套用门户主题（含中文语言包、按钮不插空格）。
const themed = (node: ReactNode) => <PlatformTheme variant="portal">{node}</PlatformTheme>;

beforeEach(() => {
  vi.spyOn(window,'scrollTo').mockImplementation(()=>{});
  history.replaceState(null, '', '/portal/?section=settings');
  sessionStorage.clear();
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const ok = (data: unknown) => Response.json({ code: 200, data }, { headers: { 'X-CSRF-Token': 'csrf16' } });
const session = { tenantId: '101', userId: 'u1', employeeNo: 'e1', displayName: '客户用户' };
const application = { scopes: [], id: 'g1', applicationId: 'a1', appKey: 'a'.repeat(32), name: '订单应用', note: '订单应用', applicationStatus: 'ENABLED', status: 'ACTIVE', authorizationVersion: 1 };

test('门户写请求使用CSRF和会话Cookie，403清会话；业务Bearer使用omit且401仅清业务身份', async () => {
  const expire = vi.fn();
  const fetchMock = vi.fn(async () => Response.json({ code: 40300001, resultMsg: '无资格' }, { status: 403 }));
  vi.stubGlobal('fetch', fetchMock);
  await expect(createPortalApi('csrf16', expire)('/applications', { method: 'POST', body: { name: '接入' } })).rejects.toThrow('无资格');
  expect(expire).toHaveBeenCalledExactlyOnceWith('forbidden');
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe('/portal-api/applications'); expect(init.credentials).toBe('same-origin'); expect(new Headers(init.headers).get('X-CSRF-Token')).toBe('csrf16');
  const clear = vi.fn();
  fetchMock.mockImplementation(async () => Response.json({ code: 40100003, resultMsg: 'Token失效' }, { status: 401 }));
  await expect(businessRequest('/api/token/introspect', { token: 'secret-token', onUnauthorized: clear })).rejects.toThrow('Token失效');
  expect(clear).toHaveBeenCalledOnce(); expect(expire).toHaveBeenCalledOnce();
  const [, business] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
  expect(business.credentials).toBe('omit'); expect(new Headers(business.headers).get('Authorization')).toBe('Bearer secret-token');
});

test('业务请求规范化保留大整数和小数，拒绝超大正文且响应保持请求号', async () => {
  const fetchMock = vi.fn(async () => new Response('{"code":200,"data":{"id":9007199254740993,"price":1.1234567890123456789},"requestId":"r16"}'));
  vi.stubGlobal('fetch', fetchMock);
  const result = await businessRequest('/api/oauth/orders/v1/query', { bodyText: '{"id":9007199254740993,"price":1.1234567890123456789}' });
  expect(stringifyJson(result)).toContain('9007199254740993'); expect(stringifyJson(result)).toContain('1.1234567890123456789'); expect(result.requestId).toBe('r16');
  const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(init.body).toContain('9007199254740993');
  await expect(businessRequest('/api/oauth/orders/v1/query', { bodyText: JSON.stringify({ text: 'x'.repeat(2 * 1024 * 1024) }) })).rejects.toThrow('正文');
  expect(fetchMock).toHaveBeenCalledOnce();
});

test('空备注通过原生表单校验并以空请求体生成本租户AK', async () => {
  const calls: [string, RequestInit | undefined][] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push([url, init]);
    if (url === '/platform-info') return ok({ name: 'API 开放平台', adminLoginUrl: null });
    if (url === '/portal-api/session') return ok(session);
    if (url === '/portal-api/creation-availability') return ok({available:true,defaultScopeCount:1});
    if (url === '/portal-api/applications/g1') return ok(application);
    if (url.startsWith('/portal-api/bindings/g1/users')) return ok({items:[],total:0,page:1,pageSize:20});
    if (url.startsWith('/portal-api/applications?')) return ok({ items: [], total: 0, page: 1, pageSize: 20 });
    if (url === '/portal-api/applications') return ok({ application: { appKey: 'b'.repeat(32), name: '接入凭据' }, appSecret: 'once-secret' });
    throw new Error(`Unexpected ${url}`);
  }));
  render(themed(<Portal />));
  const create = await screen.findByRole('button', { name: '生成新 AK' });
  fireEvent.click(create);
  const submit = screen.getByRole('button', { name: '生成并绑定本租户' });
  const form = submit.closest('form')!;
  const name = form.querySelector<HTMLInputElement>('input[name="note"]')!;
  expect(name.value).toBe('');
  expect(name.checkValidity()).toBe(true);
  expect(form.checkValidity()).toBe(true);
  await waitFor(()=>expect((submit as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(submit);
  await screen.findByText('once-secret');
  const request = calls.find(([url]) => url === '/portal-api/applications')!;
  expect(request[1]?.method).toBe('POST');
  expect(JSON.parse(String(request[1]?.body))).toEqual({});
});

test('本租户生成Secret仅当次展示，公开文档入口独立，退出清当前工作区', async () => {
  const calls: [string, RequestInit | undefined][] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push([url, init]);
    if (url === '/platform-info') return ok({ name: 'API 开放平台', adminLoginUrl: null });
    if (url === '/portal-api/session') return ok(session);
    if (url === '/portal-api/creation-availability') return ok({available:true,defaultScopeCount:1});
    if (url === '/portal-api/applications/g1') return ok(application);
    if (url.startsWith('/portal-api/bindings/g1/users')) return ok({items:[],total:0,page:1,pageSize:20});
    if (url.startsWith('/portal-api/applications?')) return ok({ items: [application], total: 1, page: 1, pageSize: 20 });
    if (url === '/portal-api/applications') return ok({ application: { id: 'a2', appKey: 'b'.repeat(32), name: '新应用' }, appSecret: 'once-secret' });
    if (url.startsWith('/public-api/documents')) return ok({ items: [], total: 0, page: 1, pageSize: 20 });
    throw new Error(`Unexpected ${url}`);
  }));
  const storage = vi.spyOn(Storage.prototype, 'setItem');
  render(themed(<Portal />));
  await screen.findByText('客户用户');
  fireEvent.click(screen.getByRole('button', { name: '生成新 AK' }));
  fireEvent.change(screen.getByLabelText('本租户备注（可选）'), { target: { value: '  新应用  ' } });
  await waitFor(()=>expect((screen.getByRole('button', {name:'生成并绑定本租户'})as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: '生成并绑定本租户' }));
  await screen.findByText('once-secret');
  const created = calls.find(([url]) => url === '/portal-api/applications')!;
  expect(JSON.parse(String(created[1]?.body))).toEqual({ note: '新应用' });
  expect(screen.getByText('Secret 只显示这一次，关闭后无法再次查看')).toBeTruthy();
  const clear = screen.getByRole('button', { name: '已保存，清除 Secret' }) as HTMLButtonElement;
  expect(clear.disabled).toBe(true);
  fireEvent.click(screen.getByRole('checkbox', { name: /我已安全保存本次 Secret/ }));
  fireEvent.click(clear);
  expect(screen.queryByText('once-secret')).toBeNull();
  fireEvent.click(await screen.findByRole('button', { name: '查看 订单应用 详情' }));
  fireEvent.click(await screen.findByRole('tab', { name: 'Token 与调用' }));
  await screen.findByRole('heading', { name: '准备调用身份' });
  expect(calls.some(([url]) => url === '/api/token' || url === '/api/token/introspect')).toBe(false);
  expect(calls.filter(([url]) => url.startsWith('/public-api/documents')).every(([, init]) => init?.credentials === 'omit' && !new Headers(init?.headers).has('Authorization'))).toBe(true);
  expect(screen.getByRole('link',{name:'浏览公开文档 ↗'}).getAttribute('href')).toBe('?section=documents');
  expect(screen.getByLabelText('AppSecret')).toBeTruthy();
  expect(calls.every(([url]) => !url.includes('secret') && !url.startsWith('/admin-api'))).toBe(true);
  expect(storage.mock.calls.every(([key, value]) => key.startsWith('portal.pending-create:') && /^\d+$/.test(value))).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '退出门户' }));
  expect(screen.queryByRole('button', { name: '查询文档' })).toBeNull();
  expect(screen.queryByText('客户用户')).toBeNull();
  expect(screen.queryByLabelText('AppSecret')).toBeNull();
  expect(screen.getByRole('heading', { name: '已退出门户工作区' })).toBeTruthy();
  expect(screen.getByRole('link', { name: '返回 API 文档' }).getAttribute('href')).toBe('?section=documents');
  storage.mockRestore();
});

test('正式调用取消/离开中止请求，不把迟到响应写入其他版本；业务响应过大拒绝', async () => {
  const { default: PublishedInvocation } = await import('./PublishedInvocation');
  const view = { releaseId: 'r1', stateVersion: 1, service: 'orders', version: 'v1', method: 'query', category: '订单', document: { id: 'a1', draftRevision: 1, title: '订单', path: '/api/oauth/orders/v1/query', httpMethod: 'POST', scopeCodes: [], requestSchema: { type: 'OBJECT' }, responseSchema: { type: 'OBJECT' }, errorDefinitions: [], requestExample: { orderNo: 'COMMON-001' }, responseExample: {} } };
  let signal: AbortSignal | undefined;
  vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => { signal = init.signal!; return new Promise(() => {}); }));
  const instance = render(<PublishedInvocation view={view} token="t" onUnauthorized={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: '调用正式接口' }));
  await waitFor(() => expect(signal).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: '取消等待' }));
  expect(signal?.aborted).toBe(true);
  expect(screen.getByRole('alert').textContent).toContain('服务端可能已执行');
  fireEvent.click(screen.getByRole('button', { name: '调用正式接口' }));
  await waitFor(() => expect(signal?.aborted).toBe(false));
  instance.unmount(); expect(signal?.aborted).toBe(true);
  vi.stubGlobal('fetch', vi.fn(async () => new Response('x'.repeat(2 * 1024 * 1024 + 1))));
  await expect(businessRequest('/api/token/introspect')).rejects.toThrow('响应正文超过');
});

test('业务凭据403不清平台会话，门户资格403仍清客户数据', async () => {
  const expire = vi.fn();
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ code: 40300003, resultMsg: '业务凭据无权限' }, { status: 403 })));
  await expect(createPortalApi('csrf16', expire)('/applications/bind', { method: 'POST', body: { appKey: application.appKey, appSecret: 'bad' } })).rejects.toThrow('业务凭据无权限');
  expect(expire).not.toHaveBeenCalled();
  let forbidden = false;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/platform-info') return ok({ name: 'API 开放平台', adminLoginUrl: null });
    if (url === '/portal-api/session') return ok(session);
    if (url === '/portal-api/creation-availability') return ok({available:true,defaultScopeCount:1});
    if (url === '/portal-api/applications/g1') return forbidden ? Response.json({code:40300001,resultMsg:'资格已取消'},{status:403}) : ok(application);
    if (url.startsWith('/portal-api/bindings/g1/users')) return ok({items:[],total:0,page:1,pageSize:20});
    if (url.startsWith('/portal-api/applications?')) return forbidden ? Response.json({ code: 40300001, resultMsg: '资格已取消' }, { status: 403 }) : ok({ items: [application], total: 1, page: 1, pageSize: 20 });
    return ok({ items: [], total: 0, page: 1, pageSize: 20 });
  }));
  render(themed(<Portal />));
  fireEvent.click(await screen.findByRole('button', { name: '查看 订单应用 详情' }));
  fireEvent.click(await screen.findByRole('tab', { name: 'Token 与调用' }));
  await screen.findByRole('heading', { name: '准备调用身份' });
  expect(screen.getByText('客户用户')).toBeTruthy();
  forbidden = true; fireEvent.click(screen.getByRole('button', { name: '刷新关联状态' }));
  await screen.findByRole('heading', { name: '暂无客户门户资格' });
  expect(screen.queryByText('客户用户')).toBeNull(); expect(screen.queryByRole('button', { name: '查询文档' })).toBeNull();
  expect(screen.queryByRole('heading', { name: '准备调用身份' })).toBeNull();
});

test('本租户关联的超安全整数授权版本可选应用且不丢精度', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/platform-info') return ok({ name: 'API 开放平台', adminLoginUrl: null });
    if (url === '/portal-api/session') return ok(session);
    if (url === '/portal-api/creation-availability') return ok({available:true,defaultScopeCount:1});
    if (url === '/portal-api/applications/g1') return new Response(JSON.stringify({code:200,data:application}).replace('\"authorizationVersion\":1','\"authorizationVersion\":9007199254740993'));
    if (url.startsWith('/portal-api/bindings/g1/users')) return ok({items:[],total:0,page:1,pageSize:20});
    if (url.startsWith('/public-api/documents')) return ok({ items: [], total: 0, page: 1, pageSize: 20 });
    return new Response('{"code":200,"data":{"items":[{"id":"g1","applicationId":"a1","appKey":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","name":"订单应用","note":"订单应用","applicationStatus":"ENABLED","status":"ACTIVE","authorizationVersion":9007199254740993,"scopes":[]}],"total":1,"page":1,"pageSize":20}}');
  }));
  render(themed(<Portal />));
  fireEvent.click(await screen.findByRole('button', { name: '查看 订单应用 详情' }));
  fireEvent.click(await screen.findByRole('tab', { name: 'Token 与调用' }));
  expect(await screen.findByRole('heading', { name: '准备调用身份' })).toBeTruthy();
  expect(location.search).toContain('credential=g1');
});

test('响应读取和cancel同时失败仍释放reader锁且保留原始错误', async () => {
  const releaseLock = vi.fn();
  const reader = { read: vi.fn().mockRejectedValue(new Error('stream disconnected')), cancel: vi.fn().mockRejectedValue(new Error('cancel rejected')), releaseLock };
  vi.stubGlobal('fetch', vi.fn(async () => ({ status: 200, ok: true, headers: new Headers(), body: { getReader: () => reader } })));
  await expect(businessRequest('/api/oauth/orders/v1/query')).rejects.toThrow('stream disconnected');
  expect(reader.cancel).toHaveBeenCalledOnce(); expect(releaseLock).toHaveBeenCalledOnce();
});

test('损坏响应仍显示HTTP与请求号，中文请求按字节限制且不会发送', async () => {
  const fetchMock = vi.fn(async () => new Response('not-json', { status: 502, headers: { 'X-Request-Id': 'broken-27' } }));
  vi.stubGlobal('fetch', fetchMock);
  await expect(businessRequest('/api/oauth/orders/v1/query')).rejects.toThrow('HTTP 502，请求号：broken-27');
  await expect(businessRequest('/api/oauth/orders/v1/query', { bodyText: JSON.stringify({ text: '中'.repeat(90_000) }) })).rejects.toThrow('256 KiB');
  expect(fetchMock).toHaveBeenCalledOnce();
});

const sessionFetch = (sessionReply: () => Response, loginUrl: string | null = 'https://login.example.test/login') => vi.fn(async (url: string) => {
  if (url === '/platform-info') return ok({ name: 'API 开放平台', adminLoginUrl: loginUrl });
  if (url === '/portal-api/session') return sessionReply();
  if (url === '/portal-api/applications/g1') return ok(application);
  if (url.startsWith('/portal-api/applications?')) return ok({ items: [application], total: 1, page: 1, pageSize: 20 });
  return ok({ items: [], total: 0, page: 1, pageSize: 20 });
});

test('本人会话显示姓名与租户名称，ID只在悬停提示中；缺少租户名称时回退显示租户ID', async () => {
  vi.stubGlobal('fetch', sessionFetch(() => ok({ ...session, tenantName: '华东租户' })));
  const view = render(themed(<Portal />));
  const identity = await screen.findByLabelText('当前登录身份');
  expect(within(identity).getByText('客户用户')).toBeTruthy();
  expect(within(identity).getByText('华东租户')).toBeTruthy();
  expect(within(identity).queryByText('101')).toBeNull();
  expect(within(identity).queryByText('u1')).toBeNull();
  view.unmount();
  vi.stubGlobal('fetch', sessionFetch(() => ok(session)));
  render(themed(<Portal />));
  expect(within(await screen.findByLabelText('当前登录身份')).getByText('101')).toBeTruthy();
});

test.each([
  ['未登录', () => Response.json({ code: 40100001 }, { status: 401 }), '请使用平台账号登录', '使用平台账号登录'],
  ['无资格', () => Response.json({ code: 40300001 }, { status: 403 }), '暂无客户门户资格', null],
  ['读取失败', () => new Response('bad gateway', { status: 502 }), '暂时无法验证登录', null],
] as const)('%s时显示统一状态页与下一步，不渲染任何凭据', async (_case, reply, title, loginLabel) => {
  const fetchMock = sessionFetch(reply);
  vi.stubGlobal('fetch', fetchMock);
  render(themed(<Portal />));
  expect(await screen.findByRole('heading', { name: title })).toBeTruthy();
  if (loginLabel) expect(screen.getByRole('link', { name: loginLabel }).getAttribute('href')).toBe('https://login.example.test/login');
  else expect(screen.queryByRole('link', { name: /登录/ })).toBeNull();
  expect(screen.getByRole('link', { name: '返回 API 文档' }).getAttribute('href')).toBe('?section=documents');
  expect(screen.queryByRole('button', { name: '生成新 AK' })).toBeNull();
  expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith('/portal-api/applications'))).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '重新验证登录与资格' }));
  await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => url === '/portal-api/session')).toHaveLength(2));
});

test('会话中途过期（401）就地提示登录已失效并清除凭据与Secret，给出重新登录、重新验证和返回文档', async () => {
  let expired = false;
  const fetchMock = vi.fn(async (url: string) => {
    if (url === '/platform-info') return ok({ adminLoginUrl: '/login' });
    if (url === '/portal-api/session') return expired ? Response.json({ code: 40100001 }, { status: 401 }) : ok(session);
    if (url === '/portal-api/applications/g1') return expired ? Response.json({ code: 40100001, resultMsg: '请先登录' }, { status: 401 }) : ok(application);
    return ok({ items: [application], total: 1, page: 1, pageSize: 20 });
  });
  vi.stubGlobal('fetch', fetchMock);
  render(themed(<Portal />));
  fireEvent.click(await screen.findByRole('button', { name: '查看 订单应用 详情' }));
  fireEvent.click(await screen.findByRole('tab', { name: 'Token 与调用' }));
  fireEvent.change(await screen.findByLabelText('AppSecret'), { target: { value: 'typed-secret' } });
  expired = true;
  fireEvent.click(screen.getByRole('button', { name: '刷新关联状态' }));
  expect(await screen.findByRole('heading', { name: '登录已失效' })).toBeTruthy();
  expect(screen.queryByDisplayValue('typed-secret')).toBeNull();
  expect(screen.queryByText('客户用户')).toBeNull();
  expect(screen.getByRole('link', { name: '重新登录' }).getAttribute('href')).toBe(`${location.origin}/login`);
  expect(screen.getByRole('link', { name: '返回 API 文档' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '重新验证登录与资格' }));
  expect(await screen.findByRole('heading', { name: '请使用平台账号登录' })).toBeTruthy();
});
