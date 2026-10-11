import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import type { ApiDocument, DocumentSummary, DocumentView } from '@cyl/open-platform-web-shared/documentation/types';
import CustomerDocuments from './CustomerDocuments';
import { formatSearch, parseSearch } from './docSearch';

vi.mock('./PublicApiDebug', () => ({ default: () => <details id="document-debug" className="document-debug"><summary>在线调试</summary></details> }));
const response = (data: unknown) => Response.json({ code: 200, data });
const summary = (version: string, lifecycleStatus: DocumentSummary['lifecycleStatus'] = 'ACTIVE'): DocumentSummary => ({ apiId: `a-${version}`, releaseId: `r-${version}`, stateVersion: 1, draftRevision: 1, name: `查询订单 ${version}`, category: '订单', service: 'orders', version, method: 'query', lifecycleStatus });
const deprecated = new Set<string>();
const view = (version: string): DocumentView => ({ releaseId: `r-${version}`, stateVersion: 1, service: 'orders', version, method: 'query', category: '订单', document: { id: 'a1', draftRevision: 1, title: `订单查询 ${version}`, path: `/api/oauth/orders/${version}/query`, httpMethod: 'POST', scopeCodes: [], requestSchema: { type: 'OBJECT' }, responseSchema: { type: 'OBJECT' }, requestExample: { orderNo: 'A1' }, responseExample: {}, errorDefinitions: [{ code: 'ORDER_MISSING', message: '订单不存在' }], ...(deprecated.has(version) ? { lifecycle: { status: 'DEPRECATED', compatibility: 'UNSPECIFIED' } as ApiDocument['lifecycle'] } : {}) } });
afterEach(() => { deprecated.clear(); cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); localStorage.clear(); history.replaceState(null, '', '/'); });

function serve(items: DocumentSummary[]) {
  const calls: URL[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    const url = new URL(input, location.origin); calls.push(url);
    if (url.pathname === '/platform-info') return response({ gatewayBaseUrl: 'https://gw.example.test/' });
    if (url.pathname.endsWith('/view')) {
      const version = url.pathname.split('/').at(-3)!;
      const result = view(version);
      if (items.some(item => item.version === version && item.mcpSupported)) result.document.mcp = { name: `orders_query_${version}`, description: '查询当前租户订单' };
      return response(result);
    }
    if (url.pathname.endsWith('/categories')) return response({ items: [{ category: '订单', apiCount: items.length }], total: 1, page: 1, pageSize: 20 });
    const matched = items.filter(item => (url.searchParams.get('mcpOnly') !== 'true' || item.mcpSupported) && ['service', 'method', 'version'].every(name => !url.searchParams.get(name) || item[name as 'service'] === url.searchParams.get(name)));
    return response({ items: matched, total: matched.length, page: 1, pageSize: 20 });
  }));
  return calls;
}

test('搜索语法：service.method 简写、字段前缀与关键词可互相转换', () => {
  expect(parseSearch('orders.query 订单')).toEqual({ service: 'orders', method: 'query', version: '', query: '订单' });
  expect(parseSearch('service:a.b version:v1')).toEqual({ service: 'a.b', method: '', version: 'v1', query: '' });
  expect(parseSearch('  查询  订单 ')).toEqual({ service: '', method: '', version: '', query: '查询 订单' });
  expect(formatSearch({ service: 'orders', method: 'query', version: 'v1', query: '订单' })).toBe('orders.query version:v1 订单');
  expect(formatSearch({ service: 'a.b', method: 'query', version: '', query: '' })).toBe('service:a.b method:query');
  expect(parseSearch(formatSearch({ service: 'a.b', method: 'query', version: '', query: '' }))).toEqual({ service: 'a.b', method: 'query', version: '', query: '' });
});

test('链接带 service、method 且唯一匹配时直接打开文档（替换历史记录），地址与示例自动填入网关', async () => {
  history.replaceState(null, '', '/portal/?service=orders&method=query');
  const before = history.length;
  serve([summary('v1')]);
  render(<CustomerDocuments />);
  expect(await screen.findByRole('heading', { name: '订单查询 v1', level: 1 })).toBeTruthy();
  const params = new URLSearchParams(location.search);
  expect([params.get('apiService'), params.get('apiVersion'), params.get('apiMethod'), params.get('category')]).toEqual(['orders', 'v1', 'query', '订单']);
  expect(history.length).toBe(before);
  await waitFor(() => expect(document.querySelector('.op-doc__endpoint code')?.textContent).toBe('https://gw.example.test/api/oauth/orders/v1/query'));
  expect(document.querySelector('.op-doc__endpoint .op-method--post')?.textContent).toBe('POST');
  expect(document.querySelector('#document-examples .op-code-block__pre')?.textContent).toContain("'https://gw.example.test/api/oauth/orders/v1/query'");
  expect(screen.getByText('正常')).toBeTruthy();
});

test('未指定版本时取唯一的正常服务版本；指定版本时精确打开', async () => {
  history.replaceState(null, '', '/portal/?service=orders&method=query');
  deprecated.add('v1');
  serve([summary('v1', 'DEPRECATED'), summary('v2')]);
  const first = render(<CustomerDocuments />);
  expect(await screen.findByRole('heading', { name: '订单查询 v2', level: 1 })).toBeTruthy();
  first.unmount();
  history.replaceState(null, '', '/portal/?service=orders&method=query&version=v1');
  render(<CustomerDocuments />);
  expect(await screen.findByRole('heading', { name: '订单查询 v1', level: 1 })).toBeTruthy();
  expect(within(document.querySelector<HTMLElement>('.op-doc__header')!).getByText('已废弃')).toBeTruthy();
});

test('多个正常版本时提示选择版本，无匹配时说明并可清空搜索', async () => {
  history.replaceState(null, '', '/portal/?service=orders&method=query');
  const calls = serve([summary('v1'), summary('v2')]);
  const first = render(<CustomerDocuments />);
  expect(await screen.findByRole('heading', { name: 'orders.query 有多个版本', level: 1 })).toBeTruthy();
  expect(screen.getByText(/链接未指定版本，且有多个可用版本/)).toBeTruthy();
  const list = within(screen.getByRole('region', { name: '搜索结果列表' }));
  expect(list.getAllByRole('button').map(button => button.querySelector('code')?.textContent)).toEqual(['orders.query · v1', 'orders.query · v2']);
  expect(calls.some(url => url.pathname.endsWith('/view'))).toBe(false);
  fireEvent.click(list.getByRole('button', { name: /v2/ }));
  expect(await screen.findByRole('heading', { name: '订单查询 v2', level: 1 })).toBeTruthy();
  first.unmount();
  history.replaceState(null, '', '/portal/?service=orders&method=missing');
  render(<CustomerDocuments />);
  expect(await screen.findByText('没有找到 orders.missing')).toBeTruthy();
  fireEvent.click(within(document.querySelector<HTMLElement>('.op-status-page')!).getByRole('button', { name: '清空搜索' }));
  expect((screen.getByLabelText('搜索 API 文档') as HTMLInputElement).value).toBe('');
});

test('在搜索框输入 service.method 即直接打开对应文档', async () => {
  history.replaceState(null, '', '/portal/?section=documents');
  serve([summary('v1')]);
  render(<CustomerDocuments />);
  fireEvent.change(await screen.findByLabelText('搜索 API 文档'), { target: { value: 'orders.query' } });
  expect(await screen.findByRole('heading', { name: '订单查询 v1', level: 1 })).toBeTruthy();
  expect((screen.getByLabelText('搜索 API 文档') as HTMLInputElement).value).toBe('orders.query');
});

test('本页目录随滚动高亮当前章节，点击目录立即高亮', async () => {
  history.replaceState(null, '', '/portal/?apiService=orders&apiVersion=v1&apiMethod=query');
  serve([summary('v1')]);
  render(<CustomerDocuments />);
  await screen.findByRole('heading', { name: '订单查询 v1', level: 1 });
  const toc = within(screen.getByRole('navigation', { name: '本页目录' }));
  expect(toc.getAllByRole('link').map(link => link.textContent)).toEqual(['概览', '请求参数', '请求与响应示例', '响应参数', '错误码', '在线调试']);
  const tops: Record<string, number> = { 'document-overview': -900, 'document-request': -400, 'document-examples': 60, 'document-response': 500, 'document-errors': 1200 };
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) { return { top: tops[this.id] ?? 0 } as DOMRect; });
  await act(async () => { window.dispatchEvent(new Event('scroll')); await new Promise(resolve => requestAnimationFrame(resolve)); });
  await waitFor(() => expect(toc.getByRole('link', { name: '请求与响应示例' }).getAttribute('aria-current')).toBe('location'));
  expect(toc.getAllByRole('link').filter(link => link.getAttribute('aria-current'))).toHaveLength(1);
  tops['document-response'] = 100;
  await act(async () => { window.dispatchEvent(new Event('scroll')); await new Promise(resolve => requestAnimationFrame(resolve)); });
  await waitFor(() => expect(toc.getByRole('link', { name: '响应参数' }).getAttribute('aria-current')).toBe('location'));
  fireEvent.click(toc.getByRole('link', { name: '错误码' }));
  expect(toc.getByRole('link', { name: '错误码' }).getAttribute('aria-current')).toBe('location');
});

test('读取文档失败用状态页说明并可刷新，列表空时给出下一步', async () => {
  history.replaceState(null, '', '/portal/?apiService=orders&apiVersion=v9&apiMethod=query');
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/view') ? Response.json({ code: 40400001, resultMsg: '文档不存在' }, { status: 404 }) : response({ items: [], total: 0, page: 1, pageSize: 20 })));
  const first = render(<CustomerDocuments />);
  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toContain('文档暂时无法读取');
  expect(alert.textContent).toContain('文档不存在');
  expect(within(alert).getByRole('button', { name: '刷新生效文档' })).toBeTruthy();
  expect(screen.queryByRole('navigation', { name: '本页目录' })).toBeNull();
  first.unmount();
  history.replaceState(null, '', '/portal/?section=documents');
  render(<CustomerDocuments />);
  expect(await screen.findByText('还没有公开的 API')).toBeTruthy();
});

test('阅读中输入到一半的 service.method 不关闭正文；精确条件命中另一个接口才切换', async () => {
  history.replaceState(null, '', '/portal/?apiService=orders&apiVersion=v1&apiMethod=query');
  serve([summary('v1'), summary('v2')]);
  render(<CustomerDocuments />);
  await screen.findByRole('heading', { name: '订单查询 v1', level: 1 });
  const input = screen.getByLabelText('搜索 API 文档');
  fireEvent.change(input, { target: { value: 'orders.q' } });
  await waitFor(() => expect(new URLSearchParams(location.search).get('method')).toBe('q'));
  expect(screen.getByRole('heading', { name: '订单查询 v1', level: 1 })).toBeTruthy();
  expect(new URLSearchParams(location.search).get('apiVersion')).toBe('v1');
  fireEvent.change(input, { target: { value: 'orders.query version:v2' } });
  expect(await screen.findByRole('heading', { name: '订单查询 v2', level: 1 })).toBeTruthy();
});

test('旧链接中的模糊关键词 query=a.b 保持原样，不被改写为精确筛选', async () => {
  history.replaceState(null, '', '/portal/?section=documents&query=orders.query');
  const calls = serve([summary('v1')]);
  render(<CustomerDocuments />);
  await waitFor(() => expect(calls.some(url => url.searchParams.get('query') === 'orders.query')).toBe(true));
  await act(() => new Promise(resolve => setTimeout(resolve, 400)));
  const params = new URLSearchParams(location.search);
  expect([params.get('query'), params.get('service'), params.get('method')]).toEqual(['orders.query', null, null]);
});

test('前端未知的生命周期状态按原值中性显示，正文照常阅读', async () => {
  history.replaceState(null, '', '/portal/?apiService=orders&apiVersion=v1&apiMethod=query');
  serve([summary('v1')]);
  const served = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation(async (input) => {
    if (!String(input).endsWith('/view')) return served(input);
    const value = view('v1');
    return response({ ...value, document: { ...value.document, lifecycle: { status: 'SUSPENDED', compatibility: 'UNSPECIFIED' } } });
  });
  render(<CustomerDocuments />);
  expect(await screen.findByRole('heading', { name: '订单查询 v1', level: 1 })).toBeTruthy();
  expect(within(document.querySelector<HTMLElement>('.op-doc__header')!).getByText('SUSPENDED')).toBeTruthy();
});

test('链接指定的分类自动展开但不写入本机偏好，用户亲手展开的才记住', async () => {
  history.replaceState(null, '', '/portal/?section=documents&category=订单');
  serve([summary('v1')]);
  render(<CustomerDocuments />);
  const tree = within(await screen.findByRole('complementary', { name: '文档分类与接口导航' }));
  await waitFor(() => expect(tree.getByRole('button', { name: /^订单/ }).getAttribute('aria-expanded')).toBe('true'));
  fireEvent.click(tree.getByRole('button', { name: /全部 API/ }));
  expect(JSON.parse(localStorage.getItem('op-portal-doc-tree')!)).toEqual(['\u0000all']);
});

test('MCP筛选写入地址并请求服务端过滤，详情显示工具名和开通入口', async () => {
  history.replaceState(null, '', '/?section=documents&query=订单');
  const calls = serve([{ ...summary('v1'), mcpSupported: true }, summary('v2')]);
  render(<CustomerDocuments />);
  fireEvent.click(await screen.findByRole('checkbox', { name: '只看支持 MCP' }));
  await waitFor(() => expect(location.search).toContain('mcpOnly=true'));
  await waitFor(() => expect(calls.some(url => url.pathname.endsWith('/documents') && url.searchParams.get('mcpOnly') === 'true')).toBe(true));
  const results = await screen.findByRole('region', { name: '搜索结果列表' });
  await waitFor(() => expect(within(results).queryByText('查询订单 v2')).toBeNull());
  fireEvent.click(within(results).getByRole('button', { name: /查询订单 v1/ }));
  const disclosure = await screen.findByText('MCP 接入说明');
  expect(disclosure.closest('details')?.open).toBe(false);
  fireEvent.click(disclosure);
  const mcp = await screen.findByRole('region', { name: '通过 MCP 使用' });
  expect(within(mcp).getByText('orders_query_v1')).toBeTruthy();
  expect(within(mcp).getByRole('link', { name: /查看本租户 MCP 开通/ }).getAttribute('href')).toBe('?section=settings');
  expect(within(mcp).getByRole('button', { name: /复制.*MCP 工具名/ })).toBeTruthy();
});
