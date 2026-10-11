import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import CustomerDocuments from './CustomerDocuments';
import SchemaView from '@cyl/open-platform-web-shared/documentation/SchemaView';
import { parseJson } from '@cyl/open-platform-web-shared/json';
import type { DocumentView, SchemaNode } from '@cyl/open-platform-web-shared/documentation/types';

vi.mock('./PublicApiDebug', () => ({ default: () => <details className="document-debug"><summary>在线调试</summary></details> }));
const view: DocumentView = { releaseId: 'r1', stateVersion: 1, service: 'orders', version: 'v01', method: 'query1', category: '订单', document: { id: 'a1', draftRevision: 1, title: '订单查询契约', description: '完整公开业务说明', path: '/api/oauth/orders/v01/query1', httpMethod: 'POST', scopeCodes: ['orders.read'], requestSchema: { type: 'OBJECT', properties: { orderId: { type: 'STRING', required: true } } }, responseSchema: { type: 'OBJECT' }, requestExample: { orderId: 'order-001' }, responseExample: {}, errorDefinitions: [] } };
const items = Array.from({ length: 20 }, (_, index) => ({ apiId: `a${index + 1}`, name: `订单查询${index + 1}`, category: '订单', service: 'orders', version: 'v01', method: `query${index + 1}`, lifecycleStatus: 'ACTIVE' }));
const response = (data: unknown) => Response.json({ code: 200, data });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); localStorage.clear(); history.replaceState(null, '', '/'); });
const tree = () => within(screen.getByRole('complementary', { name: '文档分类与接口导航' }));

function documentRequests(total = 21) {
  const calls: URL[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    const url = new URL(input, location.origin); calls.push(url);
    if (url.pathname.endsWith('/view')) return response(view);
    if (url.pathname.endsWith('/categories')) return response({ items: ['订单', '商品', '库存'].map(category => ({ category, apiCount: 21 })), total: 3, page: 1, pageSize: 20 });
    const versions = url.searchParams.has('method');
    const secondPage = url.searchParams.get('page') === '2';
    return response({ items: versions ? [items[0], { ...items[0], apiId: 'other-version', version: 'v1' }] : secondPage ? total > 20 ? [{ ...items[0], apiId: 'a21', name: '订单查询21' }] : [] : items, total: versions ? 2 : total, page: secondPage ? 2 : 1, pageSize: 20 });
  }));
  return calls;
}

test('仅展开分类按20条分页加载，收起保持正文与选择且记住展开状态，窄屏目录可按需切换', async () => {
  history.replaceState(null, '', '/portal/?category=订单');
  const calls = documentRequests();
  render(<CustomerDocuments />);
  const directory = await screen.findByRole('navigation', { name: '订单 接口' });
  await within(directory).findByRole('button', { name: '订单查询20' });
  expect(within(directory).getAllByRole('button').filter(button => button.title)).toHaveLength(20);
  expect(calls.filter(url => url.pathname === '/public-api/documents')).toHaveLength(1);
  expect(calls.every(url => !url.searchParams.has('pageSize') || url.searchParams.get('pageSize') === '20')).toBe(true);
  expect(tree().getByRole('button', { name: /商品/ }).getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(within(directory).getByRole('button', { name: '订单查询1' }));
  const heading = await screen.findByRole('heading', { name: '订单查询契约', level: 1 });
  await waitFor(() => expect(document.activeElement).toBe(heading));
  const group = tree().getByRole('button', { name: /^订单\s*21$/ });
  fireEvent.click(group);
  expect(screen.queryByRole('navigation', { name: '订单 接口' })).toBeNull();
  expect(screen.getByRole('heading', { name: '订单查询契约', level: 1 })).toBeTruthy();
  expect(location.search).toContain('apiVersion=v01');
  expect(JSON.parse(localStorage.getItem('op-portal-doc-tree')!)).toEqual([]);
  fireEvent.click(group);
  const reopened = await screen.findByRole('navigation', { name: '订单 接口' });
  await within(reopened).findByRole('button', { name: '订单查询20' });
  expect(within(reopened).getByRole('button', { name: '订单查询1' }).getAttribute('aria-current')).toBe('page');
  expect(JSON.parse(localStorage.getItem('op-portal-doc-tree')!)).toEqual(['订单']);
  fireEvent.click(within(screen.getByRole('navigation', { name: '订单 接口分页' })).getByRole('button', { name: '下一页' }));
  await screen.findByRole('button', { name: '订单查询21' });
  expect(calls.some(url => url.searchParams.get('category') === '订单' && url.searchParams.get('page') === '2')).toBe(true);
  const toggle = screen.getByRole('button', { name: /展开接口目录/ });
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(toggle);
  expect(screen.getByRole('button', { name: /收起接口目录/ }).getAttribute('aria-expanded')).toBe('true');
});

test('本机记住的展开分类在下次进入时恢复并按页读取', async () => {
  localStorage.setItem('op-portal-doc-tree', JSON.stringify(['商品']));
  history.replaceState(null, '', '/portal/?section=documents');
  const calls = documentRequests();
  render(<CustomerDocuments />);
  await screen.findByRole('navigation', { name: '商品 接口' });
  expect(tree().getByRole('button', { name: /^商品\s*21$/ }).getAttribute('aria-expanded')).toBe('true');
  expect(tree().getByRole('button', { name: /^订单\s*21$/ }).getAttribute('aria-expanded')).toBe('false');
  await waitFor(() => expect(calls.filter(url => url.pathname === '/public-api/documents').map(url => url.searchParams.get('category'))).toEqual(['商品']));
});

test('精确条件与字面版本可返回恢复，公共指南从顶栏进入', async () => {
  const initial = '/portal/?category=订单&service=orders&version=v01&method=query1&apiService=orders&apiVersion=v01&apiMethod=query1';
  history.replaceState(null, '', initial);
  documentRequests();
  render(<CustomerDocuments />);
  await screen.findByRole('heading', { name: '订单查询契约', level: 1 });
  expect((screen.getByLabelText('搜索 API 文档') as HTMLInputElement).value).toBe('orders.query1 version:v01');
  expect(screen.getByText(/精确筛选/).textContent).toContain('service:orders');
  fireEvent.mouseDown(screen.getByLabelText('选择外部版本'));
  fireEvent.click(await screen.findByText('v1', { selector: '.ant-select-item-option-content' }));
  await waitFor(() => expect(location.search).toContain('apiVersion=v1'));
  await act(async () => { history.replaceState(null, '', initial); window.dispatchEvent(new PopStateEvent('popstate')); });
  await screen.findByRole('heading', { name: '订单查询契约', level: 1 });
  expect(screen.getByLabelText('选择外部版本').closest('.ant-select')?.textContent).toContain('v01');
  expect(screen.queryByRole('navigation', { name: '公共接入知识' })).toBeNull();
  expect(within(screen.getByRole('navigation', { name: '门户导航' })).getByRole('link', { name: '接入指南' }).getAttribute('href')).toBe('?section=guide');
  expect(screen.getByLabelText('搜索 API 文档').getAttribute('aria-describedby')).toBe('doc-search-syntax');
  expect(document.querySelector<HTMLDetailsElement>('.document-share')?.open).toBe(false);
  expect(document.querySelector<HTMLDetailsElement>('.document-debug')?.open).toBe(false);
});

test('紧凑字段行保留长说明、嵌套数组、false与0及大整数原始JSON', () => {
  const schema = parseJson<SchemaNode>('{"type":"OBJECT","properties":{"enabled":{"type":"BOOLEAN","defaultValue":false},"count":{"type":"INTEGER","example":0},"items":{"type":"ARRAY","description":"完整数组说明\\n第二行仍然可读","items":{"type":"OBJECT","properties":{"id":{"type":"INTEGER","example":9007199254740993}}}}}}');
  const { rerender } = render(<SchemaView title="请求结构" schema={schema} />);
  fireEvent.click(screen.getByRole("button",{name:"全部展开"}));
  expect(screen.getByText('$.items[].id')).toBeTruthy();
  expect(screen.getByText('false')).toBeTruthy();
  expect(screen.getByText('0')).toBeTruthy();
  expect(screen.getByText('9007199254740993')).toBeTruthy();
  expect(screen.getByText(/完整数组说明/, { selector: 'p' }).textContent).toBe('完整数组说明\n第二行仍然可读');
  const raw = screen.getByText('请求结构原始 JSON').closest('details')!;
  expect(raw.textContent).toContain('9007199254740993');
  expect(screen.getByText('$.enabled').parentElement?.className).toBe('schema-field');
  rerender(<SchemaView title="请求结构" schema={schema} showRawSchema={false} />);
  expect(screen.queryByText('请求结构原始 JSON')).toBeNull();
  expect(screen.queryByText('$', { selector: 'code' })).toBeNull();
  expect(screen.getByText('9007199254740993')).toBeTruthy();
  expect(screen.getByText('false')).toBeTruthy();
  expect(screen.getByText('$.items[].id')).toBeTruthy();
  rerender(<SchemaView title="请求结构" schema={{ ...schema, required: true, description: '根节点约束' }} showRawSchema={false} />);
  expect(screen.getByText('$', { selector: 'code' })).toBeTruthy();
  expect(screen.getByText('根节点约束')).toBeTruthy();
});


test('目录数据减少后旧URL空页仍可返回上一页', async () => {
  history.replaceState(null, '', '/portal/?category=订单&page=2');
  const calls = documentRequests(20);
  render(<CustomerDocuments />);
  await screen.findByText('没有匹配的公开接口。请清空关键词或改选分类后重试。');
  fireEvent.click(within(screen.getByRole('navigation', { name: '订单 接口分页' })).getByRole('button', { name: '上一页' }));
  await screen.findByRole('button', { name: '订单查询20' });
  expect(new URLSearchParams(location.search).get('page')).toBe('1');
  const search = screen.getByLabelText('搜索 API 文档') as HTMLInputElement;
  fireEvent.change(search, { target: { value: '还未生效的搜索' } });
  fireEvent.click(screen.getByRole('button', { name: '清空搜索' }));
  expect((screen.getByLabelText('搜索 API 文档') as HTMLInputElement).value).toBe('');
  await new Promise(resolve => setTimeout(resolve, 350));
  expect(new URLSearchParams(location.search).get('query')).toBeNull();
  expect(calls.some(url => url.searchParams.get('category') === '订单' && url.searchParams.get('page') === '1')).toBe(true);
});


test('切回窗口不重取目录或详情，保留阅读状态，显式刷新仍获取新文档', async () => {
  history.replaceState(null, '', '/portal/?category=订单&apiService=orders&apiVersion=v01&apiMethod=query1');
  const calls = documentRequests();
  render(<CustomerDocuments />);
  await screen.findByRole('heading', { name: '订单查询契约', level: 1 });
  await screen.findByRole('button', { name: '订单查询20' });
  const examples = within(document.getElementById('document-examples')!);
  fireEvent.click(examples.getByRole('tab', { name: 'JavaScript' }));
  const code = document.querySelector('#document-examples .op-code-block__pre');
  expect(code?.textContent).toContain('process.env.OPEN_PLATFORM_TOKEN');
  const count = calls.filter(url => url.pathname !== '/portal-api/session').length;
  await act(async () => { for (let i = 0; i < 3; i++) { window.dispatchEvent(new Event('blur')); window.dispatchEvent(new Event('focus')); } });
  expect(calls.filter(url => url.pathname !== '/portal-api/session')).toHaveLength(count);
  expect(document.querySelector('#document-examples .op-code-block__pre')).toBe(code);
  expect(examples.getByRole('tab', { name: 'JavaScript' }).getAttribute('aria-selected')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: '刷新生效文档' }));
  await waitFor(() => expect(calls.filter(url => url.pathname.endsWith('/view'))).toHaveLength(2));
});

test('SDK页面切回窗口不自动刷新，刷新按钮仍可用', async () => {
  history.replaceState(null, '', '/portal/?section=sdk');
  const fetchMock = vi.fn(async (_url: string) => response({ items: [], total: 0, page: 1, pageSize: 20 }));
  vi.stubGlobal('fetch', fetchMock);
  render(<CustomerDocuments />);
  await screen.findByText('暂无匹配的已发布平台 SDK');
  const count = fetchMock.mock.calls.filter(([url]) => url !== '/portal-api/session').length;
  await act(async () => { window.dispatchEvent(new Event('blur')); window.dispatchEvent(new Event('focus')); });
  expect(fetchMock.mock.calls.filter(([url]) => url !== '/portal-api/session')).toHaveLength(count);
  fireEvent.click(screen.getByRole('button', { name: '刷新 SDK' }));
  await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => url !== '/portal-api/session')).toHaveLength(count + 1));
});

test('参数树一次展开数组对象字段，单独收起不会丢失原始示例或其他分支状态',()=>{
 const schema:SchemaNode={type:'OBJECT',properties:{rules:{type:'ARRAY',items:{type:'OBJECT',properties:{enabled:{type:'BOOLEAN',example:false}}}},plain:{type:'ARRAY',items:{type:'NUMBER'}}}};
 render(<SchemaView title="可折叠参数" schema={schema}/>);
 expect(screen.queryByText('$.rules[].enabled')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'展开 $.rules'}));
 expect(screen.getByText('$.rules[].enabled')).toBeTruthy();
 expect(screen.queryByRole('button',{name:'展开 $.rules[]'})).toBeNull();
 expect(screen.getByText('array[number]')).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'收起嵌套'}));
 expect(screen.queryByText('$.rules[].enabled')).toBeNull();
 expect(screen.getByText('可折叠参数原始 JSON').closest('details')?.textContent).toContain('false');
});

test('全部 API 汇总入口默认折叠不加载接口，可展开且选择接口不跳到其他分类', async () => {
  history.replaceState(null, '', '/portal/?section=documents'); const calls = documentRequests(); render(<CustomerDocuments />);
  const all = await tree().findByRole('button', { name: /全部 API/ }); expect(all.getAttribute('aria-expanded')).toBe('false'); expect(all.closest('.op-tree__group--all')).toBeTruthy();
  expect(calls.filter(url => url.pathname === '/public-api/documents')).toHaveLength(0);
  fireEvent.click(all); await tree().findByRole('button', { name: '订单查询20' }); expect(all.getAttribute('aria-expanded')).toBe('true');
  fireEvent.click(tree().getByRole('button', { name: '订单查询1' })); await screen.findByRole('heading', { name: '订单查询契约', level: 1 }); expect(new URLSearchParams(location.search).get('category')).toBeNull(); expect(all.getAttribute('aria-expanded')).toBe('true');
  fireEvent.click(all); expect(all.getAttribute('aria-expanded')).toBe('false'); expect(screen.queryByRole('navigation', { name: '全部 API 接口' })).toBeNull();
});
