import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import ScopesPanel from './ScopesPanel';
import { AdminNavigationProvider, useAdminNavigation } from '../navigation/AdminNavigation';
import { AdminApiError, type AdminApi } from './api';

const scope = { id: 's1', code: 'orders', name: '订单', enabled: true, defaultForNewApplication: false, publicAccess: false, apiCount: 2, credentialCount: 5 };
const page = (items: unknown[]) => ({ items, total: items.length, page: 1, pageSize: 20 });
const scopeApis = [
  { id: 'a1', name: '订单查询', service: 'orders', version: 'v1', method: 'query', protocol: 'HTTP', draftRevision: 3, liveDraftRevision: 3, draftIncluded: true, liveIncluded: true },
  { id: 'a2', name: '订单取消', service: 'orders', version: 'v1', method: 'cancel', protocol: 'HTTP', draftRevision: 6, liveDraftRevision: 4, draftIncluded: false, liveIncluded: true },
  { id: 'a3', name: '订单导出', service: 'orders', version: 'v1', method: 'export', protocol: 'HTTP', draftRevision: 1, liveDraftRevision: null, draftIncluded: true, liveIncluded: false },
];
const tenantGrants = [
  { id: 'g1', scopeCode: 'orders', tenantId: 't-100', tenantName: '甲租户', status: 'ACTIVE', grantedByTenantId: 'tenant-1', grantedByEmployeeNo: 'A1', grantedByName: '张三', createdAt: '2026-10-01T02:00:00Z', updatedAt: '2026-10-01T02:00:00Z', revision: 0 },
  { id: 'g2', scopeCode: 'orders', tenantId: 't-200', tenantName: null, status: 'REVOKED', grantedByTenantId: 'tenant-1', grantedByEmployeeNo: 'A1', grantedByName: null, createdAt: '2026-10-01T02:00:00Z', updatedAt: '2026-10-02T02:00:00Z', revision: 1 },
];
type Options = Parameters<AdminApi>[1];
function mockApi(write: (path: string, options: Options) => unknown = () => ({ ...scope })) {
  return vi.fn(async (path: string, options?: Options) => {
    if (options?.method && options.method !== 'GET') return write(path, options);
    if (path.startsWith('/scopes/s1/apis')) return page(scopeApis);
    if (path.startsWith('/scopes/s1/tenant-grants')) return page(tenantGrants);
    if (path === '/scopes/s1') return scope;
    if (path.startsWith('/apis?')) return page([{ id: 'a9', name: '库存查询', service: 'stock', version: 'v2', method: 'query', draftRevision: 7 }]);
    return page([scope]);
  });
}
const writes = (api: ReturnType<typeof mockApi>) => api.mock.calls.filter(([, options]) => options?.method && options.method !== 'GET');
function mount(api: ReturnType<typeof mockApi>, canEditApis = true) {
  return render(<AdminNavigationProvider><ScopesPanel api={api as unknown as AdminApi} canEditApis={canEditApis} /></AdminNavigationProvider>);
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); history.replaceState({}, '', '/'); });

test('列表显示 API 数与凭据数并区分两个开关；点击行打开抽屉，启停经确认说明旧 Token 影响且只提交可写字段', async () => {
  const api = mockApi((_path) => ({ ...scope, enabled: false }));
  history.replaceState({}, '', '/#/scopes');
  mount(api);
  const row = (await screen.findByRole('button', { name: '订单' })).closest('tr')!;
  expect(within(row).getByText('2')).toBeTruthy();
  expect(within(row).getByText('5')).toBeTruthy();
  expect(screen.getByRole('button', { name: '启用说明' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '新凭据默认授予说明' })).toBeTruthy();
  fireEvent.click(within(row).getByText('orders'));
  await waitFor(() => expect(location.hash).toContain('scope=s1'));
  const drawer = await screen.findByRole('dialog');
  expect(within(drawer).getByText(/只影响之后新建的凭据/)).toBeTruthy();
  fireEvent.click(within(drawer).getByLabelText('启用权限组'));
  expect(within(drawer).getByText(/全部凭据旧Token失效/)).toBeTruthy();
  fireEvent.click(within(drawer).getByRole('button', { name: '保存权限组' }));
  expect(writes(api)).toHaveLength(0);
  fireEvent.click(await screen.findByRole('button', { name: '停用并保存' }));
  await screen.findByText('权限组已保存。');
  expect(writes(api)[0][0]).toBe('/scopes/s1');
  expect(writes(api)[0][1]?.body).toEqual({ name: '订单', enabled: false, defaultForNewApplication: false, publicAccess: false });
});

test('抽屉内未保存修改受离开保护：取消保留输入，保存后继续才切页', async () => {
  const api = mockApi(() => ({ ...scope, name: '未提交名称' }));
  function Workspace() {
    const nav = useAdminNavigation();
    return <><button onClick={() => nav.navigate({ ...nav.route, page: 'applications', scopeId: null })}>切换凭据</button>{nav.route.page === 'scopes' ? <ScopesPanel api={api as unknown as AdminApi} /> : <p>凭据页面</p>}</>;
  }
  history.replaceState({}, '', '/#/scopes?scope=s1');
  render(<AdminNavigationProvider><Workspace /></AdminNavigationProvider>);
  fireEvent.change(await screen.findByLabelText('权限组名称'), { target: { value: '未提交名称' } });
  fireEvent.click(screen.getByRole('button', { name: '切换凭据', hidden: true }));
  const guard = await screen.findByRole('dialog', { name: '离开前处理未保存更改', hidden: true });
  fireEvent.click(within(guard).getByRole('button', { name: '取消', hidden: true }));
  expect(screen.getByLabelText('权限组名称')).toHaveProperty('value', '未提交名称');
  fireEvent.click(screen.getByRole('button', { name: '切换凭据', hidden: true }));
  fireEvent.click(within(await screen.findByRole('dialog', { name: '离开前处理未保存更改', hidden: true })).getByRole('button', { name: '保存后继续', hidden: true }));
  await waitFor(() => expect(screen.getByText('凭据页面')).toBeTruthy());
  expect(writes(api)).toHaveLength(1);
  expect(writes(api)[0][1]?.body).toEqual({ name: '未提交名称', enabled: true, defaultForNewApplication: false, publicAccess: false });
});

test('新建权限组在抽屉内完成：代码格式校验，提交默认授予并打开新权限组', async () => {
  const api = mockApi(() => ({ id: 's1', code: 'orders', name: '订单查询', enabled: true, defaultForNewApplication: true, publicAccess: false }));
  history.replaceState({}, '', '/#/scopes');
  mount(api);
  fireEvent.click(screen.getAllByRole('button', { name: /新建权限组/ })[0]);
  const code = await screen.findByLabelText('权限组代码') as HTMLInputElement;
  fireEvent.change(code, { target: { value: 'Orders' } });
  expect(code.checkValidity()).toBe(false);
  fireEvent.change(code, { target: { value: 'orders.read-v1' } });
  expect(code.checkValidity()).toBe(true);
  fireEvent.change(code, { target: { value: 'orders' } });
  fireEvent.change(screen.getByLabelText('权限组名称'), { target: { value: '订单查询' } });
  fireEvent.click(screen.getByLabelText('新凭据默认授予'));
  fireEvent.click(screen.getByRole('button', { name: '创建权限组' }));
  expect(await screen.findByText(/权限组已创建/)).toBeTruthy();
  expect(writes(api)[0][0]).toBe('/scopes');
  expect(writes(api)[0][1]?.body).toEqual({ code: 'orders', name: '订单查询', enabled: true, defaultForNewApplication: true, publicAccess: false });
  expect(location.hash).toContain('scope=s1');
});

test('权限组抽屉增删 API：改的是 API 草稿并携带草稿修订，写清发布后生效与未发布修改', async () => {
  const api = mockApi((path, options) => ({ draftRevision: (options?.body as { expectedRevision: number }).expectedRevision + 1, changed: true, path }));
  history.replaceState({}, '', '/#/scopes?scope=s1');
  mount(api);
  fireEvent.click(await screen.findByRole('tab', { name: /API/ }));
  expect(await screen.findByText(/需在 API 工作区发布后才影响调用/)).toBeTruthy();
  expect(await screen.findByText(/本页有 2 个 API 的增删尚未发布/)).toBeTruthy();
  expect(screen.getByText('草稿已移除')).toBeTruthy();
  expect(screen.getByText('草稿已加入')).toBeTruthy();
  expect(screen.getByText('API 尚未发布')).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: '移除 订单查询' }));
  expect(await screen.findByText(/发布该 API 后，持有此组的凭据将不能再调用它/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /^移\s*除$/ }));
  await screen.findByText(/已移除「订单查询」草稿（新修订 r4）/);
  expect(writes(api)[0][0]).toBe('/apis/a1/scope-codes');
  expect(writes(api)[0][1]?.body).toEqual({ expectedRevision: 3, scopeCode: 'orders', included: false });

  fireEvent.click(screen.getByRole('button', { name: '撤销移除 订单取消' }));
  await screen.findByText(/已加入「订单取消」草稿（新修订 r7）/);
  expect(writes(api)[1][1]?.body).toEqual({ expectedRevision: 6, scopeCode: 'orders', included: true });

  const search = screen.getByRole('combobox', { name: '搜索要加入的 API' });
  fireEvent.mouseDown(search);
  fireEvent.change(search, { target: { value: '库存' } });
  // 搜索有 300ms 防抖：等按关键字的请求发出后再选，避免快速运行时与防抖竞争。
  await waitFor(() => expect(api.mock.calls.some(([path]) => path.startsWith('/apis?') && path.includes('query=%E5%BA%93%E5%AD%98'))).toBe(true));
  fireEvent.click(await screen.findByText(/库存查询 · stock\.query · v2/));
  fireEvent.click(screen.getByRole('button', { name: '加入草稿' }));
  await screen.findByText(/已加入「库存查询」草稿（新修订 r8）/);
  expect(writes(api)[2][0]).toBe('/apis/a9/scope-codes');
  expect(writes(api)[2][1]?.body).toEqual({ expectedRevision: 7, scopeCode: 'orders', included: true });
});

test('草稿并发冲突时提示并刷新列表，不自动重试', async () => {
  const api = mockApi(() => { throw new AdminApiError('草稿已被修改，请重新加载后保存', 40900001, 'req-1', undefined, 409); });
  history.replaceState({}, '', '/#/scopes?scope=s1');
  mount(api);
  fireEvent.click(await screen.findByRole('tab', { name: /API/ }));
  const reads = () => api.mock.calls.filter(([path]) => path.startsWith('/scopes/s1/apis')).length;
  fireEvent.click(await screen.findByRole('button', { name: '撤销移除 订单取消' }));
  await screen.findByText(/该 API 草稿已被他人修改，列表已刷新/);
  await waitFor(() => expect(reads()).toBeGreaterThan(1));
  expect(writes(api)).toHaveLength(1);
});

test('无 API 管理权限时 API 页只读，不提供增删入口', async () => {
  const api = mockApi();
  history.replaceState({}, '', '/#/scopes?scope=s1');
  mount(api, false);
  fireEvent.click(await screen.findByRole('tab', { name: /API/ }));
  expect(await screen.findByText(/你没有 API 管理权限/)).toBeTruthy();
  expect(await screen.findByText('订单查询')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /移除 订单查询/ })).toBeNull();
  expect(screen.queryByRole('combobox', { name: '搜索要加入的 API' })).toBeNull();
});

test('列表上方列出新凭据默认授予的权限组：已启用的会授予，停用的单独提示；可一键只看这些', async () => {
  const granted = { ...scope, id: 'd1', code: 'common', name: '通用公共API', defaultForNewApplication: true };
  const disabled = { ...scope, id: 'd2', code: 'legacy', name: '旧版接口', enabled: false, defaultForNewApplication: true };
  const api = vi.fn(async (path: string) => (path.includes('defaultForNewApplication=true') ? page([granted, disabled]) : page([scope])));
  history.replaceState({}, '', '/#/scopes');
  mount(api as unknown as ReturnType<typeof mockApi>);
  const summary = await screen.findByRole('region', { name: '新建凭据时默认授予的权限组' });
  expect(await within(summary).findByRole('button', { name: '通用公共API' })).toBeTruthy();
  expect(within(summary).getByText('1 个权限组')).toBeTruthy();
  expect(within(summary).getByText(/已停用、不会授予/)).toBeTruthy();
  expect(within(summary).getByRole('button', { name: '旧版接口' })).toBeTruthy();
  fireEvent.click(within(summary).getByRole('button', { name: /只看这些/ }));
  await waitFor(() => expect(window.location.hash).toContain('filter.scopes.defaultForNewApplication=true'));
  fireEvent.click(within(summary).getByRole('button', { name: '通用公共API' }));
  await waitFor(() => expect(window.location.hash).toContain('scope=d1'));
});

test('公共通用开关随设置提交；已开通租户页按租户 ID 开通、撤销与重新开通，重复开通显示冲突', async () => {
  const api = mockApi((path, options) => {
    if (path === '/scopes/s1') return { ...scope, publicAccess: true };
    if (options?.method === 'POST' && (options.body as { tenantId: string }).tenantId === 't-100') {
      throw new AdminApiError('该租户已开通此权限组', 40900001, 'req-1', undefined, 409);
    }
    return { ...tenantGrants[0], tenantId: (options?.body as { tenantId?: string } | undefined)?.tenantId ?? 't-100' };
  });
  history.replaceState({}, '', '/#/scopes?scope=s1');
  mount(api);
  fireEvent.click(await screen.findByLabelText('公共通用'));
  expect(screen.getByText(/保存后所有租户立即可在 MCP 工具与门户中使用/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '保存权限组' }));
  await screen.findByText('权限组已保存。');
  expect(writes(api)[0][1]?.body).toEqual({ name: '订单', enabled: true, defaultForNewApplication: false, publicAccess: true });

  fireEvent.click(screen.getByRole('tab', { name: /^已开通租户/ }));
  expect(await screen.findByText('甲租户')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('租户 ID'), { target: { value: ' t-300 ' } });
  fireEvent.click(screen.getByRole('button', { name: /^开\s*通$/ }));
  await screen.findByText(/已为租户 甲租户 开通此权限组/);
  expect(writes(api)[1][0]).toBe('/scopes/s1/tenant-grants');
  expect(writes(api)[1][1]?.body).toEqual({ tenantId: 't-300' });

  fireEvent.change(screen.getByLabelText('租户 ID'), { target: { value: 't-100' } });
  fireEvent.click(screen.getByRole('button', { name: /^开\s*通$/ }));
  expect(await screen.findByText(/该租户已开通此权限组/)).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: '重新开通 t-200' }));
  await waitFor(() => expect(writes(api)[3][1]?.body).toEqual({ tenantId: 't-200' }));

  fireEvent.click(screen.getByRole('button', { name: '撤销 t-100' }));
  fireEvent.click(await screen.findByRole('button', { name: /^撤\s*销$/ }));
  await screen.findByText(/已撤销租户 甲租户 的此权限组/);
  expect(writes(api)[4][0]).toBe('/scopes/s1/tenant-grants/g1');
  expect(writes(api)[4][1]?.method).toBe('DELETE');
});

test('权限组租户数量直接打开已开通租户页签，深链接可恢复', async () => {
  history.replaceState({}, '', '/#/scopes');
  mount(mockApi());
  fireEvent.click(await screen.findByRole('button', { name: /订单，已开通租户 0 个/ }));
  await waitFor(() => expect(location.hash).toContain('scopeTab=tenants'));
  expect(await screen.findByRole('tab', { name: /^已开通租户/ })).toHaveProperty('ariaSelected', 'true');
  expect(await screen.findByRole('button', { name: /撤销 t-100/ })).toBeTruthy();
});
