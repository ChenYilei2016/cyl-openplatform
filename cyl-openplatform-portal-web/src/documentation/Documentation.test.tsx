import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import CustomerDocuments from './CustomerDocuments';
import SchemaView from '@cyl/open-platform-web-shared/documentation/SchemaView';
import { createDocumentClient } from '@cyl/open-platform-web-shared/documentation/api';
import { parseJson } from '@cyl/open-platform-web-shared/json';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); history.replaceState(null, '', '/'); });
const page = (items: unknown[]) => Response.json({ code: 200, data: { items, total: items.length, page: 1, pageSize: 20 } });

test('层级结构保留数组items、false、0、空容器和精确数值，文本不解释成HTML', () => {
  render(<SchemaView title="请求结构" schema={parseJson('{"type":"OBJECT","defaultValue":{},"properties":{"rows":{"type":"ARRAY","example":[],"items":{"type":"OBJECT","properties":{"amount":{"type":"NUMBER","example":1234567890.1234567890123456789},"active":{"type":"BOOLEAN","defaultValue":false},"count":{"type":"INTEGER","defaultValue":0,"description":"<img src=x onerror=alert(1)>"}}}}}}')} />);
  expect(screen.queryByText('$.rows[].amount')).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'全部展开'}));
  expect(screen.getByText('$.rows[].amount')).toBeTruthy();
  expect(screen.getByText('1234567890.1234567890123456789')).toBeTruthy();
  expect(screen.getByText('false')).toBeTruthy(); expect(screen.getByText('0')).toBeTruthy();
  expect(screen.getByText('{}')).toBeTruthy(); expect(screen.getByText('[]')).toBeTruthy();
  expect(document.querySelector('img')).toBeNull();
  const collapse = screen.getByRole('button', { name: '收起 $.rows' });
  expect(collapse.getAttribute('aria-expanded')).toBe('true');
  fireEvent.click(collapse);
  expect(screen.queryByText('$.rows[].amount')).toBeNull();
  expect(screen.getByRole('button', { name: '展开 $.rows' }).getAttribute('aria-expanded')).toBe('false');
});

test('匿名门户无需 Token，会话探测失败仍能阅读，搜索语法的精确版本筛选即时生效并保存为可恢复链接', async () => {
  history.replaceState(null, '', '/portal/?section=documents');
  const fetchMock = vi.fn(async (url: string) => url === '/portal-api/session' ? Response.json({ code: 401 }, { status: 401 }) : page(url.includes('categories') ? [{ category: '订单', apiCount: 1 }] : []));
  vi.stubGlobal('fetch', fetchMock);
  const storage = vi.spyOn(Storage.prototype, 'setItem');
  render(<CustomerDocuments />);
  await within(screen.getByRole('complementary', { name: '文档分类与接口导航' })).findByRole('button', { name: /^订单\s*1$/ });
  expect(screen.queryByLabelText('业务 Token')).toBeNull();
  fireEvent.change(screen.getByLabelText('搜索 API 文档'), { target: { value: 'version:v01' } });
  await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url.includes('version=v01'))).toBe(true));
  expect(location.search).toContain('version=v01');
  expect(await screen.findByText('没有匹配的 API')).toBeTruthy();
  expect(fetchMock.mock.calls.every(([url]) => url.startsWith('/public-api/documents') || url === '/platform-info' || url === '/portal-api/session')).toBe(true);
  for (const call of fetchMock.mock.calls) {
    const init = (call as unknown as [string, RequestInit])[1];
    expect(new Headers(init.headers).has('Authorization')).toBe(false);
    expect(init.credentials).toBe(call[0] === '/portal-api/session' ? 'same-origin' : 'omit');
  }
  expect(storage).not.toHaveBeenCalled();
  storage.mockRestore();
});

test('导出固定精确stateVersion、遇到409不生成下载，并将请求取消信号传给fetch', async () => {
  const fetchMock = vi.fn(async () => Response.json({ code: 40900001, resultMsg: '生效版本已变化，请刷新', requestId: 'r15' }, { status: 409 }));
  vi.stubGlobal('fetch', fetchMock);
  const controller = new AbortController();
  const client = createDocumentClient({ token: 'business' });
  await expect(client.export(parseJson('{"releaseId":"release-1","stateVersion":9007199254740993,"service":"orders","version":"v01","method":"query"}'), 'JSON', controller.signal)).rejects.toThrow('生效版本已变化');
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toContain('stateVersion=9007199254740993'); expect(url).toContain('releaseId=release-1');
  expect(init.credentials).toBe('omit'); expect(init.signal).toBeTruthy();
});

test('管理文档使用管理权限客户端，导出用Cookie无业务Token且401通知会话失效', async () => {
  const adminApi = vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 20 }));
  const expire = vi.fn();
  const fetchMock = vi.fn(async () => Response.json({ code: 40100001, resultMsg: '登录已失效' }, { status: 401 }));
  vi.stubGlobal('fetch', fetchMock);
  const client = createDocumentClient({ adminApi: adminApi as import('@cyl/open-platform-web-shared/http').ApiClient, onUnauthorized: expire });
  await client.read('?page=1');
  expect(adminApi).toHaveBeenCalledWith('/documents?page=1', undefined);
  await expect(client.export({ releaseId: 'r1', stateVersion: 1, service: 'orders', version: 'v1', method: 'query' }, 'HTML', new AbortController().signal)).rejects.toThrow('登录已失效');
  expect(expire).toHaveBeenCalledOnce();
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toContain('/admin-api/documents/orders/v1/query/export'); expect(init.credentials).toBe('same-origin');
  expect(new Headers(init.headers).has('Authorization')).toBe(false);
});

test('文档下载使用服务端Blob，离开文档撤销URL并取消未完成导出', async () => {
  const { default: DocumentExplorer } = await import('@cyl/open-platform-web-shared/documentation/DocumentExplorer');
  const summary = { apiId: 'a1', releaseId: 'r1', stateVersion: 1, draftRevision: 1, name: '订单文档', category: '订单', service: 'orders', version: 'v1', method: 'query', lifecycleStatus: 'ACTIVE' };
  const view = { releaseId: 'r1', stateVersion: 1, service: 'orders', version: 'v1', method: 'query', category: '订单', document: { id: 'a1', draftRevision: 1, title: '订单文档详情', path: '/api/oauth/orders/v1/query', httpMethod: 'POST', scopeCodes: ['orders'], requestSchema: { type: 'OBJECT', properties: {} }, responseSchema: { type: 'OBJECT', properties: {} }, errorDefinitions: [], requestExample: {}, responseExample: {} } };
  const create = vi.fn(() => 'blob:document'); const revoke = vi.fn();
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: create }); Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revoke });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  let pendingSignal: AbortSignal | undefined;
  const client = { read: vi.fn(async (path: string) => path.endsWith('/view') ? view : { items: path.includes('categories') ? [] : [summary], total: 1, page: 1, pageSize: 20 }) as import('@cyl/open-platform-web-shared/http').ApiClient,
    export: vi.fn(async (_view: unknown, format: string, signal: AbortSignal): Promise<Blob> => { if (format === 'JSON') return new Blob(['{}'], { type: 'application/json' }); pendingSignal = signal; return new Promise(() => {}); }) };
  const { rerender } = render(<DocumentExplorer client={client} />);
  fireEvent.click(await screen.findByRole('button', { name: '订单文档' }));
  await screen.findByRole('button', { name: '下载 JSON' });
  expect(screen.queryByText('请求结构原始 JSON')).toBeNull();
  expect(screen.queryByText('业务响应结构原始 JSON')).toBeNull();
  rerender(<DocumentExplorer client={client} showRawSchema />);
  expect(screen.getByText('请求结构原始 JSON')).toBeTruthy();
  expect(screen.getByText('业务响应结构原始 JSON')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '下载 JSON' }));
  expect(client.read).toHaveBeenCalledWith('/orders/v1/query/view', expect.objectContaining({ signal: expect.any(AbortSignal) }));
  await waitFor(() => expect(click).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole('button', { name: '下载 HTML' }));
  await waitFor(() => expect(pendingSignal).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: '返回接口列表' }));
  expect(await screen.findByRole('button', { name: '订单文档' })).toBeTruthy();
  await waitFor(() => expect(pendingSignal?.aborted).toBe(true)); expect(revoke).toHaveBeenCalledWith('blob:document');
  click.mockRestore();
});


test('announcements操作的导出使用子资源后缀，不进入旧公告路由', async () => {
  const fetchMock = vi.fn(async () => new Response('{}', { headers: { 'Content-Type': 'application/json' } }));
  vi.stubGlobal('fetch', fetchMock);
  const client = createDocumentClient({ token: 'business' });
  await client.export({ releaseId: 'r1', stateVersion: 2, service: 'orders', version: 'v1', method: 'announcements' }, 'JSON', new AbortController().signal);
  expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toContain('/api/docs/orders/v1/announcements/export?');
});

test('阅读中直接切换接口保留目录；筛选即时生效不关闭正文，精确条件以标签汇总并可逐个或全部清除', async () => {
  const { default: DocumentExplorer } = await import('@cyl/open-platform-web-shared/documentation/DocumentExplorer');
  const items = ['v1', 'v2'].map(version => ({ apiId: version, name: `订单${version}`, service: 'orders', version, method: 'query', lifecycleStatus: 'ACTIVE' }));
  const read = vi.fn(async (path: string) => path.endsWith('/view') ? { releaseId: 'REL_1', stateVersion: 1, service: 'orders', version: path.includes('v2') ? 'v2' : 'v1', method: 'query', document: { title: '订单详情', draftRevision: 1, path: '/api/oauth/orders/v1/query', httpMethod: 'POST', scopeCodes: [], requestSchema: { type: 'OBJECT' }, responseSchema: { type: 'OBJECT' }, requestExample: {}, responseExample: {}, errorDefinitions: [] } } : { items: path.includes('categories') ? [] : items, total: path.includes('categories') ? 0 : 2, page: 1, pageSize: 20 });
  const client = { read: read as import('@cyl/open-platform-web-shared/http').ApiClient, export: vi.fn() };
  render(<DocumentExplorer client={client} />);
  fireEvent.click(await screen.findByRole('button', { name: '订单v1' }));
  await screen.findByRole('heading', { name: '订单详情' });
  fireEvent.mouseDown(screen.getByLabelText('切换当前页接口'));
  fireEvent.click(await screen.findByText('订单v2 · v2 · orders.query', { selector: '.ant-select-item-option-content' }));
  await screen.findByText('外部 v2 · 生效 r1');
  expect(read.mock.calls.some(([path]) => path === '/orders/v2/query/view')).toBe(true);
  expect(screen.getByRole('navigation', { name: '文档章节' })).toBeTruthy();
  const listReads = () => read.mock.calls.map(([path]) => path as string).filter((path) => path.startsWith('?'));
  fireEvent.change(screen.getByLabelText('搜索名称 / 服务 / 操作'), { target: { value: '订单' } });
  await waitFor(() => expect(listReads().at(-1)).toContain(`query=${encodeURIComponent('订单')}`));
  expect(screen.getByRole('heading', { name: '订单详情' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '更多筛选' }));
  fireEvent.change(within(screen.getByRole('group', { name: '精确筛选' })).getByLabelText('服务（精确）'), { target: { value: 'orders' } });
  await waitFor(() => expect(listReads().at(-1)).toContain('service=orders'));
  const chips = within(screen.getByRole('group', { name: '已生效的筛选条件' }));
  fireEvent.click(chips.getByRole('button', { name: '清除 服务：orders' }));
  await waitFor(() => expect(listReads().at(-1)).not.toContain('service='));
  expect(listReads().at(-1)).toContain('query=');
  fireEvent.click(chips.getByRole('button', { name: '清除全部' }));
  expect(screen.getByLabelText('搜索名称 / 服务 / 操作')).toHaveProperty('value', '');
  await waitFor(() => expect(listReads().at(-1)).not.toContain('query='));
});

test('授权文档同快照刷新保留调用JSON，读取期间禁调用和导出，失败清旧表单',async()=>{
 const {default:DocumentExplorer}=await import('@cyl/open-platform-web-shared/documentation/DocumentExplorer');
 const {default:PublishedInvocation}=await import('../portal/PublishedInvocation');
 const view={releaseId:'r87',stateVersion:1,service:'orders',version:'v1',method:'lookup',category:'订单',document:{id:'a87',draftRevision:1,title:'订单87',path:'/api/oauth/orders/v1/lookup',httpMethod:'POST',scopeCodes:[],requestSchema:{type:'OBJECT'},responseSchema:{type:'OBJECT'},errorDefinitions:[],requestExample:{orderNo:'original'},responseExample:{}}};
 let settle:((value:typeof view)=>void)|undefined;
 let reject:((error:Error)=>void)|undefined;
 let pending=false;
 const read=vi.fn(async(path:string)=>path.endsWith('/view')?(pending?new Promise<typeof view>((resolve,fail)=>{settle=resolve;reject=fail}):view):path.startsWith('/categories')?{items:[],total:0,page:1,pageSize:20}:{items:[{apiId:'a87',name:'订单87',service:'orders',version:'v1',method:'lookup',lifecycleStatus:'ACTIVE'}],total:1,page:1,pageSize:20});
 const client={read:read as import('@cyl/open-platform-web-shared/http').ApiClient,export:vi.fn()};
 render(<DocumentExplorer client={client} invocationLabel="调用此接口" renderInvocation={(value,refreshing)=><PublishedInvocation view={value} disabled={refreshing} token="token" onUnauthorized={()=>{}}/>}/>);
 fireEvent.click(await screen.findByRole('button',{name:'订单87'}));
 const input=await screen.findByLabelText('正式调用请求 JSON') as HTMLTextAreaElement;
 fireEvent.change(input,{target:{value:'{"orderNo":"edited"}'}});
 expect(screen.getByRole('button',{name:'调用此接口'})).toBeTruthy();
 pending=true;fireEvent.click(screen.getByRole('button',{name:'刷新生效文档'}));
 await waitFor(()=>expect((screen.getByRole('button',{name:'调用正式接口'}) as HTMLButtonElement).disabled).toBe(true));
 expect((screen.getByRole('button',{name:'下载 JSON'}) as HTMLButtonElement).disabled).toBe(true);
 settle!(view);
 await waitFor(()=>expect((screen.getByRole('button',{name:'调用正式接口'}) as HTMLButtonElement).disabled).toBe(false));
 expect(input.value).toBe('{"orderNo":"edited"}');
 fireEvent.click(screen.getByRole('button',{name:'刷新生效文档'}));
 await waitFor(()=>expect((screen.getByRole('button',{name:'调用正式接口'}) as HTMLButtonElement).disabled).toBe(true));
 reject!(new Error('已不可访问'));
 await screen.findByText('已不可访问');
 expect(screen.queryByLabelText('正式调用请求 JSON')).toBeNull();
});
