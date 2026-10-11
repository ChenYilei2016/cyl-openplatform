import { AdminNavigationProvider } from '../navigation/AdminNavigation';
import { cleanup, fireEvent, render as renderView, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import ApplicationsPanel from './ApplicationsPanel';
import { createAdminApi } from './api';
const render = (ui: React.ReactNode) => renderView(ui, { wrapper: AdminNavigationProvider });

const application = {
  id: 'a1',
  name: '订单同步',
  appKey: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  ownerTenantId: 't1',
  status: 'ENABLED',
  authorizationVersion: 1,
  scopeCodes: ['orders'],
};
const ok = (data: unknown) =>
  Response.json({ code: 200, data, resultMsg: '成功', requestId: 'test-request' });
const page = (items: unknown[]) => ({ items, total: items.length, page: 1, pageSize: 20 });
const closeDrawer = () => fireEvent.click(screen.getByRole('button', { name: /^(Close|关闭)$/ }));
async function fillCreate() {
  fireEvent.click(screen.getAllByRole('button', { name: /新建凭据/ })[0]);
  fireEvent.change(await screen.findByLabelText('归属租户 ID'), { target: { value: 't1' } });
  const submit = screen.getByRole('button', { name: '创建并生成 Secret' });
  await waitFor(() => expect(submit).toHaveProperty('disabled', false));
  fireEvent.click(submit);
}
afterEach(() => {
  cleanup();
  window.history.replaceState({}, '', '/');
  vi.unstubAllGlobals();
});

test('抽屉内新建凭据携带会话proof与初始权限组，Secret 只展示本次并可清除', async () => {
  const defaults = { id: 's1', code: 'orders', name: '订单查询', enabled: true, defaultForNewApplication: true };
  const fetchMock = vi.fn(async (url: string, options?: RequestInit) =>
    options?.method === 'POST' ? ok({ application, appSecret: 'one-time-secret' })
      : url.endsWith('/applications/a1') ? ok(application)
      : url.includes('/scopes?') ? ok(page([defaults]))
      : ok(page([])),
  );
  vi.stubGlobal('fetch', fetchMock);
  render(<ApplicationsPanel api={createAdminApi('csrf-proof', vi.fn())} />);
  await fillCreate();
  expect(await screen.findByText('one-time-secret')).toBeTruthy();
  expect(fetchMock.mock.calls.some(([url]) => url.includes('/scopes?page=1&pageSize=100&enabled=true&defaultForNewApplication=true'))).toBe(true);
  const call = fetchMock.mock.calls.find(([, options]) => options?.method === 'POST');
  expect(new Headers(call?.[1]?.headers).get('X-CSRF-Token')).toBe('csrf-proof');
  expect(JSON.parse(String(call?.[1]?.body))).toEqual({ ownerTenantId: 't1', scopeCodes: ['orders'] });
  expect(window.location.hash).toContain('application=a1');
  expect(window.location.hash).not.toContain('one-time-secret');
  fireEvent.click(screen.getByRole('button', { name: '已妥善保存，关闭凭据' }));
  expect(screen.queryByText('one-time-secret')).toBeNull();
});

test('创建后详情读取失败仍交付一次性凭据，不因刷新详情丢失', async()=>{
 vi.stubGlobal('fetch',vi.fn(async(url:string,options?:RequestInit)=>options?.method==='POST'?ok({application,appSecret:'visible-despite-read-failure'}):url.endsWith('/applications/a1')?Response.json({code:503,resultMsg:'详情暂不可用'},{status:503}):ok(page([]))));
 render(<ApplicationsPanel api={createAdminApi('proof',vi.fn())}/>);
 await fillCreate();
 await screen.findByText('详情暂不可用');expect(screen.getByText('visible-despite-read-failure')).toBeTruthy();closeDrawer();await screen.findByText(/AppSecret仅本次显示/);expect(screen.getByText('visible-despite-read-failure')).toBeTruthy();
});

test('停用凭据需要确认并说明影响全部关联租户，确认后才提交并显示停用结果', async () => {
  const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
    if (url.endsWith('/status')) return ok({ ...application, status: 'DISABLED' });
    if (url.endsWith('/applications/a1')) return ok(application);
    return ok(page(url.includes('/applications?') ? [application] : []));
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<ApplicationsPanel api={createAdminApi('proof', vi.fn())} />);
  fireEvent.click(await screen.findByRole('button', { name: `查看凭据 ${application.appKey}` }));
  fireEvent.click(await screen.findByRole('button', { name: '停用凭据' }));
  const confirm = await screen.findByRole('tooltip');
  expect(within(confirm).getByText('停用凭据？')).toBeTruthy();
  expect(within(confirm).getByText(/凭据 AK.*全部关联租户/)).toBeTruthy();
  expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'PUT')).toBe(false);
  fireEvent.click(within(confirm).getByRole('button', { name: '确认停用' }));
  expect(await screen.findByText('凭据已停用。')).toBeTruthy();
  const write = fetchMock.mock.calls.find(([url]) => url.endsWith('/status'));
  expect(JSON.parse(String(write?.[1]?.body))).toEqual({ enabled: false });
});

test('应用scope按页选择时保留已有权限，保存完整明确范围', async () => {
  const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
    if (url.includes('/scopes?'))
      return ok(
        page([
          {
            id: 's2',
            code: 'products',
            name: '商品查询',
            enabled: true,
            defaultForNewApplication: false,
          },
        ]),
      );
    if (url.endsWith('/applications/a1/scopes'))
      return ok({ ...application, scopeCodes: ['orders', 'products'] });
    if (url.endsWith('/applications/a1')) return ok(application);
    return ok(page(url.includes('/applications?') ? [application] : []));
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<ApplicationsPanel api={createAdminApi('proof', vi.fn())} />);
  fireEvent.click(await screen.findByRole('button', { name: `查看凭据 ${application.appKey}` }));
  fireEvent.click(await screen.findByRole('tab', { name: '权限组' }));
  fireEvent.click(await screen.findByLabelText('商品查询（products）'));
  fireEvent.click(screen.getByRole('button', { name: '保存应用 Scope' }));
  expect(await screen.findByText('凭据调用权限已保存。')).toBeTruthy();
  const write = fetchMock.mock.calls.find(([url]) => url.endsWith('/applications/a1/scopes'));
  expect(JSON.parse(String(write?.[1]?.body))).toEqual({ scopeCodes: ['orders', 'products'] });
});

// 抽屉内完整绑定与委托流程交互较多，本机高负载时放宽超时。
test('绑定租户要求重新输入密钥，人员授权只提交工号并展示核验结果', { timeout: 15000 }, async () => {
  const grant = {
    id: 'g1',
    applicationId: 'a1',
    tenantId: 't2',
    status: 'ACTIVE',
    authorizationVersion: 1,
  };
  const user = {
    id: 'ug1',
    tenantGrantId: 'g1',
    tenantId: 't2',
    employeeNo: 'E22',
    employeeId: 'e22',
    userId: 'u22',
    displayName: '已核验员工',
    status: 'ACTIVE',
    authorizationVersion: 1,
  };
  let bound = false;
  let authorized = false;
  const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
    if (url === '/admin-api/tenant-grants' && options?.method === 'POST') {
      bound = true;
      return ok(grant);
    }
    if (url.endsWith('/tenant-grants/g1/employee-lookup')) return ok({ ...user, enabled: true });
    if (url === '/admin-api/tenant-grants/g1/users' && options?.method === 'POST') {
      authorized = true;
      return ok(user);
    }
    if (url.includes('/tenant-grants/g1/users?')) return ok(page(authorized ? [user] : []));
    if (url.endsWith('/applications/a1/tenant-grants/g1')) return ok(grant);
    if (url.includes('/applications/a1/tenant-grants?')) return ok(page(bound ? [grant] : []));
    if (url.endsWith('/applications/a1')) return ok(application);
    return ok(page(url.includes('/applications?') ? [application] : []));
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<ApplicationsPanel api={createAdminApi('proof', vi.fn())} />);
  fireEvent.click(await screen.findByRole('button', { name: `查看凭据 ${application.appKey}` }));
  fireEvent.click(await screen.findByRole('tab', { name: '授权租户与人员' }));
  fireEvent.click(await screen.findByRole('button', { name: '绑定租户' }));
  expect((screen.getByLabelText('应用 AppSecret') as HTMLInputElement).value).toBe('');
  fireEvent.change(screen.getByLabelText('目标租户 ID'), { target: { value: 't2' } });
  fireEvent.change(screen.getByLabelText('应用 AppSecret'), {
    target: { value: 'provided-secret' },
  });
  fireEvent.click(screen.getByRole('button', { name: '校验并绑定' }));
  fireEvent.click(await screen.findByRole('button', { name: '管理人员 t2' }));
  fireEvent.change(await screen.findByLabelText('委托员工号'), { target: { value: 'E22' } });
  fireEvent.click(screen.getByRole('button', { name: '核验员工' }));
  fireEvent.click(await screen.findByRole('button', { name: '确认建立委托' }));
  expect(await screen.findByText('已核验员工（E22）的委托已建立。')).toBeTruthy();
  const write = fetchMock.mock.calls.find(
    ([url, options]) => url === '/admin-api/tenant-grants/g1/users' && options?.method === 'POST',
  );
  expect(JSON.parse(String(write?.[1]?.body))).toEqual({ employeeNo: 'E22', expectedUserId: 'u22', expectedEmployeeId: 'e22' });
});

test('应用审计按需分页读取，显示服务端结果和请求号', async () => {
  const fetchMock = vi.fn(async (url: string) => {
    if (url.includes('/audit?'))
      return ok(
        page([
          {
            id: 'log1',
            action: 'APPLICATION_DISABLED',
            summary: '应用已禁用',
            outcome: 'SUCCESS',
            operatorTenantId: 't1',
            operatorEmployeeNo: 'E1',
            targetTenantId: 't2',
            targetId: 'a1',
            requestId: 'audit-request-1',
            occurredAt: '2026-09-09T08:00:00Z',
          },
        ]),
      );
    if (url.endsWith('/applications/a1')) return ok(application);
    return ok(page(url.includes('/applications?') ? [application] : []));
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<ApplicationsPanel api={createAdminApi('proof', vi.fn())} />);
  fireEvent.click(await screen.findByRole('button', { name: `查看凭据 ${application.appKey}` }));
  fireEvent.click(await screen.findByRole('tab', { name: '操作记录' }));
  expect(await screen.findByText('audit-request-1')).toBeTruthy();
  expect(screen.getByText('应用已禁用')).toBeTruthy();
});

test('会话缺少proof时拒绝写请求并保留明确错误提示', async () => {
  const fetchMock = vi.fn(async () => ok(page([])));
  vi.stubGlobal('fetch', fetchMock);
  render(<ApplicationsPanel api={createAdminApi(null, vi.fn())} />);
  await fillCreate();
  expect(await screen.findByRole('alert')).toHaveProperty(
    'textContent',
    '会话缺少操作凭据，请刷新页面重新验证登录。',
  );
  expect((fetchMock.mock.calls as unknown as [string, RequestInit | undefined][]).some(([, options]) => options?.method === 'POST')).toBe(false);
});

test('一次性密钥未关闭时不能创建下一应用，关闭后恢复创建', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, options?: RequestInit) =>
      options?.method === 'POST' ? ok({ application, appSecret: 'saved-only-once' }) : url.endsWith('/applications/a1') ? ok(application) : ok(page([])),
    ),
  );
  render(<ApplicationsPanel api={createAdminApi('proof', vi.fn())} />);
  await fillCreate();
  expect(await screen.findByText('saved-only-once')).toBeTruthy();
  expect(screen.getAllByRole('button', { name: /新建凭据/ })[0]).toHaveProperty('disabled', true);
  closeDrawer();
  expect(await screen.findByText(/AppSecret仅本次显示/)).toBeTruthy();
  fireEvent.click(within(screen.getByRole('dialog', {name:'离开前处理未保存更改'})).getByRole('button',{name:'取消'}));
  fireEvent.click(screen.getByRole('button', { name: '已妥善保存，关闭凭据' }));
  closeDrawer();
  await waitFor(() => expect(window.location.hash).not.toContain('application='));
  expect(screen.getAllByRole('button', { name: /新建凭据/ })[0]).toHaveProperty('disabled',false);
});

test('轮换密钥未关闭时禁止再次轮换，启停失败保留一次性密钥', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.endsWith('/secret/rotate'))
        return ok({ appKey: application.appKey, appSecret: 'rotated-secret' });
      if (url.endsWith('/status'))
        return Response.json({ code: 409, resultMsg: '状态修改失败', data: null }, { status: 409 });
      if (url.endsWith('/applications/a1')) return ok(application);
      return ok(page(url.includes('/applications?') ? [application] : []));
    }),
  );
  render(<ApplicationsPanel api={createAdminApi('proof', vi.fn())} />);
  fireEvent.click(await screen.findByRole('button', { name: `查看凭据 ${application.appKey}` }));
  fireEvent.click(await screen.findByRole('button', { name: '轮换 AppSecret' }));
  fireEvent.click(await screen.findByRole('button', { name: '确认轮换' }));
  expect(await screen.findByText('rotated-secret')).toBeTruthy();
  expect(
    (screen.getByRole('button', { name: '轮换 AppSecret' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '停用凭据' }));
  fireEvent.click(await screen.findByRole('button', { name: '确认停用' }));
  expect((await screen.findByRole('alert')).textContent?.trim()).toBe('状态修改失败');
  expect(screen.getByText('rotated-secret')).toBeTruthy();
});

test('轮换成功但刷新失败仍交付新密钥，交付未关闭前不能再次轮换',async()=>{
 let rotated=false;let writes=0;
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>{
  if(url.endsWith('/secret/rotate')){rotated=true;writes++;return ok({appKey:application.appKey,appSecret:'issued-secret'})}
  if(url.endsWith('/applications/a1'))return rotated?Response.json({code:503,resultMsg:'读取失败'},{status:503}):ok(application);
  return ok(page(url.includes('/applications?')?[application]:[]));
 }));
 render(<ApplicationsPanel api={createAdminApi('proof',vi.fn())}/>);fireEvent.click(await screen.findByRole('button',{name:`查看凭据 ${application.appKey}`}));fireEvent.click(await screen.findByRole('button',{name:'轮换 AppSecret'}));fireEvent.click(await screen.findByRole('button',{name:'确认轮换'}));await screen.findByText(/密钥已轮换，状态刷新失败/);expect(screen.getByText('issued-secret')).toBeTruthy();expect(screen.getByRole('button',{name:'轮换 AppSecret'})).toHaveProperty('disabled',true);fireEvent.click(screen.getByRole('button',{name:'已妥善保存，关闭凭据'}));expect(screen.queryByText('issued-secret')).toBeNull();expect(writes).toBe(1);
});

test('名称搜索只提交 search，不传空 AppKey 或旧分项参数', async () => {
  const fetchMock = vi.fn(async (_url: string) => ok(page([])));
  vi.stubGlobal('fetch', fetchMock);
  render(<ApplicationsPanel api={createAdminApi('proof', vi.fn())} />);
  fireEvent.change(screen.getByLabelText('搜索凭据'), { target: { value: '订单' } });
  await vi.waitFor(() => {
    const query = fetchMock.mock.calls.find(([url]) => url.includes('search='));
    expect(query).toBeDefined();
    const parameters = new URL(query![0], 'http://localhost').searchParams;
    expect(parameters.get('search')).toBe('订单');
    expect(parameters.has('appKey')).toBe(false);
    expect(parameters.has('query')).toBe(false);
    expect(parameters.has('relationStatus')).toBe(false);
  });
});
