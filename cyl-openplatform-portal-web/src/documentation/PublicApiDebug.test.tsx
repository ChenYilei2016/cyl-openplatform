import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import PublicApiDebug from './PublicApiDebug';
import PublishedInvocation from '../portal/PublishedInvocation';
import type { DocumentView } from '@cyl/open-platform-web-shared/documentation/types';

const appKey = 'a'.repeat(32);
const context = { tenantId: '101', applicationId: 'app1', appKey, employeeNo: null, expiresAt: '2027-01-01T00:00:00Z' };
const view: DocumentView = { releaseId: 'r1', stateVersion: 1, service: 'orders', version: 'v01', method: 'query', category: '订单', document: { id: 'a1', draftRevision: 1, title: '订单查询契约', path: '/api/oauth/orders/v01/query', httpMethod: 'POST', scopeCodes: [], requestSchema: { type: 'OBJECT' }, responseSchema: { type: 'OBJECT' }, requestExample: { id: '1' }, responseExample: {}, errorDefinitions: [] } };
const ok = (data: unknown) => Response.json({ code: 200, data, requestId: 'trace-27' });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
/** 调试凭据方式为单选按钮组：按可见名称选择。 */
const mode = (name: string) => within(screen.getByRole('radiogroup', { name: '调试凭据方式' })).getByRole('radio', { name }) as HTMLInputElement;
const personDetails = () => screen.getByText('需要以已获委托的人员身份调用').closest('details')!;
async function expand() {
  const details = document.querySelector<HTMLDetailsElement>('.document-debug')!;
  details.open = true; fireEvent(details, new Event('toggle'));
  await screen.findByLabelText('业务 Token');
  return details;
}
async function authenticate() {
  fireEvent.change(screen.getByLabelText('业务 Token'), { target: { value: 'private-token' } });
  fireEvent.click(screen.getByRole('button', { name: '验证并使用 Token' }));
  await screen.findByRole('button', { name: '调用正式接口' });
}
function useAk() {
  fireEvent.click(mode('用 AK / Secret 获取 Token'));
  fireEvent.change(screen.getByLabelText('调用租户 ID'), { target: { value: '101' } });
  fireEvent.change(screen.getByLabelText('AppKey'), { target: { value: appKey } });
  fireEvent.change(screen.getByLabelText('AppSecret'), { target: { value: 'private-secret' } });
}

test('默认收起无请求；验证已有Token不受预填租户约束，元数据可信且业务调用必须点击', async () => {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ok({ ...context, tenantId: 'other-tenant' }));
  vi.stubGlobal('fetch', fetchMock);
  const storage = vi.spyOn(Storage.prototype, 'setItem');
  render(<PublicApiDebug view={view} initialTenantId="101" />);
  expect(document.querySelector<HTMLDetailsElement>('.document-debug')!.open).toBe(false);
  expect(screen.queryByLabelText('业务 Token')).toBeNull(); expect(fetchMock).not.toHaveBeenCalled();
  await expand();
  expect(mode('使用已有 Token（推荐）').checked).toBe(true);
  expect(screen.queryByLabelText('AppSecret')).toBeNull();
  await authenticate();
  expect(screen.getByRole('region', { name: '已验证的调用身份' }).textContent).toContain('other-tenant');
  expect(fetchMock).toHaveBeenCalledOnce();
  expect(fetchMock.mock.calls[0][0]).toBe('/api/token/introspect');
  const init = fetchMock.mock.calls[0][1] as RequestInit;
  expect(init.credentials).toBe('omit'); expect(init.redirect).toBe('error');
  expect(init.body).toBe('{}'); expect(new Headers(init.headers).get('Authorization')).toBe('Bearer private-token');
  expect(document.body.textContent).not.toContain('private-token'); expect(storage).not.toHaveBeenCalled();
});

test('无效Token只清调试状态，AK失败清Secret，不请求本地账号身份或自动委托', async () => {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({ code: 40100003, resultMsg: '凭据失效', requestId: 'invalid-27' }, { status: 401 }));
  vi.stubGlobal('fetch', fetchMock);
  render(<><p>公开契约正文</p><a href="?section=sdk">公开 SDK</a><PublicApiDebug view={view} /></>);
  await expand();
  fireEvent.change(screen.getByLabelText('业务 Token'), { target: { value: 'invalid-token' } });
  fireEvent.click(screen.getByRole('button', { name: '验证并使用 Token' }));
  await screen.findByRole('alert');
  expect(screen.getByRole('alert').textContent).toContain('HTTP 401');
  expect((screen.getByLabelText('业务 Token') as HTMLInputElement).value).toBe('');
  useAk();
  fireEvent.click(screen.getByRole('button', { name: '获取并使用 Token' }));
  expect((screen.getByLabelText('AppSecret') as HTMLInputElement).value).toBe('');
  await screen.findByRole('alert');
  expect(screen.getByText('公开契约正文')).toBeTruthy(); expect(screen.getByRole('link', { name: '公开 SDK' })).toBeTruthy();
  expect(fetchMock.mock.calls.map(call => call[0])).toEqual(['/api/token/introspect', '/api/token']);
  expect(screen.queryByRole('button', { name: '调用正式接口' })).toBeNull();
});

test('匿名AK明确发送租户和已有委托人员，验证签发回包且立即清Secret', async () => {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ok({ accessToken: 'issued-token', context: { ...context, employeeNo: 'e1' } }));
  vi.stubGlobal('fetch', fetchMock);
  render(<PublicApiDebug view={view} />); await expand(); useAk();
  const person = personDetails();
  person.open = true;
  fireEvent.change(screen.getByLabelText('已获委托的员工号（可选）'), { target: { value: 'e1' } });
  fireEvent.click(screen.getByRole('button', { name: '获取并使用 Token' }));
  expect((screen.getByLabelText('AppSecret') as HTMLInputElement).value).toBe('');
  await screen.findByRole('button', { name: '调用正式接口' });
  const [path, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(path).toBe('/api/token'); expect(JSON.parse(String(init.body))).toEqual({ tenantId: '101', appKey, appSecret: 'private-secret', employeeNo: 'e1' });
  expect(new Headers(init.headers).has('Authorization')).toBe(false);
  expect(screen.getByRole('region', { name: '已验证的调用身份' }).textContent).toContain('员工 e1');
  fireEvent.click(screen.getByRole('button', { name: '清除调试身份' }));
  expect((screen.getByLabelText('AppSecret') as HTMLInputElement).value).toBe('');
});

test.each([
  { tenantId: 'other' }, { appKey: 'b'.repeat(32) }, { employeeNo: 'unrequested-employee' },
])('拒绝AK签发上下文不一致 %j', async changed => {
  vi.stubGlobal('fetch', vi.fn(async (_url: string, _init?: RequestInit) => ok({ accessToken: 'issued-token', context: { ...context, ...changed } })));
  render(<PublicApiDebug view={view} />); await expand(); useAk();
  fireEvent.click(screen.getByRole('button', { name: '获取并使用 Token' }));
  await screen.findByText(/签发返回的租户、AppKey 或人员身份与请求不一致/);
  expect(screen.queryByRole('button', { name: '调用正式接口' })).toBeNull();
});

test('正式调用保精度并显示HTTP和requestId，403只影响本次调用，401清身份及结果', async () => {
  let status = 200;
  const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
    if (url === '/api/token/introspect') return ok(context);
    return status === 200 ? new Response('{"code":200,"data":{"id":9007199254740993},"requestId":"success-27"}')
      : Response.json({ code: status * 100000 + 3, resultMsg: '无权调用', requestId: 'failure-27' }, { status });
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<><p>平台账号仍登录</p><p>公开正文</p><PublicApiDebug view={view} /></>); await expand(); await authenticate();
  fireEvent.change(screen.getByLabelText('正式调用请求 JSON'), { target: { value: '{"id":9007199254740993,"amount":1.1234567890123456789}' } });
  fireEvent.click(screen.getByRole('button', { name: '调用正式接口' }));
  const result = await screen.findByRole('region', { name: '正式调用结果' });
  expect(result.textContent).toContain('9007199254740993'); expect(result.textContent).toContain('success-27');
  expect(within(result).getByLabelText('HTTP 状态 200').className).toContain('op-http-status--success'); expect(result.textContent).toMatch(/\d+ ms/);
  const init = fetchMock.mock.calls[1][1] as RequestInit;
  expect(String(init.body)).toContain('1.1234567890123456789');
  await waitFor(() => expect(screen.getByRole('button', { name: '调用正式接口' })).toHaveProperty('disabled', false));
  status = 403; fireEvent.click(screen.getByRole('button', { name: '调用正式接口' }));
  await screen.findByRole('alert'); expect(screen.getByRole('alert').textContent).toContain('HTTP 403'); expect(screen.getByRole('alert').textContent).toContain('failure-27');
  expect(screen.getByLabelText('HTTP 状态 403').className).toContain('op-http-status--warning');
  expect(screen.getByRole('region', { name: '已验证的调用身份' })).toBeTruthy(); expect(screen.getByText('平台账号仍登录')).toBeTruthy();
  expect(screen.queryByRole('region', { name: '正式调用结果' })).toBeNull();
  status = 401; fireEvent.click(screen.getByRole('button', { name: '调用正式接口' }));
  await screen.findByText(/业务 Token 已失效，调用身份与结果已清除/);
  expect(screen.queryByRole('region', { name: '已验证的调用身份' })).toBeNull();
  expect(screen.getByText('公开正文')).toBeTruthy(); expect(screen.getByText('平台账号仍登录')).toBeTruthy();
  expect(fetchMock).toHaveBeenCalledTimes(4);
});

test.each(['mode', 'collapse', 'api', 'leave'])('切换%s中止验证并丢弃晚响应，重新展开没有秘密', async action => {
  let resolve!: (response: Response) => void; let signal!: AbortSignal;
  vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => { signal = init.signal!; return new Promise<Response>(done => { resolve = done; }); }));
  const instance = render(<PublicApiDebug view={view} />); const details = await expand(); useAk();
  fireEvent.click(screen.getByRole('button', { name: '获取并使用 Token' }));
  expect((screen.getByLabelText('AppSecret') as HTMLInputElement).value).toBe('');
  if (action === 'mode') fireEvent.click(mode('使用已有 Token（推荐）'));
  if (action === 'collapse') { details.open = false; fireEvent(details, new Event('toggle')); }
  if (action === 'api') instance.rerender(<PublicApiDebug view={{ ...view, version: 'v02' }} />);
  if (action === 'leave') instance.unmount();
  await waitFor(() => expect(signal.aborted).toBe(true));
  await act(async () => resolve(ok({ accessToken: 'late-secret', context })));
  expect(screen.queryByRole('button', { name: '调用正式接口' })).toBeNull(); expect(document.body.textContent).not.toContain('late-secret');
  if (action === 'collapse' || action === 'api') await expand();
  if (action !== 'leave') expect((screen.getByLabelText('业务 Token') as HTMLInputElement).value).toBe('');
});

test('切换API或Token中止执行且晚到401不会清新身份', async () => {
  let resolve!: (response: Response) => void; let signal!: AbortSignal; const clear = vi.fn();
  vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => { signal = init.signal!; return new Promise<Response>(done => { resolve = done; }); }));
  const instance = render(<PublishedInvocation view={view} token="old" onUnauthorized={clear} />);
  fireEvent.click(screen.getByRole('button', { name: '调用正式接口' }));
  instance.rerender(<PublishedInvocation view={{ ...view, version: 'v2' }} token="new" onUnauthorized={clear} />);
  expect(signal.aborted).toBe(true);
  await act(async () => resolve(Response.json({ code: 40100003 }, { status: 401 })));
  expect(clear).not.toHaveBeenCalled(); expect(screen.queryByRole('alert')).toBeNull(); expect(screen.queryByRole('region', { name: '正式调用结果' })).toBeNull();
});

test('显式撤销当前Token保留公开阅读与SDK链接，配置入口仍核对租户应用', async () => {
  const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => ok(url === '/api/token/introspect' ? context : null));
  vi.stubGlobal('fetch', fetchMock);
  const instance = render(<PublicApiDebug view={view} constraint={{ tenantId: 'other', appKey, applicationId: 'app1' }} />); await expand();
  fireEvent.change(screen.getByLabelText('业务 Token'), { target: { value: 'private-token' } }); fireEvent.click(screen.getByRole('button', { name: '验证并使用 Token' }));
  await screen.findByText('Token 不属于当前租户或所选应用。');
  instance.rerender(<PublicApiDebug view={view} constraint={{ tenantId: '101', appKey, applicationId: 'app1' }} renderAuthenticated={() => <span>历史 SDK 入口</span>} />);
  await expand(); await authenticate(); expect(screen.getByText('历史 SDK 入口')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '撤销当前 Token' }));
  await screen.findByText('当前业务 Token 已撤销。');
  expect(fetchMock.mock.calls.at(-1)?.[0]).toBe('/api/token/revoke');
  expect(screen.getByRole('link', { name: 'Java 接入示例' })).toBeTruthy(); expect(screen.queryByRole('button', { name: '调用正式接口' })).toBeNull();
});

test('旧身份SDK迟到失效回调不会清新身份；pagehide清秘密和调用结果', async () => {
  const invalidations: (() => void)[] = [];
  vi.stubGlobal('fetch', vi.fn(async () => ok(context)));
  render(<PublicApiDebug view={view} renderAuthenticated={(_token, onUnauthorized) => { invalidations.push(onUnauthorized); return null; }} />);
  await expand(); await authenticate();
  const stale = invalidations.at(-1)!;
  fireEvent.click(screen.getByRole('button', { name: '清除调试身份' }));
  await authenticate();
  act(() => stale());
  expect(screen.getByRole('region', { name: '已验证的调用身份' })).toBeTruthy();
  act(() => window.dispatchEvent(new Event('pagehide')));
  expect(screen.queryByRole('region', { name: '已验证的调用身份' })).toBeNull();
  expect((screen.getByLabelText('业务 Token') as HTMLInputElement).value).toBe('');
});


test('必须员工接口前置拒绝租户Token，AK模式展开必填工号', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ok(context)));
  render(<PublicApiDebug view={{ ...view, document: { ...view.document, employeeRequired: true } }} />);
  await expand();
  fireEvent.change(screen.getByLabelText('业务 Token'), { target: { value: 'tenant-token' } });
  fireEvent.click(screen.getByRole('button', { name: '验证并使用 Token' }));
  expect((await screen.findByRole('alert')).textContent).toContain('必须使用人员 Token');
  expect(screen.queryByRole('button', { name: '调用正式接口' })).toBeNull();
  fireEvent.click(mode('用 AK / Secret 获取 Token'));
  expect((screen.getByLabelText('已获委托的员工号（必填）') as HTMLInputElement).required).toBe(true);
  expect(personDetails().open).toBe(true);
});

test('JSON错误在调用前显示，修正后只发送一次正式请求', async () => {
  const calls = vi.fn(async () => ok({ success: true }));
  vi.stubGlobal('fetch', calls);
  render(<PublishedInvocation view={view} token="test-token" onUnauthorized={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('正式调用请求 JSON'), { target: { value: '{bad' } });
  expect(screen.getByLabelText('正式调用请求 JSON').getAttribute('aria-invalid')).toBe('true');
  expect(screen.getByRole('button', { name: '调用正式接口' })).toHaveProperty('disabled', true);
  expect(calls).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('正式调用请求 JSON'), { target: { value: '{}' } });
  fireEvent.click(screen.getByRole('button', { name: '调用正式接口' }));
  await screen.findByRole('region', { name: '正式调用结果' });
  expect(calls).toHaveBeenCalledTimes(1);
});

test('参数表单与请求JSON同步且保精度，复制为代码带网关地址与当前请求、不含Token，发送当前正文', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => ok(url === '/api/token/introspect' ? context : { done: true }));
  vi.stubGlobal('fetch', fetchMock);
  const formView: DocumentView = { ...view, document: { ...view.document, requestSchema: { type: 'OBJECT', properties: { id: { type: 'STRING', required: true }, amount: { type: 'NUMBER' }, paid: { type: 'BOOLEAN' }, items: { type: 'ARRAY', items: { type: 'STRING' } } } } } };
  render(<PublicApiDebug view={formView} gatewayBaseUrl="https://gw.example.test/" />);
  await expand();
  expect(screen.queryByLabelText('参数 items')).toBeNull();
  fireEvent.change(screen.getByLabelText('参数 id（必填）'), { target: { value: 'order-9' } });
  fireEvent.change(screen.getByLabelText('参数 amount'), { target: { value: '12345678901234567890.123' } });
  fireEvent.click(within(screen.getByRole('radiogroup', { name: '参数 paid' })).getByRole('radio', { name: 'true' }));
  const json = screen.getByLabelText('正式调用请求 JSON') as HTMLTextAreaElement;
  expect(json.value).toBe('{\n  "id": "order-9",\n  "amount": 12345678901234567890.123,\n  "paid": true\n}');
  fireEvent.change(screen.getByLabelText('参数 amount'), { target: { value: '12a' } });
  expect(screen.getByText('请输入数字，未写入请求 JSON。')).toBeTruthy();
  expect(json.value).toContain('12345678901234567890.123');
  const code = within(screen.getByRole('region', { name: '复制为代码' }));
  fireEvent.click(code.getByRole('button', { name: '复制cURL代码' }));
  await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
  const curl = writeText.mock.calls[0][0] as string;
  expect(curl).toContain("--url 'https://gw.example.test/api/oauth/orders/v01/query'");
  expect(curl).toContain('"amount": 12345678901234567890.123');
  expect(curl).toContain('Authorization: Bearer ${OPEN_PLATFORM_TOKEN}');
  fireEvent.click(code.getByRole('tab', { name: 'Python' }));
  expect(screen.getByRole('region', { name: '复制为代码' }).querySelector('pre')?.textContent).toContain('base_url = "https://gw.example.test/"');
  await authenticate();
  fireEvent.click(screen.getByRole('button', { name: '调用正式接口' }));
  await screen.findByRole('region', { name: '正式调用结果' });
  expect(String((fetchMock.mock.calls[1][1] as RequestInit).body)).toBe('{"id":"order-9","amount":12345678901234567890.123,"paid":true}');
  expect(document.body.textContent).not.toContain('private-token');
  fireEvent.change(json, { target: { value: '{bad' } });
  expect(screen.getByLabelText('参数 id（必填）')).toHaveProperty('disabled', true);
  expect(screen.getByRole('button', { name: '调用正式接口' })).toHaveProperty('disabled', true);
  expect(within(screen.getByRole('region', { name: '复制为代码' })).getByText('请求 JSON 有误，修正后生成代码。')).toBeTruthy();
});
