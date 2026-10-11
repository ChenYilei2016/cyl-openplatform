import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Blob as NodeBlob } from 'node:buffer';
import { createAdminApi } from '../access/api';
import { issueDebugToken } from './tokenApi';
import { rememberIdentity } from './identity';

// Publication metadata is independent from the operation under test.
function mockFetch(handler: (...args: any[]) => any) {
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => url.startsWith('/admin-api/publications/')
    ? Promise.resolve(Response.json({ code: 200, data: { liveReleaseId: null, enabled: true } })) : handler(url, init));
}
const capture = (value: unknown) => ({ available: true, truncated: false, redacted: false, value });
function diagnostic(data: unknown, revision = 4) {
  return { requestId: 'call-1', durationMillis: 23, draftRevision: revision, outcome: 'SUCCEEDED', providerDispatch: 'SENT', checks: [],
    mappedInput: capture({}), providerResponse: capture(data), adaptedData: capture(data), publicResponse: capture({ code: 200, data }), identity: null };
}

// jsdom 的 Blob 缺少 text()；使用 Node 原生实现验证真实有界响应读取。
beforeEach(() => {
  vi.stubGlobal('Blob', NodeBlob);
  rememberIdentity('token', null);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

test('业务 Token 过期显示原错误，不退出有效管理会话', async () => {
  mockFetch(
    vi.fn(async () =>
      Response.json(
        {
          code: 40100003,
          resultMsg: 'Token无效或已失效',
          requestId: 'debug-1',
        },
        { status: 401 },
      ),
    ),
  );
  const logout = vi.fn();
  const api = createAdminApi('csrf', logout);
  await expect(api('/apis/a/debug', { method: 'POST', body: {} })).rejects.toThrow(
    'Token无效或已失效',
  );
  expect(logout).not.toHaveBeenCalled();
});

test('调试固定已保存修订，凭据仅传Header，显示结果并能清空', async () => {
  const { default: DraftDebug } = await import('./DraftDebug');
  const fetchMock = vi.fn(async () =>
    Response.json({
      code: 200,
      data: diagnostic({ orderNo: 'COMMON-001' }),
    }),
  );
  mockFetch(fetchMock);
  render(
    <DraftDebug
      api={createAdminApi('csrf', vi.fn())}
      definition={{ id: 'api1', draftRevision: 4, name: '订单' }}
    />,
  );
  fireEvent.change(screen.getByLabelText('业务访问 Token'), {
    target: { value: 'private-token' },
  });
  fireEvent.change(screen.getByLabelText('调试请求 JSON'), {
    target: {
      value: '{"orderNo":"COMMON-001","amount":0.1234567890123456789}',
    },
  });
  expect(fetchMock).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '执行调试' }));
  expect(await screen.findByText('call-1')).toBeTruthy();
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe('/admin-api/apis/api1/debug');
  expect(new Headers(init.headers).get('Authorization')).toBe('Bearer private-token');
  expect(String(init.body)).toContain('"expectedRevision":4');
  expect(String(init.body)).toContain('0.1234567890123456789');
  expect(String(init.body)).not.toContain('private-token');
  expect((screen.getByLabelText('业务访问 Token') as HTMLInputElement).value).toBe('private-token');
  fireEvent.click(screen.getByRole('button', { name: '执行调试' }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  await screen.findByText('call-1');
  fireEvent.click(screen.getByRole('button', { name: '清除调试身份与结果' }));
  expect(screen.getByLabelText('业务访问 Token')).toHaveProperty('value', '');
  expect(screen.queryByText('call-1')).toBeNull();
  expect((screen.getByLabelText('调试请求 JSON') as HTMLTextAreaElement).value).toContain('COMMON-001');
});

test('草稿冲突保留输入并显示请求号，明确提示重新加载', async () => {
  const { default: DraftDebug } = await import('./DraftDebug');
  mockFetch(
    vi.fn(async () =>
      Response.json(
        {
          code: 40900001,
          resultMsg: '草稿已被修改，请重新加载后调试',
          requestId: 'call-conflict',
        },
        { status: 409 },
      ),
    ),
  );
  render(
    <DraftDebug
      api={createAdminApi('csrf', vi.fn())}
      definition={{ id: 'api1', draftRevision: 1, name: '订单' }}
    />,
  );
  fireEvent.change(screen.getByLabelText('业务访问 Token'), {
    target: { value: 'private-token' },
  });
  fireEvent.change(screen.getByLabelText('调试请求 JSON'), {
    target: { value: '{"orderNo":"COMMON-001"}' },
  });
  fireEvent.click(screen.getByRole('button', { name: '执行调试' }));
  expect((await screen.findByRole('alert')).textContent).toContain('call-conflict');
  expect(screen.getByRole('alert').textContent).toContain('重新加载');
  expect((screen.getByLabelText('调试请求 JSON') as HTMLTextAreaElement).value).toBe(
    '{"orderNo":"COMMON-001"}',
  );
  expect((screen.getByLabelText('业务访问 Token') as HTMLInputElement).value).toBe('private-token');
});

test('管理登录失效仍退出会话', async () => {
  mockFetch(
    vi.fn(async () =>
      Response.json({ code: 40100001, resultMsg: '请先登录管理后台' }, { status: 401 }),
    ),
  );
  const logout = vi.fn();
  await expect(
    createAdminApi('csrf', logout)('/apis/a/debug', {
      method: 'POST',
      body: {},
    }),
  ).rejects.toThrow('登录已失效');
  expect(logout).toHaveBeenCalledOnce();
});

test('按已保存修订读取本API请求示例，覆盖须确认且当前工作区复用原文', async () => {
  const { default: DraftDebug } = await import('./DraftDebug');
  const fetchMock = vi.fn(
    async (_url: string) =>
      new Response(
        '{"code":200,"data":{"draftRevision":4,"requestExample":{"sequence":9007199254740993,"amount":0.1234567890123456789}}}',
        { headers: { 'Content-Type': 'application/json' } },
      ),
  );
  mockFetch(fetchMock);
  render(
    <DraftDebug
      api={createAdminApi('csrf', vi.fn())}
      definition={{
        id: 'api1',
        draftRevision: 4,
        name: '订单',
        service: 'order',
        version: 'v1',
        method: 'get',
      }}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: '填入已保存请求示例' }));
  await screen.findByDisplayValue(/9007199254740993/);
  expect(screen.getByLabelText('调试请求 JSON')).toHaveProperty(
    'value',
    '{\n  "sequence": 9007199254740993,\n  "amount": 0.1234567890123456789\n}',
  );
  fireEvent.change(screen.getByLabelText('调试请求 JSON'), {
    target: { value: '{"keep":"我的测试输入"}' },
  });
  fireEvent.click(screen.getByRole('button', { name: '填入已保存请求示例' }));
  fireEvent.click(await screen.findByRole('button', { name: '取消，保留输入' }));
  expect(screen.getByLabelText('调试请求 JSON')).toHaveProperty('value', '{"keep":"我的测试输入"}');
  fireEvent.click(screen.getByRole('button', { name: '填入已保存请求示例' }));
  fireEvent.click(await screen.findByRole('button', { name: '确认替换测试输入' }));
  expect(screen.getByLabelText('调试请求 JSON').textContent).toContain('9007199254740993');
  expect(fetchMock).toHaveBeenCalledOnce();
  expect(fetchMock.mock.calls[0][0]).toBe('/admin-api/apis/api1/preview');
});

test('就近获取 Token 使用明确租户与已有委托，不携带后台登录、不自动测试，Secret 提交即清除', async () => {
  const { default: DraftDebug } = await import('./DraftDebug');
  const appKey = 'a'.repeat(32);
  let complete!: (response: Response) => void;
  const fetchMock = vi.fn((_url: string, _init?: RequestInit) => new Promise<Response>(resolve => { complete = resolve; }));
  mockFetch(fetchMock);
  render(<DraftDebug api={createAdminApi('csrf', vi.fn())} definition={{ id: 'api1', draftRevision: 1, name: '订单', scopeCodes: ['orders'] }} />);
  expect(screen.getByLabelText('业务访问 Token')).toHaveProperty('type', 'password');
  expect(screen.queryByLabelText('Secret（AppSecret）')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '用 AK / Secret 获取 Token' }));
  fireEvent.click(screen.getByRole('button',{name:'凭据从哪里来？'}));
  expect((await screen.findByRole('link',{name:'去门户查找凭据'})).getAttribute('href')).toBe('/portal/?section=settings');
  fireEvent.click(screen.getByRole('button',{name:'凭据从哪里来？'}));
  fireEvent.change(screen.getByLabelText('本次调用租户 ID'), { target: { value: '101' } });
  fireEvent.change(screen.getByLabelText('AK（AppKey）'), { target: { value: appKey } });
  fireEvent.change(screen.getByLabelText('Secret（AppSecret）'), { target: { value: 'private-secret' } });
  fireEvent.change(screen.getByLabelText('已获委托的员工号（可选）'), { target: { value: 'e1' } });
  fireEvent.click(screen.getByRole('button', { name: '获取并用于本次测试' }));
  expect(screen.getByLabelText('Secret（AppSecret）')).toHaveProperty('value', '');
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe('/api/token');
  expect(init?.credentials).toBe('omit');
  expect(init?.cache).toBe('no-store');
  expect(init?.redirect).toBe('error');
  expect(new Headers(init?.headers).has('Authorization')).toBe(false);
  expect(new Headers(init?.headers).has('X-CSRF-Token')).toBe(false);
  expect(JSON.parse(String(init?.body))).toEqual({ tenantId: '101', appKey, appSecret: 'private-secret', employeeNo: 'e1' });
  complete(Response.json({ code: 200, data: { accessToken: 'issued-private-token', expiresAt: '2027-01-01T00:00:00Z', context: { tenantId: '101', appKey, applicationId: 'a1', employeeNo: 'e1' } } }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '用 AK / Secret 获取 Token' })).toBeNull());
  await screen.findByText('租户 101 · 员工 e1');
  expect(screen.getByLabelText('业务访问 Token')).toHaveProperty('value','issued-private-token');
  expect(fetchMock).toHaveBeenCalledOnce();
  expect(document.body.textContent).not.toContain('issued-private-token');
  expect(document.body.textContent).not.toContain('private-secret');
  expect(localStorage.length).toBe(0);
  expect(sessionStorage.length).toBe(0);
});

test('获取失败给出请求号与下一步，不退出后台会话；取消后重新打开没有 Secret', async () => {
  const { default: DraftDebug } = await import('./DraftDebug');
  const logout = vi.fn();
  mockFetch(vi.fn(async () => Response.json({ code: 40100002, resultMsg: '应用凭据无效', requestId: 'issue-failed' }, { status: 401 })));
  render(<DraftDebug api={createAdminApi('csrf', logout)} definition={{ id: 'api1', draftRevision: 1, name: '订单' }} />);
  fireEvent.click(screen.getByRole('button', { name: '用 AK / Secret 获取 Token' }));
  fireEvent.change(screen.getByLabelText('本次调用租户 ID'), { target: { value: '101' } });
  fireEvent.change(screen.getByLabelText('AK（AppKey）'), { target: { value: 'a'.repeat(32) } });
  fireEvent.change(screen.getByLabelText('Secret（AppSecret）'), { target: { value: 'bad-secret' } });
  fireEvent.click(screen.getByRole('button', { name: '获取并用于本次测试' }));
  expect((await screen.findByRole('alert')).textContent).toContain('issue-failed');
  expect(screen.getByText(/凭据无效：核对 AK/)).toBeTruthy();
  expect(logout).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '已有 Token' }));
  expect(screen.getByLabelText('业务访问 Token')).toHaveProperty('value', '');
  fireEvent.click(screen.getByRole('button', { name: '用 AK / Secret 获取 Token' }));
  fireEvent.change(screen.getByLabelText('Secret（AppSecret）'), { target: { value: 'do-not-retain' } });
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  fireEvent.click(screen.getByRole('button', { name: '用 AK / Secret 获取 Token' }));
  expect(screen.getByLabelText('Secret（AppSecret）')).toHaveProperty('value', '');
});

test('业务 Token 明确失效清除身份，切 API、pagehide 与卸载不保留凭据', async () => {
  const { default: DraftDebug } = await import('./DraftDebug');
  const logout = vi.fn();
  const api = createAdminApi('csrf', logout);
  mockFetch(vi.fn(async () => Response.json({ code: 40100003, resultMsg: 'Token无效或已失效' }, { status: 401 })));
  const view = render(<DraftDebug api={api} definition={{ id: 'api1', draftRevision: 1, name: '订单' }} />);
  fireEvent.change(screen.getByLabelText('业务访问 Token'), { target: { value: 'expired-token' } });
  fireEvent.click(screen.getByRole('button', { name: '执行调试' }));
  await screen.findByRole('alert');
  expect(screen.getByLabelText('业务访问 Token')).toHaveProperty('value', '');
  expect(screen.getByRole('status').textContent).toContain('已失效');
  expect(logout).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('业务访问 Token'), { target: { value: 'api1-token' } });
  view.rerender(<DraftDebug api={api} definition={{ id: 'api2', draftRevision: 1, name: '商品' }} />);
  expect(screen.getByLabelText('业务访问 Token')).toHaveProperty('value', '');
  fireEvent.change(screen.getByLabelText('业务访问 Token'), { target: { value: 'api2-token' } });
  fireEvent.change(screen.getByLabelText('调试请求 JSON'), { target: { value: '{"orderNo":"KEEP"}' } });
  view.rerender(<DraftDebug api={api} isActive={false} definition={{ id: 'api2', draftRevision: 1, name: '商品' }} />);
  expect(screen.getByLabelText('业务访问 Token')).toHaveProperty('value', 'api2-token');
  expect(screen.getByLabelText('调试请求 JSON')).toHaveProperty('value', '{"orderNo":"KEEP"}');
  view.rerender(<DraftDebug api={api} isActive definition={{ id: 'api2', draftRevision: 1, name: '商品' }} />);
  fireEvent.click(screen.getByRole('button', { name: '用 AK / Secret 获取 Token' }));
  fireEvent.change(screen.getByLabelText('Secret（AppSecret）'), { target: { value: 'page-secret' } });
  fireEvent(window, new Event('pagehide'));
  expect(screen.getByLabelText('业务访问 Token')).toHaveProperty('value', '');
  expect(screen.queryByLabelText('Secret（AppSecret）')).toBeNull();
  view.unmount();
  render(<DraftDebug api={api} definition={{ id: 'api2', draftRevision: 1, name: '商品' }} />);
  expect(screen.getByLabelText('业务访问 Token')).toHaveProperty('value', '');
});

test('取消正在签发的请求后，晚到响应不能重新填入 Token', async () => {
  const { default: DraftDebug } = await import('./DraftDebug');
  let complete!: (response: Response) => void;
  const fetchMock = vi.fn((_url: string, _init?: RequestInit) => new Promise<Response>(resolve => { complete = resolve; }));
  mockFetch(fetchMock);
  render(<DraftDebug api={createAdminApi('csrf', vi.fn())} definition={{ id: 'api1', draftRevision: 1, name: '订单' }} />);
  fireEvent.click(screen.getByRole('button', { name: '用 AK / Secret 获取 Token' }));
  fireEvent.change(screen.getByLabelText('本次调用租户 ID'), { target: { value: '101' } });
  fireEvent.change(screen.getByLabelText('AK（AppKey）'), { target: { value: 'a'.repeat(32) } });
  fireEvent.change(screen.getByLabelText('Secret（AppSecret）'), { target: { value: 'private-secret' } });
  fireEvent.click(screen.getByRole('button', { name: '获取并用于本次测试' }));
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
  await act(async () => { complete(Response.json({ code: 200, data: { accessToken: 'late-token' } })); });
  expect(screen.getByLabelText('业务访问 Token')).toHaveProperty('value', '');
});

test('签发返回身份不匹配或有效期已过时拒绝使用', async () => {
  const credentials = { tenantId: '101', appKey: 'a'.repeat(32), appSecret: 'private-secret' };
  const token = { accessToken: 'private-token', expiresAt: '2027-01-01T00:00:00Z', context: { tenantId: 'other', appKey: credentials.appKey, applicationId: 'a1' } };
  const fetchMock = vi.fn(async () => Response.json({ code: 200, data: token }));
  mockFetch(fetchMock);
  await expect(issueDebugToken(credentials, new AbortController().signal)).rejects.toThrow('身份或有效期不正确');
  token.context.tenantId = '101';
  token.expiresAt = '2020-01-01T00:00:00Z';
  await expect(issueDebugToken(credentials, new AbortController().signal)).rejects.toThrow('身份或有效期不正确');
});

test('Token 异常响应超过 64 KiB 时拒绝解析', async () => {
  mockFetch(vi.fn(async () => new Response('x'.repeat(64 * 1024 + 1), { headers: { 'X-Request-Id': 'oversize-token' } })));
  await expect(issueDebugToken({ tenantId: '101', appKey: 'a'.repeat(32), appSecret: 'private-secret' }, new AbortController().signal)).rejects.toThrow('无法读取 Token 响应（HTTP 200，请求号：oversize-token）');
});

test('签发 Token 到期自动清除，保留在页面也不能继续复用', async () => {
  const { default: DraftDebug } = await import('./DraftDebug');
  vi.useFakeTimers();
  const expiresAt = new Date(Date.now() + 1000).toISOString();
  mockFetch(vi.fn(async () => Response.json({ code: 200, data: { accessToken: 'short-lived-token', expiresAt, context: { tenantId: '101', appKey: 'a'.repeat(32), applicationId: 'a1' } } })));
  render(<DraftDebug api={createAdminApi('csrf', vi.fn())} definition={{ id: 'api1', draftRevision: 1, name: '订单' }} />);
  fireEvent.click(screen.getByRole('button', { name: '用 AK / Secret 获取 Token' }));
  fireEvent.change(screen.getByLabelText('本次调用租户 ID'), { target: { value: '101' } });
  fireEvent.change(screen.getByLabelText('AK（AppKey）'), { target: { value: 'a'.repeat(32) } });
  fireEvent.change(screen.getByLabelText('Secret（AppSecret）'), { target: { value: 'private-secret' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '获取并用于本次测试' })); });
  expect(screen.getByLabelText('业务访问 Token')).toHaveProperty('value', 'short-lived-token');
  expect(screen.getByText('已核验')).toBeTruthy();
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(screen.getByLabelText('业务访问 Token')).toHaveProperty('value', '');
  expect(screen.getByRole('status').textContent).toContain('已到期');
});

test('改用AK时中止旧Token核验，晚到核验不收起正在填写的身份表单',async()=>{
  const {default:DraftDebug}=await import('./DraftDebug');
  let complete!:(r:Response)=>void;
  mockFetch(vi.fn(()=>new Promise<Response>(resolve=>{complete=resolve})));
  render(<DraftDebug api={createAdminApi('csrf',vi.fn())} definition={{id:'api1',draftRevision:1,name:'订单'}}/>);
  fireEvent.change(screen.getByLabelText('业务访问 Token'),{target:{value:'old-token'}});
  fireEvent.click(screen.getByRole('button',{name:'核验身份与有效期'}));
  fireEvent.click(screen.getByRole('button',{name:'用 AK / Secret 获取 Token'}));
  fireEvent.change(screen.getByLabelText('本次调用租户 ID'),{target:{value:'new-tenant'}});
  await act(async()=>complete(Response.json({code:200,data:{tenantId:'old-tenant',applicationId:'old-app',appKey:'old-key',expiresAt:'2027-01-01T00:00:00Z'}})));
  expect(screen.getByLabelText('本次调用租户 ID')).toHaveProperty('value','new-tenant');
  expect(screen.queryByRole('button',{name:'更换身份'})).toBeNull();
});

test('请求示例读取期间不能用旧输入抢先发起测试',async()=>{
 const {default:DraftDebug}=await import('./DraftDebug');
 let complete!:(response:Response)=>void;
 const fetchMock=vi.fn(async()=>new Promise<Response>(resolve=>{complete=resolve;}));
 mockFetch(fetchMock);
 render(<DraftDebug api={createAdminApi('csrf',vi.fn())} definition={{id:'api1',draftRevision:4,name:'订单',service:'order',version:'v1',method:'get'}}/>);
 fireEvent.change(screen.getByLabelText('业务访问 Token'),{target:{value:'test-token'}});
 fireEvent.click(screen.getByRole('button',{name:'填入已保存请求示例'}));
 expect(screen.getByRole('button',{name:'执行调试'})).toHaveProperty('disabled',true);
 fireEvent.click(screen.getByRole('button',{name:'执行调试'}));
 expect(fetchMock).toHaveBeenCalledTimes(1);
 complete(Response.json({code:200,data:{draftRevision:4,requestExample:{orderNo:'COMMON-001'}}}));
 await waitFor(()=>expect(screen.getByLabelText('调试请求 JSON')).toHaveProperty('value',expect.stringContaining('COMMON-001')));
 expect(screen.getByRole('button',{name:'执行调试'})).toHaveProperty('disabled',false);
 expect(fetchMock).toHaveBeenCalledTimes(1);
});
