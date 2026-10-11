import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import CustomerDocuments from './CustomerDocuments';
import DocumentContent from '@cyl/open-platform-web-shared/documentation/DocumentContent';
import { parseJson } from '@cyl/open-platform-web-shared/json';
import type { DocumentView } from '@cyl/open-platform-web-shared/documentation/types';

const response = (data: unknown) => Response.json({ code: 200, data });
const page = (items: unknown[]) => response({ items, total: items.length, page: 1, pageSize: 20 });
const view: DocumentView = { releaseId: 'r1', stateVersion: 1, service: 'orders', version: 'v01', method: 'query', category: '订单', document: { id: 'a1', draftRevision: 1, title: '订单查询契约', description: '公开业务说明', path: '/api/oauth/orders/v01/query', httpMethod: 'POST', scopeCodes: ['orders.read'], requestSchema: { type: 'OBJECT', properties: { orderId: { type: 'STRING', required: true } } }, responseSchema: { type: 'OBJECT', properties: { status: { type: 'STRING' } } }, requestExample: { orderId: 'order-001' }, responseExample: { status: 'PAID' }, errorDefinitions: [] } };
const summary = { apiId: 'a1', name: '查询订单', service: 'orders', version: 'v01', method: 'query', lifecycleStatus: 'ACTIVE' };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); localStorage.clear(); history.replaceState(null, '', '/'); });
/** 门户只匿名读取公开文档与平台公开地址（网关地址用于填充示例）。 */
const anonymousRead = (url: string) => url.startsWith('/public-api/documents') || url === '/platform-info';

test('登录后从可信门户会话读取专属文档，失效后清除正文并恢复公共范围', async () => {
  history.replaceState(null, '', '/portal/?section=documents&apiService=orders&apiVersion=v01&apiMethod=query');
  let authenticated = true;
  const calls: [string, RequestInit][] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    calls.push([url, init]);
    if (url === '/portal-api/session') return authenticated ? response({ tenantId: '101', employeeNo: 'E1', tenantName: '甲客户' }) : Response.json({ code: 401 }, { status: 401 });
    if (url === '/platform-info') return response({});
    if (url.startsWith('/portal-api/documents')) {
      if (url.endsWith('/view')) return response({ ...view, document: { ...view.document, title: '甲客户专属契约' } });
      return page(url.includes('/categories') ? [{ category: '订单', apiCount: 1 }] : [summary]);
    }
    if (url.endsWith('/view')) return Response.json({ code: 40400001, resultMsg: 'API不可见' }, { status: 404 });
    return page([]);
  }));
  render(<CustomerDocuments />);
  await screen.findByRole('heading', { name: '甲客户专属契约', level: 1 });
  const reads = calls.filter(([url]) => url.startsWith('/portal-api/documents'));
  expect(reads.length).toBeGreaterThan(0);
  expect(reads.every(([url, init]) => init.credentials === 'same-origin' && !url.includes('tenantId') && !new Headers(init.headers).has('Authorization'))).toBe(true);
  authenticated = false;
  await act(async () => window.dispatchEvent(new Event('focus')));
  await waitFor(() => expect(screen.queryByRole('heading', { name: '甲客户专属契约' })).toBeNull());
  expect(await screen.findByText('文档范围：公共通用 API')).toBeTruthy();
});

test('接口页只保留业务结构，默认推荐Token，六种语言切换保留焦点并反馈复制失败', async () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
  render(<DocumentContent document={view.document} operation={view} />);
  expect(screen.getByRole('region', { name: '请求参数' })).toBeTruthy();
  expect(within(screen.getByRole('region', { name: '响应体' })).getByRole('region', { name: '业务响应结构' })).toBeTruthy();
  expect(screen.getByLabelText('业务 JSON')).toBeTruthy();
  expect(screen.queryByText('推荐使用 Bearer Token')).toBeNull();
  expect(screen.queryByText('请求结构原始 JSON')).toBeNull();
  expect(screen.queryByText('业务响应结构原始 JSON')).toBeNull();
  expect(within(screen.getByRole('region', { name: '请求参数' })).getByRole('columnheader', { name: '字段路径' })).toBeTruthy();
  expect(screen.queryByRole('region', { name: '认证与权限' })).toBeNull();
  expect(screen.queryByText('展开网关完整响应外壳')).toBeNull();
  expect(screen.queryByRole('heading', { name: '业务请求示例' })).toBeNull();
  expect(screen.getByLabelText('cURL 调用示例').textContent).toContain('/api/oauth/orders/v01/query');
  const jsonTab = screen.getByRole('button', { name: 'JSON' });
  jsonTab.focus(); fireEvent.click(jsonTab);
  expect(document.activeElement).toBe(jsonTab);
  expect(screen.getByLabelText('业务请求示例').textContent).toContain('order-001');
  fireEvent.click(screen.getByRole('button', { name: 'cURL' }));
  expect(screen.getByLabelText('cURL 调用示例').textContent).toContain('Authorization: Bearer');
  for (const language of ['JavaScript', 'Python', 'PHP']) {
    const tab = screen.getByRole('button', { name: language });
    tab.focus(); fireEvent.click(tab);
    expect(document.activeElement).toBe(tab);
    expect(tab.getAttribute('aria-pressed')).toBe('true');
    const code = screen.getByLabelText(`${language} 调用示例`).textContent;
    expect(code).toContain('/api/oauth/orders/v01/query');
    expect(code).toContain('order-001');
    expect(code).toContain('OPEN_PLATFORM_TOKEN');
    expect(screen.queryByRole('radiogroup', { name: '认证方式' })).toBeNull();
  }
  expect(fetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Java 8+' }));
  const authentication = within(screen.getByRole('radiogroup', { name: '认证方式' }));
  expect((authentication.getByRole('radio', { name: 'OkHttp · Bearer Token（推荐）' }) as HTMLInputElement).checked).toBe(true);
  expect(screen.getByLabelText('Java 调用示例').textContent).toContain('okhttp3.OkHttpClient');
  expect(screen.getByLabelText('Java 调用示例').textContent).not.toContain('OpenPlatformClient');
  expect(screen.getByText('Maven 依赖 · OkHttp 4.12.0 / JDK 8+')).toBeTruthy();
  const hmac = authentication.getByRole('radio', { name: 'HMAC 签名（可选）' });
  hmac.focus(); fireEvent.click(hmac);
  expect(document.activeElement).toBe(hmac);
  expect(screen.getByLabelText('Java 调用示例').textContent).toContain('OPEN_PLATFORM_SIGNING_SECRET');
  fireEvent.click(screen.getByRole('button', { name: '复制Java 调用示例' }));
  await screen.findByText('复制失败，请选中下方代码手动复制。');
});

test('深链接读取精确外部版本，返回恢复筛选；刷新404立即清除旧正文及调试Token', async () => {
  const initial = '/portal/?query=orders&apiService=orders&apiVersion=v01&apiMethod=query';
  history.replaceState(null, '', initial);
  let available = true;
  const calls: [string, RequestInit | undefined][] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push([url, init]);
    if (url === '/api/token/introspect') return response({ tenantId: '101', applicationId: 'a1', appKey: 'a'.repeat(32), expiresAt: '2027-01-01T00:00:00Z' });
    if (url.endsWith('/view')) return available ? response(view) : Response.json({ code: 40400001, resultMsg: '文档不可用' }, { status: 404 });
    return page(url.includes('/categories') ? [{ category: '订单', apiCount: 1 }] : [summary, { ...summary, apiId: 'a2', version: 'v1' }]);
  }));
  render(<CustomerDocuments />);
  await screen.findByRole('heading', { name: '订单查询契约', level: 1 });
  expect(screen.getByLabelText('选择外部版本').closest('.ant-select')?.textContent).toContain('v01');
  const share = document.querySelector<HTMLDetailsElement>('.document-share')!;
  expect(share.open).toBe(false);
  share.open = true;
  expect(within(share).getByRole('button', { name: '下载 JSON' })).toBeTruthy();
  expect(within(share).getByRole('button', { name: '下载 HTML' })).toBeTruthy();
  expect(within(share).getByRole('button', { name: '打印 / 另存 PDF' })).toBeTruthy();
  expect(within(share).getByRole('button', { name: '复制文档链接' })).toBeTruthy();
  share.open = false;
  const navigation = screen.getByRole('navigation', { name: '本页目录' });
  expect(within(navigation).getAllByRole('link').map(link => link.textContent)).toEqual(['概览', '请求参数', '请求与响应示例', '响应参数', '在线调试']);
  expect(navigation.querySelector('a[href="#document-request"]')).toBeTruthy();
  expect(document.getElementById('document-sdk')).toBeNull();
  expect(screen.queryByLabelText('业务 Token')).toBeNull();
  const debug = document.querySelector<HTMLDetailsElement>('.document-debug')!;
  debug.open = true; fireEvent(debug, new Event('toggle'));
  fireEvent.change(await screen.findByLabelText('业务 Token'), { target: { value: 'only-in-memory' } });
  fireEvent.click(screen.getByRole('button', { name: '验证并使用 Token' }));
  await screen.findByRole('button', { name: '调用正式接口' });
  debug.open = false; fireEvent(debug, new Event('toggle'));
  await waitFor(() => expect(screen.queryByRole('button', { name: '调用正式接口' })).toBeNull());
  // 搜索即时生效：只替换当前历史记录，正在阅读的文档保留，左侧显示搜索结果。
  fireEvent.change(screen.getByLabelText('搜索 API 文档'), { target: { value: 'another' } });
  await waitFor(() => expect(new URLSearchParams(location.search).get('query')).toBe('another'));
  expect(screen.getByRole('region', { name: '搜索结果' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: '订单查询契约', level: 1 })).toBeTruthy();
  await act(async () => { history.replaceState(null, '', initial); window.dispatchEvent(new PopStateEvent('popstate')); });
  await screen.findByRole('heading', { name: '订单查询契约', level: 1 });
  await waitFor(() => expect((screen.getByLabelText('搜索 API 文档') as HTMLInputElement).value).toBe('orders'));
  available = false;
  fireEvent.click(screen.getByRole('button', { name: '刷新生效文档' }));
  await screen.findByText(/当前正文已清除/);
  expect(screen.queryByRole('heading', { name: '订单查询契约', level: 1 })).toBeNull();
  expect(calls.filter(([url]) => url !== '/api/token/introspect' && url !== '/portal-api/session').every(([url, init]) => anonymousRead(url) && init?.credentials === 'omit' && !new Headers(init.headers).has('Authorization'))).toBe(true);
  expect(calls.filter(([url]) => url === '/api/token/introspect')).toHaveLength(1);
});

test('SDK中心仍匿名读取并恢复资产链接，会话只影响租户文档范围', async () => {
  history.replaceState(null, '', '/portal/?section=sdk&sdkVersion=1.2.0&asset=sdk1');
  const asset = { id: 'sdk1', name: '平台 Java SDK', sdkVersion: '1.2.0', language: 'JAVA', runtime: 'Java 8+', kind: 'PLATFORM', status: 'PUBLISHED', revision: 2, sizeBytes: 1234, sha256: 'ab'.repeat(32), releaseNotes: '支持多API调用', publishedAt: '2026-09-15T00:00:00Z' };
  const calls: [string, RequestInit | undefined][] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push([url, init]);
    if (url === '/portal-api/session') return Response.json({ code: 401 }, { status: 401 });
    if (url === '/platform-info') return response({});
    return url.includes('?') ? page([asset]) : response(asset);
  }));
  render(<CustomerDocuments />);
  await screen.findByRole('button', { name: '下载 SDK 1.2.0' });
  expect(screen.getByText('支持多API调用')).toBeTruthy();
  expect(calls.filter(([url]) => url !== '/portal-api/session').every(([url, init]) => (url.startsWith('/public-api/sdk-assets') || url === '/platform-info') && init?.credentials === 'omit' && !url.includes('service=') && !new Headers(init.headers).has('Authorization'))).toBe(true);
  fireEvent.click(screen.getByRole('link', { name: '我的接入' }));
  await screen.findByRole('heading', { name: '请使用平台账号登录' });
  expect(calls.some(([url]) => url === '/portal-api/session')).toBe(true);
  expect(screen.queryByRole('button', { name: '下载 SDK 1.2.0' })).toBeNull();
});


test('接入指南深链只展示选中主题，公共响应与API业务正文分开', async () => {
  history.replaceState(null, '', '/portal/?section=guide#guide-response');
  render(<CustomerDocuments />);
  expect(await screen.findByRole('heading', { name: '接口约定与排障', level: 1 })).toBeTruthy();
  expect(screen.getByRole('heading', { name: '公共响应格式' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: '公共错误码与排障' })).toBeTruthy();
  expect(screen.queryByRole('heading', { name: 'Java SDK 初始化与使用' })).toBeNull();
  const topics = screen.getByRole('navigation', { name: '接入指南主题' });
  fireEvent.click(within(topics).getByRole('link', { name: 'SDK 与工具' }));
  expect(screen.getAllByText(/OPEN_PLATFORM_TOKEN/).length).toBeGreaterThan(0);
  expect(screen.getByText(/OPEN_PLATFORM_SIGNING_SECRET/)).toBeTruthy();
});

test('公开正文无需Token；验证失败保留正文、版本和SDK导航', async () => {
  history.replaceState(null, '', '/portal/?section=documents&apiService=orders&apiVersion=v01&apiMethod=query');
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(url);
    if (url === '/api/token/introspect') return Response.json({ code: 40100003, resultMsg: 'Token 无效', requestId: 'bad-token-27' }, { status: 401 });
    if (url.endsWith('/view')) return response(view);
    return page(url.includes('/categories') ? [{ category: '订单', apiCount: 1 }] : [summary]);
  }));
  render(<CustomerDocuments />);
  await screen.findByRole('heading', { name: '订单查询契约', level: 1 });
  expect(calls.filter(url => url !== '/portal-api/session').every(anonymousRead)).toBe(true);
  const debug = document.querySelector<HTMLDetailsElement>('.document-debug')!;
  expect(debug.open).toBe(false);
  fireEvent.click(within(screen.getByRole('navigation', { name: '本页目录' })).getByRole('link', { name: '在线调试' }));
  fireEvent(debug, new Event('toggle'));
  expect(debug.open).toBe(true);
  fireEvent.change(await screen.findByLabelText('业务 Token'), { target: { value: 'bad-token' } });
  fireEvent.click(screen.getByRole('button', { name: '验证并使用 Token' }));
  await screen.findByText(/Token 无效.*HTTP 401/);
  fireEvent.click(screen.getByRole('button', { name: '关闭错误提示' }));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByRole('heading', { name: '订单查询契约', level: 1 })).toBeTruthy();
  expect(screen.getByLabelText('选择外部版本').closest('.ant-select')?.textContent).toContain('v01');
  expect(within(screen.getByRole('navigation', { name: '门户导航' })).getByRole('link', { name: 'SDK' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: '调用正式接口' })).toBeNull();
  expect(calls.some(url => url !== '/portal-api/session' && (url.startsWith('/portal-api') || url.startsWith('/admin-api')))).toBe(false);
});


test('字段结构常驻上方，业务与完整JSON切换保留焦点且保精度复制', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  const businessJson = '{"orderId":9223372036854775807,"amount":0.1234567890123456789,"enabled":false,"count":0,"note":null}';
  const responseExample = parseJson(businessJson);
  render(<DocumentContent document={{ ...view.document, responseExample }} />);
  const responseRegion = screen.getByRole('region', { name: '响应体' });
  const response = within(responseRegion);
  expect(response.getByRole('button', { name: '业务 JSON' }).getAttribute('aria-pressed')).toBe('true');
  const schema = response.getByRole('region', { name: '业务响应结构' });
  expect(response.getByRole('region', { name: '业务响应结构' })).toBeTruthy();
  expect(response.getByLabelText('业务 JSON')).toBeTruthy();
  expect(response.queryByLabelText('完整响应 JSON')).toBeNull();
  expect(response.queryByText('业务响应结构原始 JSON')).toBeNull();

  for (const label of ['业务 JSON', '完整响应 JSON']) {
    const tab = response.getByRole('button', { name: label });
    tab.focus(); fireEvent.click(tab);
    expect(document.activeElement).toBe(tab);
    expect(tab.getAttribute('aria-pressed')).toBe('true');
    expect(response.getByRole('region', { name: '业务响应结构' })).toBe(schema);
    expect(responseRegion.querySelectorAll('pre')).toHaveLength(1);
    const content = response.getByLabelText(label).textContent!;
    expect(content).toContain('"orderId": 9223372036854775807');
    expect(content).toContain('"amount": 0.1234567890123456789');
    expect(content).toContain('"enabled": false');
    expect(content).toContain('"count": 0');
    expect(content).toContain('"note": null');
    if (label === '完整响应 JSON') {
      expect(parseJson(content)).toEqual({ code: 200, resultMsg: '成功', data: responseExample, requestId: '<本次请求标识>' });
      expect(response.getByText(/并非实际调用结果/)).toBeTruthy();
    } else expect(parseJson(content)).toEqual(responseExample);
    fireEvent.click(response.getByRole('button', { name: `复制${label}` }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(content));
    await response.findByText('已复制。');
  }
  expect(response.getByRole('region', { name: '业务响应结构' })).toBe(schema);
});

test.each([false, 0, null])('完整响应保留业务根值 %s', responseExample => {
  render(<DocumentContent document={{ ...view.document, responseExample }} />);
  fireEvent.click(screen.getByRole('button', { name: '完整响应 JSON' }));
  expect(parseJson(screen.getByLabelText('完整响应 JSON').textContent!)).toEqual({
    code: 200, resultMsg: '成功', data: responseExample, requestId: '<本次请求标识>',
  });
});

 test('刷新相同快照保留已验证身份和请求输入，刷新时禁止调用', async () => {
  history.replaceState(null, '', '/portal/?apiService=orders&apiVersion=v01&apiMethod=query');
  let refreshReply: ((value: Response) => void) | undefined;
  let reads = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/token/introspect') return response({ tenantId: '101', applicationId: 'a1', appKey: 'a'.repeat(32), expiresAt: '2027-01-01T00:00:00Z' });
    if (url.endsWith('/view')) { if (++reads > 1) return new Promise<Response>(resolve => { refreshReply = resolve; }); return response(view); }
    return page(url.includes('categories') ? [] : [summary]);
  }));
  render(<CustomerDocuments />);
  await screen.findByRole('heading', { name: '订单查询契约', level: 1 });
  fireEvent.click(screen.getByRole('link', { name: '在线调试' }));
  const debug = document.querySelector<HTMLDetailsElement>('.document-debug')!; fireEvent(debug, new Event('toggle'));
  fireEvent.change(await screen.findByLabelText('业务 Token'), { target: { value: 'private-test-token' } });
  fireEvent.click(screen.getByRole('button', { name: '验证并使用 Token' }));
  fireEvent.change(await screen.findByLabelText('正式调用请求 JSON'), { target: { value: '{"orderId":"keep-input"}' } });
  fireEvent.click(screen.getByRole('button', { name: '刷新生效文档' }));
  await waitFor(() => expect(refreshReply).toBeTruthy());
  expect(screen.getByRole('button', { name: '调用正式接口' })).toHaveProperty('disabled', true);
  await act(async () => refreshReply!(response(view)));
  expect(screen.getByRole('region', { name: '已验证的调用身份' })).toBeTruthy();
  expect(screen.getByLabelText('正式调用请求 JSON')).toHaveProperty('value', '{"orderId":"keep-input"}');
  expect(screen.getByRole('button', { name: '调用正式接口' })).toHaveProperty('disabled', false);
 });
