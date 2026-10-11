import { PlatformTheme } from '@cyl/open-platform-web-shared/ui/PlatformTheme';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import DubboConnections from './DubboConnections';
import { AdminNavigationProvider } from '../navigation/AdminNavigation';
import { createAdminApi } from '../access/api';
import type { ConnectionConfig, ConnectionDetail } from './types';

const config: ConnectionConfig = { registry: { address: 'nacos://registry.example.invalid:8848', namespace: 'test-space', group: 'DUBBO', credentialRef: 'nacos-test' }, metadata: { type: 'NONE', address: null, namespace: null, group: null, database: null, credentialRef: null }, discoveryMode: 'INTERFACE', providerMetadataMode: 'LOCAL' };
const detail: ConnectionDetail = { connection: { id: 'c1', name: '订单连接', environmentId: 'test-cluster', description: '订单服务', draftRevision: 2, activeRevision: 1, enabled: false, stateVersion: 3, updatedAt: '2026-09-12T00:00:00Z' }, draft: { connectionId: 'c1', revision: 2, config: structuredClone(config), createdAt: '2026-09-12T00:00:00Z' }, active: { connectionId: 'c1', revision: 1, config: structuredClone(config), createdAt: '2026-09-11T00:00:00Z' } };
const summary = { ...detail.connection, metadataType: 'NONE', discoveryMode: 'INTERFACE', providerMetadataMode: 'LOCAL' };
const configuration = { currentEnvironmentId: 'test-cluster', registryCredentialRefs: ['nacos-test'], metadataCredentialRefs: ['metadata-test'] };
const page = (items: unknown[], total = items.length) => ({ items, total, page: 1, pageSize: 20 });
const ok = (data: unknown) => Response.json({ code: 200, data });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); window.history.replaceState({}, '', '/'); });
/** 下拉框按可见文字选择；selectedText 读取关闭状态下显示的当前选择。 */
async function choose(scope: HTMLElement, label: string, option: string) {
  fireEvent.mouseDown(within(scope).getByRole('combobox', { name: label }));
  fireEvent.click(await screen.findByText(option, { selector: '.ant-select-item-option-content' }));
}
const selectedText = (scope: HTMLElement, label: string) =>
  within(scope).getByRole('combobox', { name: label }).closest('.ant-select')?.textContent;
function mount(canManage = true) { render(<PlatformTheme><AdminNavigationProvider><DubboConnections api={createAdminApi('csrf32', vi.fn())} canManage={canManage} /></AdminNavigationProvider></PlatformTheme>); }

test('连接配置使用真实选项和CAS，保存冲突保留输入且不显示成功', async () => {
  window.history.replaceState({}, '', '/#/connections?connection=c1&view=edit');
  const calls: [string, RequestInit | undefined][] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push([url, init]);
    if (url.endsWith('/configuration')) return ok(configuration);
    if (url.endsWith('/c1/draft')) return Response.json({ code: 40900001, resultMsg: '连接修订已变化' }, { status: 409 });
    if (url.endsWith('/c1')) return ok(detail);
    return ok(page([summary]));
  }));
  mount();
  const editor = await screen.findByRole('region', { name: '编辑连接草稿' });
  const name = await within(editor).findByLabelText(/连接名称/);
  fireEvent.change(name, { target: { value: '保留我的名称' } });
  fireEvent.click(screen.getByRole('button', { name: '保存连接草稿' }));
  expect(await screen.findByText(/连接修订已变化/)).toBeTruthy();
  expect((name as HTMLInputElement).value).toBe('保留我的名称');
  const request = calls.find(([url]) => url.endsWith('/c1/draft'))!;
  expect(JSON.parse(String(request[1]?.body))).toMatchObject({ expectedStateVersion: 3, name: '保留我的名称', config: { registry: { group: 'DUBBO' } } });
  expect(JSON.parse(String(request[1]?.body))).not.toHaveProperty('environmentId');
  expect(new Headers(request[1]?.headers).get('X-CSRF-Token')).toBe('csrf32');
  expect(screen.queryByText(/连接草稿已保存/)).toBeNull();
});

test('连接草稿保存成功直接回详情，不把正在结束的保存误当未保存输入', async () => {
  window.history.replaceState({}, '', '/#/connections?connection=c1&view=edit');
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('/configuration')) return ok(configuration);
    if (url.endsWith('/c1/draft')) return ok({ ...detail, connection: { ...detail.connection, name: '保存后的连接', stateVersion: 4, draftRevision: 3 }, draft: { ...detail.draft, revision: 3 } });
    if (url.endsWith('/c1')) return ok(detail);
    if (url.includes('/services?')) return ok(page([]));
    return ok(page([summary]));
  }));
  mount();
  const editor = await screen.findByRole('region', { name: '编辑连接草稿' });
  fireEvent.change(await within(editor).findByLabelText(/连接名称/), { target: { value: '保存后的连接' } });
  fireEvent.click(within(editor).getByRole('button', { name: '保存连接草稿' }));
  await waitFor(() => expect(window.location.hash).toContain('view=detail'));
  expect(screen.queryByRole('heading', { name: '离开前处理未保存更改' })).toBeNull();
  expect(screen.getByRole('button', { name: '核对影响并启用修订' })).toBeTruthy();
});

test('按需运行设置切换元数据，Redis数据库必须明确且不改变发现模式', async () => {
  window.history.replaceState({}, '', '/#/connections?connection=new&view=edit');
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/configuration') ? ok(configuration) : ok(page([]))));
  mount();
  const editor = await screen.findByRole('region', { name: '新增 Dubbo 服务连接' });
  await within(editor).findByRole('combobox', { name: '元数据位置' });
  await choose(editor, '元数据位置', 'Redis 元数据中心');
  const database = within(editor).getByLabelText(/Redis database/) as HTMLInputElement;
  expect(database.value).toBe('');
  expect(database.checkValidity()).toBe(false);
  expect(selectedText(editor, '服务发现方式')).toBe('接口级发现');
  expect(selectedText(editor, '提供方实际元数据模式')).toBe('LOCAL · 提供方本地提供');
});

test('既有独立元数据定位不能被复用注册中心覆盖', async () => {
  window.history.replaceState({}, '', '/#/connections?connection=c1&view=edit');
  const independent = { ...detail, draft: { ...detail.draft, config: { ...config, metadata: {
    ...config.metadata, type: 'NACOS', address: 'nacos://metadata.example.invalid:8848', namespace: 'metadata-space', group: 'META', credentialRef: 'metadata-test',
  } } } };
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/configuration') ? ok(configuration) : url.endsWith('/c1') ? ok(independent) : ok(page([summary]))));
  mount();
  const editor = await screen.findByRole('region', { name: '编辑连接草稿' });
  expect(within(editor).queryByRole('button', { name: '复用上方 Nacos 定位' })).toBeNull();
  expect((within(editor).getByLabelText('元数据地址') as HTMLInputElement).value).toBe('nacos://metadata.example.invalid:8848');
});

test('取消元数据类型切换时选择值与原独立字段一起保留', async () => {
  window.history.replaceState({}, '', '/#/connections?connection=c1&view=edit');
  const original = { ...detail, draft: { ...detail.draft, config: { ...config, metadata: {
    ...config.metadata, type: 'REDIS', address: 'redis://metadata.example.invalid:6379', group: 'META', database: 10, credentialRef: 'metadata-test',
  } } } };
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/configuration') ? ok(configuration) : url.endsWith('/c1') ? ok(original) : ok(page([summary]))));
  vi.spyOn(window, 'confirm').mockReturnValue(false);
  mount();
  const editor = await screen.findByRole('region', { name: '编辑连接草稿' });
  await choose(editor, '元数据位置', 'Nacos 元数据中心');
  expect(selectedText(editor, '元数据位置')).toBe('Redis 元数据中心');
  expect((within(editor).getByLabelText('元数据地址') as HTMLInputElement).value).toBe('redis://metadata.example.invalid:6379');
  expect((within(editor).getByLabelText(/Redis database/) as HTMLInputElement).value).toBe('10');
});

test('未填的新元数据配置可明确采用注册中心定位与可用凭据', async () => {
  window.history.replaceState({}, '', '/#/connections?connection=c1&view=edit');
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/configuration') ? ok({ ...configuration, metadataCredentialRefs: ['nacos-test', 'metadata-test'] }) : url.endsWith('/c1') ? ok(detail) : ok(page([summary]))));
  mount();
  const editor = await screen.findByRole('region', { name: '编辑连接草稿' });
  await choose(editor, '元数据位置', 'Nacos 元数据中心');
  fireEvent.click(within(editor).getByRole('button', { name: '复用上方 Nacos 定位' }));
  expect((within(editor).getByLabelText('元数据地址') as HTMLInputElement).value).toBe(config.registry.address);
  expect((within(editor).getByLabelText('元数据 Namespace ID') as HTMLInputElement).value).toBe(config.registry.namespace);
});

test('启用修订前展示真实引用影响，整体停用保持且诊断未检查不伪装通过', async () => {
  window.history.replaceState({}, '', '/#/connections?connection=c1');
  const configured = { ...detail, draft: { ...detail.draft, config: { ...detail.draft.config, registry: { ...detail.draft.config.registry, namespace: 'next-space' } } } };
  const calls: [string, RequestInit | undefined][] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push([url, init]);
    if (url.endsWith('/configuration')) return ok(configuration);
    if (url.includes('/references?')) return ok(page([{ apiId: 'api1', name: '订单详情', revision: 1, kind: 'LIVE' }]));
    if (url.endsWith('/c1/activate')) return ok({ ...configured, connection: { ...configured.connection, activeRevision: 2, enabled: false, stateVersion: 4 }, active: configured.draft });
    if (url.endsWith('/c1/diagnostics')) return ok({ connectionId: 'c1', revision: 2, checkedAt: '2026-09-12T00:00:00Z', checks: [{ stage: 'REGISTRY', status: 'NOT_CHECKED', summary: '尚未装载连接，请先核对连接运行状态' }] });
    if (url.endsWith('/c1')) return ok(configured);
    if (url.includes('/services?')) return ok(page([]));
    return ok(page([summary]));
  }));
  mount();
  const activateRevision = await screen.findByRole('button', { name: '核对影响并启用修订' });
  expect(screen.getByLabelText('当前连接配置').textContent).toContain('test-space');
  expect(screen.getByLabelText('当前连接配置').textContent).not.toContain('next-space');
  fireEvent.click(activateRevision);
  await screen.findByText('订单详情');
  const activate = screen.getByRole('button', { name: '确认启用修订' });
  await waitFor(() => expect((activate as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(activate);
  await screen.findByText(/修订已启用，连接整体仍停用/);
  expect(screen.getByLabelText('当前连接配置').textContent).toContain('next-space');
  const request = calls.find(([url]) => url.endsWith('/activate'))!;
  expect(JSON.parse(String(request[1]?.body))).toEqual({ expectedStateVersion: 3, revision: 2 });
  fireEvent.click(screen.getByRole('button', { name: '检查注册中心（已保存草稿）' }));
  expect(await screen.findByText('尚未装载连接，请先核对连接运行状态')).toBeTruthy();
  const diagnosis = screen.getByRole('region', { name: '注册中心检查结果' });
  expect(within(diagnosis).getByText('未检查')).toBeTruthy();
  expect(within(diagnosis).queryByText('通过')).toBeNull();
});

test('API维护者只读安全摘要，页面不读取服务/方法目录及私有配置', async () => {
  window.history.replaceState({}, '', '/#/connections?connection=c1');
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(url);
    if (url.endsWith('/c1/summary')) return ok({ ...detail.connection, enabled: true });
    return ok(page([{ ...summary, enabled: true }]));
  }));
  mount(false);
  await screen.findByRole('heading', { name: '订单连接' });
  expect(calls.some(url => /services|methods|configuration/.test(url) || url.endsWith('/c1'))).toBe(false);
  const create = screen.getByRole('button', { name: /新增连接/ });
  expect(create).toHaveProperty('disabled', true);
  fireEvent.mouseEnter(create.parentElement!);
  expect(await screen.findByText('需要“连接管理”权限')).toBeTruthy();
  expect(screen.queryByRole('button', { name: '编辑草稿' })).toBeNull();
  expect(screen.queryByText('nacos-test')).toBeNull();
});

test('未激活连接仍显示草稿，注册中心检查不读取业务服务目录', async () => {
  window.history.replaceState({}, '', '/#/connections?connection=c1');
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(url);
    if (url.endsWith('/configuration')) return ok(configuration);
    if (url.endsWith('/c1')) return ok({ ...detail, connection: { ...detail.connection, activeRevision: null }, active: null });
    if (url.endsWith('/diagnostics')) return ok({ connectionId: 'c1', revision: 2, checkedAt: '2026-09-30T00:00:00Z', checks: [{ stage: 'REGISTRY', status: 'PASSED', summary: '注册中心可访问' }] });
    return ok(page([summary]));
  }));
  mount();
  await screen.findByText(/尚未启用的草稿/);
  fireEvent.click(screen.getByRole('button', { name: '检查注册中心（已保存草稿）' }));
  await screen.findByText('注册中心可访问');
  expect(calls.some(url => /services|methods/.test(url))).toBe(false);
});

test('同身份CSRF客户端刷新保留连接草稿输入与原CAS版本', async()=>{
  window.history.replaceState({},'', '/#/connections?connection=c1&view=edit');
  let serverDetail=detail;
  const calls=vi.fn(async(url:string,init?:RequestInit)=>{
    if(url.endsWith('/configuration'))return ok(configuration);
    if(url.endsWith('/c1/draft'))return Response.json({code:40900001,resultMsg:'连接修订已变化'},{status:409});
    if(url.endsWith('/c1'))return ok(serverDetail);
    return ok(page([]));
  });
  vi.stubGlobal('fetch',calls);
  const view=(csrf:string)=><PlatformTheme><AdminNavigationProvider><DubboConnections api={createAdminApi(csrf,vi.fn())} canManage/></AdminNavigationProvider></PlatformTheme>;
  const rendered=render(view('first'));
  fireEvent.change(await screen.findByLabelText('连接名称'),{target:{value:'未保存名称'}});
  serverDetail={...detail,connection:{...detail.connection,stateVersion:4}};
  rendered.rerender(view('refreshed'));
  await waitFor(()=>expect(calls.mock.calls.filter(([url])=>url.endsWith('/c1')).length).toBe(2));
  expect(screen.getByLabelText('连接名称')).toHaveProperty('value','未保存名称');
  fireEvent.click(screen.getByRole('button',{name:/^取\s?消$/}));
  fireEvent.click(screen.getByRole('button',{name:'保存后继续'}));
  await screen.findByText(/连接修订已变化/);
  const request=calls.mock.calls.find(([url])=>url.endsWith('/c1/draft'))!;
  expect(JSON.parse(String(request[1]?.body))).toMatchObject({name:'未保存名称',expectedStateVersion:3});
  expect(new Headers(request[1]?.headers).get('X-CSRF-Token')).toBe('refreshed');
});

test('列表显示最近检查结果，点击行在抽屉中打开连接并写入可分享地址', async () => {
  window.history.replaceState({}, '', '/#/connections');
  const checked = { ...summary, enabled: true, registryCheck: { connectionId: 'c1', revision: 1, checkedAt: '2026-09-30 10:00:00', checks: [{ stage: 'REGISTRY', status: 'FAILED', summary: '认证失败' }] } };
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('/configuration')) return ok(configuration);
    if (url.endsWith('/c1')) return ok({ ...detail, connection: { ...detail.connection, enabled: true, registryCheck: checked.registryCheck } });
    return ok(page([checked]));
  }));
  mount();
  const row = (await screen.findByText('订单连接')).closest('tr')!;
  expect(within(row).getByText('r1 检查失败')).toBeTruthy();
  expect(within(row).getByText('2026-09-30 10:00:00')).toBeTruthy();
  fireEvent.click(within(row).getByText('Nacos 注册中心'));
  await waitFor(() => expect(window.location.hash).toBe('#/connections?connection=c1&view=detail'));
  expect(await screen.findByRole('heading', { name: '订单连接' })).toBeTruthy();
  expect(screen.getByLabelText('当前连接配置').textContent).toContain('nacos://registry.example.invalid:8848');
});

test('配置选项读取失败时“新增连接”禁用并说明原因，可重新加载', async () => {
  window.history.replaceState({}, '', '/#/connections');
  let fail = true;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('/configuration')) return fail ? Response.json({ code: 50300001, resultMsg: '配置中心暂不可用' }, { status: 503 }) : ok(configuration);
    return ok(page([]));
  }));
  mount();
  const create = await screen.findByRole('button', { name: /新增连接/ });
  await screen.findByRole('button', { name: '重新加载配置选项' });
  expect(create).toHaveProperty('disabled', true);
  fireEvent.mouseEnter(create.parentElement!);
  expect(await screen.findByText(/部署环境与凭据选项读取失败：配置中心暂不可用/)).toBeTruthy();
  fail = false;
  fireEvent.click(screen.getByRole('button', { name: '重新加载配置选项' }));
  await waitFor(() => expect(screen.getByRole('button', { name: /新增连接/ })).toHaveProperty('disabled', false));
});

test('旧地址的搜索词并入列表条件，地址只保留设置过的条件', async () => {
  window.history.replaceState({}, '', '/#/connections?query=%E8%AE%A2%E5%8D%95');
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => { calls.push(url); return url.endsWith('/configuration') ? ok(configuration) : ok(page([summary])); }));
  mount();
  await waitFor(() => expect(window.location.hash).toContain('filter.connections.query=%E8%AE%A2%E5%8D%95'));
  await waitFor(() => expect(calls.some(url => url.includes('/dubbo-connections?') && url.includes('query=%E8%AE%A2%E5%8D%95'))).toBe(true));
  expect(await screen.findByRole('button', { name: '清除 名称：订单' })).toBeTruthy();
});
