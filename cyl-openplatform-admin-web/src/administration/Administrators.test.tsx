import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import AdministratorsPanel from './AdministratorsPanel';
import { createAdminApi } from '../access/api';
import { AdminNavigationProvider } from '../navigation/AdminNavigation';
import App from '../App';

const employee = {
  tenantId: 't1',
  employeeNo: 'E1',
  employeeId: 'employee1',
  userId: 'user1',
  displayName: '示例甲',
  enabled: true,
  employeeStatus: 'ACTIVE',
};
const administrator = {
  ...employee,
  id: 'admin1',
  tenantName: '测试租户',
  revision: 3,
  permissions: ['MANAGE_APIS'],
  superAdministrator: true,
};
const ok = (data: unknown) =>
  Response.json({ code: 200, data }, { headers: { 'X-CSRF-Token': 'proof' } });
const page = (items: unknown[]) => ({ items, total: items.length, page: 1, pageSize: 20 });
const statusWith = (count: number) => async (url: string, options?: RequestInit) =>
  url === '/admin-api/administrators/status' ? ok({ enabledSuperAdministratorCount: count }) : defaultFetch(url, options);
const defaultFetch = async (url: string, _options?: RequestInit) => {
  if (url === '/admin-api/administrators/status')
    return ok({ enabledSuperAdministratorCount: 1 });
  if (url === '/admin-api/administrators/employee-lookup') return ok(employee);
  if (url === '/admin-api/administrators/admin1') return ok(administrator);
  if (url.startsWith('/admin-api/administrators?tenantId=')) return ok(page([]));
  if (url.startsWith('/admin-api/administrators/audit?')) return ok(page([]));
  return ok(page([administrator]));
};
const isOn = (label: string) => screen.getByLabelText(label).getAttribute('aria-checked') === 'true';
const closeDrawer = () => fireEvent.click(screen.getAllByRole('button', { name: /^(Close|关闭)$/ }).at(-1)!);
const leaveDialog = () => screen.findByRole('dialog', { name: '离开前处理未保存更改', hidden: true });
async function template(name: string) {
  fireEvent.mouseDown(await screen.findByRole('combobox', { name: '套用业务模板' }));
  fireEvent.click((await screen.findAllByText(name)).at(-1)!);
}
async function verifyEmployee() {
  fireEvent.change(screen.getByLabelText('员工租户 ID'), { target: { value: 't1' } });
  fireEvent.change(screen.getByLabelText('员工工号'), { target: { value: 'E1' } });
  fireEvent.click(screen.getByRole('button', { name: '核验员工' }));
  await screen.findByText('已核验员工：示例甲');
}
const assign = () => fireEvent.click(screen.getAllByRole('button', { name: /分配管理员/ })[0]);
function mount(canManage = true) {
  return render(
    <AdminNavigationProvider>
      <AdministratorsPanel
        api={createAdminApi('proof', vi.fn())}
        canManage={canManage}
        canRead
        onChanged={vi.fn()}
      />
    </AdminNavigationProvider>,
  );
}
afterEach(() => {
  cleanup();
  window.history.replaceState({}, '', '/');
  vi.unstubAllGlobals();
});

test('名单显示租户名称与角色，搜索姓名/工号与角色、状态筛选只提交新参数', async () => {
  const fetchMock = vi.fn(defaultFetch);
  vi.stubGlobal('fetch', fetchMock);
  mount();
  const row = (await screen.findByRole('button', { name: '示例甲' })).closest('tr')!;
  expect(within(row).getByText('测试租户')).toBeTruthy();
  expect(within(row).getByText('总管理员')).toBeTruthy();
  expect(within(row).getByText('工号 E1')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('搜索管理员'), { target: { value: 'E1' } });
  await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url.includes('search=E1'))).toBe(true));
  fireEvent.mouseDown(screen.getByRole('combobox', { name: '角色' }));
  fireEvent.click((await screen.findAllByText('普通管理员')).at(-1)!);
  await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url.includes('superAdministrator=false') && url.includes('search=E1'))).toBe(true));
  const last = new URL(fetchMock.mock.calls.filter(([url]) => url.startsWith('/admin-api/administrators?')).at(-1)![0], 'http://localhost').searchParams;
  expect(last.has('name')).toBe(false);
  expect(last.has('employeeNo')).toBe(false);
  expect(window.location.hash).toContain('filter.administrators.superAdministrator=false');
});

test('核验可信身份后才可分配，输入变化清掉核验，模板不隐式授予总管理员', async () => {
  const fetchMock = vi.fn(defaultFetch);
  vi.stubGlobal('fetch', fetchMock);
  mount();
  assign();
  expect(await screen.findByRole('dialog')).toBeTruthy();
  expect(screen.queryByLabelText('调整原因')).toBeNull();
  expect((screen.getByRole('button', { name: '确认分配' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('员工租户 ID'), { target: { value: 't1' } });
  fireEvent.change(screen.getByLabelText('员工工号'), { target: { value: 'E1' } });
  fireEvent.click(screen.getByRole('button', { name: '核验员工' }));
  expect(await screen.findByText('已核验员工：示例甲')).toBeTruthy();
  fireEvent.change(await screen.findByLabelText('调整原因'), { target: { value: '接手维护' } });
  await template('研发模板');
  expect(isOn('总管理员（可分配或撤销权限）')).toBe(false);
  fireEvent.change(screen.getByLabelText('员工工号'), { target: { value: 'E2' } });
  expect(screen.queryByText('已核验员工：示例甲')).toBeNull();
  expect((screen.getByRole('button', { name: '确认分配' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('员工工号'), { target: { value: 'E1' } });
  fireEvent.click(screen.getByRole('button', { name: '核验员工' }));
  await screen.findByText('已核验员工：示例甲');
  fireEvent.click(await screen.findByRole('button', { name: '确认分配' }));
  await screen.findByText(/管理员权限已更新/);
  const request = fetchMock.mock.calls.find(
    ([url, options]) => url === '/admin-api/administrators' && options?.method === 'POST',
  );
  expect(JSON.parse(String(request?.[1]?.body))).toEqual({
    tenantId: 't1',
    employeeNo: 'E1',
    expectedUserId: 'user1',
    expectedEmployeeId: 'employee1',
    permissions: ['MANAGE_APIS', 'PUBLISH_APIS'],
    superAdministrator: false,
    reason: '接手维护',
  });
});

test('最后总管理员：撤销按钮与停用/降级开关禁用并说明原因，仍可调整显式业务权限', async () => {
  const fetchMock = vi.fn(defaultFetch);
  vi.stubGlobal('fetch', fetchMock);
  mount();
  fireEvent.click(await screen.findByRole('button', { name: '调整权限 示例甲' }));
  expect((await screen.findAllByText(/这是最后一名启用的总管理员/)).length).toBeGreaterThan(0);
  expect(screen.getByRole('button', { name: '撤销管理资格' })).toHaveProperty('disabled', true);
  expect(screen.getByLabelText('总管理员（可分配或撤销权限）')).toHaveProperty('disabled', true);
  expect(screen.getByLabelText('启用管理资格（取消即停用）')).toHaveProperty('disabled', true);
  const wrapper = screen.getByLabelText('启用管理资格（取消即停用）').parentElement!;
  fireEvent.pointerEnter(wrapper);
  fireEvent.mouseEnter(wrapper);
  // 悬停禁用开关显示原因提示（与说明条同文）。
  await waitFor(() => expect(screen.getAllByText(/请先为其他有效员工分配总管理员/).length).toBeGreaterThan(1), { timeout: 2000 });
  fireEvent.change(await screen.findByLabelText('调整原因'), { target: { value: '权限收敛' } });
  fireEvent.click(screen.getByRole('button', { name: /^清\s*空$/ }));
  fireEvent.click(screen.getByRole('button', { name: '确认调整' }));
  await screen.findByText(/管理员权限已更新/);
  const request = fetchMock.mock.calls.find(([, options]) => options?.method === 'PUT');
  expect(JSON.parse(String(request?.[1]?.body))).toEqual({
    expectedRevision: 3,
    permissions: [],
    enabled: true,
    superAdministrator: true,
    reason: '权限收敛',
  });
});

test('降级与撤销先确认后果再提交，撤销从抽屉头部进入', async () => {
  const fetchMock = vi.fn(statusWith(2));
  vi.stubGlobal('fetch', fetchMock);
  mount();
  fireEvent.click(await screen.findByRole('button', { name: '调整权限 示例甲' }));
  fireEvent.change(await screen.findByLabelText('调整原因'), { target: { value: '职责调整' } });
  fireEvent.click(screen.getByLabelText('总管理员（可分配或撤销权限）'));
  fireEvent.click(screen.getByRole('button', { name: '确认调整' }));
  expect(await screen.findByText(/不能再分配、调整或撤销他人的管理资格/)).toBeTruthy();
  expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'PUT')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '确认降级' }));
  await screen.findByText(/管理员权限已更新/);
  expect(JSON.parse(String(fetchMock.mock.calls.find(([, options]) => options?.method === 'PUT')?.[1]?.body))).toMatchObject({ enabled: true, superAdministrator: false });

  fireEvent.click(screen.getByRole('button', { name: '调整权限 示例甲' }));
  fireEvent.click(await screen.findByRole('button', { name: '撤销管理资格' }));
  await waitFor(() => expect(window.location.hash).toContain('administratorView=revoke'));
  fireEvent.change(await screen.findByLabelText('调整原因'), { target: { value: '离岗' } });
  fireEvent.click(screen.getByRole('button', { name: '确认撤销' }));
  expect(await screen.findByText(/后续管理请求立即被拒绝/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '撤销资格' }));
  await waitFor(() => expect(fetchMock.mock.calls.filter(([, options]) => options?.method === 'PUT')).toHaveLength(2));
  expect(JSON.parse(String(fetchMock.mock.calls.filter(([, options]) => options?.method === 'PUT')[1][1]?.body))).toMatchObject({ enabled: false, reason: '离岗' });
});

test('只读审计人员可查询和查看前后权限，不能分配或调整', async () => {
  const fetchMock = vi.fn(async (url: string, options?: RequestInit) =>
    url.includes('/audit?')
      ? ok(
          page([
            {
              id: 'audit1',
              administratorId: 'admin1',
              operatorTenantId: 't2',
              operatorEmployeeNo: 'E2',
              action: 'UPDATE',
              reason: '交接审核权限',
              before: administrator,
              after: { ...administrator, permissions: ['REVIEW_APIS'] },
              occurredAt: '2026-09-20T01:00:00Z',
            },
          ]),
        )
      : defaultFetch(url, options),
  );
  vi.stubGlobal('fetch', fetchMock);
  mount(false);
  expect(screen.getAllByRole('button', { name: /分配管理员/ })[0]).toHaveProperty('disabled', true);
  const edit = await screen.findByRole('button', { name: '调整权限 示例甲' });
  expect((edit as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText(/当前可只读查看名单与变更记录/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText('搜索管理员'), { target: { value: '示' } });
  await waitFor(() =>
    expect(fetchMock.mock.calls.some(([url]) => url.includes('search=%E7%A4%BA'))).toBe(true),
  );
  fireEvent.click(await screen.findByRole('button', { name: '变更记录 示例甲' }));
  expect(await screen.findByText('交接审核权限')).toBeTruthy();
  expect(
    fetchMock.mock.calls.some(([url]) =>
      url.includes('/audit?page=1&pageSize=20&administratorId=admin1'),
    ),
  ).toBe(true);
  expect(screen.getByText(/移除 API 管理/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '查看前后快照 audit1' }));
  expect(screen.getByText('变更前')).toBeTruthy();
  expect(screen.getByText('变更后')).toBeTruthy();
});

test('全部授权变更记录在抽屉中查看，不按管理员过滤', async () => {
  const fetchMock = vi.fn(defaultFetch);
  vi.stubGlobal('fetch', fetchMock);
  mount();
  fireEvent.click(screen.getByRole('button', { name: '授权变更记录' }));
  await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url === '/admin-api/administrators/audit?page=1&pageSize=20')).toBe(true));
  expect(window.location.hash).toContain('administratorView=audit');
});

test('修订冲突保留权限勾选和原因，不自动覆盖新记录', async () => {
  const fetchMock = vi.fn(async (url: string, options?: RequestInit) =>
    options?.method === 'PUT'
      ? Response.json(
          { code: 40900001, resultMsg: '记录已变化', requestId: 'conflict-request' },
          { status: 409 },
        )
      : defaultFetch(url, options),
  );
  vi.stubGlobal('fetch', fetchMock);
  mount();
  fireEvent.click(await screen.findByRole('button', { name: '调整权限 示例甲' }));
  await template('审核模板');
  fireEvent.change(await screen.findByLabelText('调整原因'), { target: { value: '交接待确认' } });
  fireEvent.click(screen.getByRole('button', { name: '确认调整' }));
  expect(await screen.findByText(/记录已变化.*conflict-request/)).toBeTruthy();
  expect((screen.getByLabelText('调整原因') as HTMLInputElement).value).toBe('交接待确认');
  expect((screen.getByLabelText('发布审核') as HTMLInputElement).checked).toBe(true);
  expect(screen.getByText(/本次输入已保留/)).toBeTruthy();
  expect(fetchMock.mock.calls.filter(([, options]) => options?.method === 'PUT')).toHaveLength(1);
});

test('零业务权限总管理员可进入名单，403刷新资格仍保留编辑输入', async () => {
  let sessionReads = 0;
  const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
    if (url === '/platform-info') return ok({ name: 'CYL Open Platform', adminLoginUrl: null });
    if (url === '/admin-api/session') {
      sessionReads++;
      return sessionReads === 1
        ? ok({ ...employee, administratorId: 'admin1', superAdministrator: true, permissions: [] })
        : Response.json({ code: 403, data: null }, { status: 403 });
    }
    if (options?.method === 'PUT')
      return Response.json(
        { code: 40300001, resultMsg: '需要总管理员权限', requestId: 'denied-request' },
        { status: 403 },
      );
    return defaultFetch(url, options);
  });
  vi.stubGlobal('fetch', fetchMock);
  window.history.replaceState({}, '', '/#/admins');
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: '调整权限 示例甲' }));
  fireEvent.change(await screen.findByLabelText('调整原因'), { target: { value: '保留交接草稿' } });
  fireEvent.click(screen.getByRole('button', { name: '确认调整' }));
  await screen.findByText(/当前管理资格已被撤销/);
  expect(sessionReads).toBe(2);
  expect((screen.getByLabelText('调整原因') as HTMLInputElement).value).toBe('保留交接草稿');
  expect((screen.getByRole('button', { name: /确认调整|确认撤销/ }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  expect(window.location.hash).toContain('administrator=admin1');
  expect(screen.getByText(/当前已无分配权限/)).toBeTruthy();
});

test('无管理员查看权限时直达页面只解释所需权限，不请求名单', async () => {
  window.history.replaceState({}, '', '/#/administrators');
  const fetchMock = vi.fn(async (url: string) =>
    url === '/platform-info'
      ? ok({ name: '开放平台', adminLoginUrl: null })
      : ok({
          ...employee,
          administratorId: 'admin1',
          superAdministrator: false,
          permissions: ['MANAGE_APIS'],
        }),
  );
  vi.stubGlobal('fetch', fetchMock);
  render(<App />);
  expect(await screen.findByRole('heading', { name: '暂无此页面的操作权限' })).toBeTruthy();
  expect(screen.getByText(/查看管理员需要总管理员身份或审计查询权限/)).toBeTruthy();
  expect(fetchMock.mock.calls.some(([url]) => url.includes('/administrators'))).toBe(false);
});

test('姓名选择复用共享员工档案检索并自动核验，保留原因和权限，不自动授权', async () => {
  const profile = { ...employee, tenantName: '测试租户', displayName: '登记旧名', lastSeenAt: '2026-09-23T00:00:00Z' };
  const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
    if (url.startsWith('/admin-api/administrators/employee-profiles?')) return ok(page([profile]));
    return defaultFetch(url, options);
  });
  vi.stubGlobal('fetch', fetchMock); mount();
  assign();
  expect((await screen.findByRole('button', { name: '按姓名选择' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('员工租户 ID'), { target: { value: 't1' } });
  await verifyEmployee();
  fireEvent.change(await screen.findByLabelText('调整原因'), { target: { value: '保留当前理由' } });
  await template('研发模板');
  fireEvent.click(screen.getByRole('button', { name: '按姓名选择' }));
  await screen.findByText('登记旧名');
  fireEvent.click(screen.getByRole('button', { name: '选择 登记旧名 · E1' }));
  await screen.findByText('已核验员工：示例甲');
  expect(screen.getByLabelText('员工工号')).toHaveProperty('value', 'E1');
  expect(screen.getByLabelText('调整原因')).toHaveProperty('value', '保留当前理由');
  expect(fetchMock.mock.calls.filter(([url]) => url === '/admin-api/administrators/employee-lookup')).toHaveLength(2);
  expect(fetchMock.mock.calls.some(([url, options]) => url === '/admin-api/administrators' && options?.method === 'POST')).toBe(false);
});

test('已登记工号被回收时立即提示并禁止分配，目录故障可回到工号且保留输入', async () => {
  const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
    if (url.startsWith('/admin-api/administrators/employee-profiles?')) return ok(page([{ ...employee, employeeId: 'old-person', lastSeenAt: '2026-09-23T00:00:00Z' }]));
    return defaultFetch(url, options);
  });
  vi.stubGlobal('fetch', fetchMock); mount();
  assign();
  fireEvent.change(await screen.findByLabelText('员工租户 ID'), { target: { value: 't1' } });
  await verifyEmployee();
  fireEvent.change(await screen.findByLabelText('调整原因'), { target: { value: '保留' } });
  fireEvent.click(screen.getByRole('button', { name: '按姓名选择' }));
  fireEvent.click(await screen.findByRole('button', { name: '选择 示例甲 · E1' }));
  await screen.findByText('该工号对应的人员已变化。请改用工号核验，核对当前姓名后再分配权限。');
  expect(screen.getByRole('button', { name: '确认分配' })).toHaveProperty('disabled', true);
  fetchMock.mockImplementation(async (url: string, options?: RequestInit) => url.startsWith('/admin-api/administrators/employee-profiles?')
    ? Response.json({ code: 503, message: '人员目录暂不可用' }, { status: 503 }) : defaultFetch(url, options));
  fireEvent.click(screen.getByRole('button', { name: '按姓名选择' }));
  fireEvent.click(await screen.findByRole('button', { name: '改用工号核验' }));
  expect(screen.getByLabelText('员工工号')).toHaveProperty('value', 'E1');
  expect(screen.getByLabelText('调整原因')).toHaveProperty('value', '保留');
});

test('冲突恢复读取最新修订但保留选择和原因，明确确认才再次写入', async () => {
  let revision = 3, writes = 0;
  const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
    if (options?.method === 'PUT') {
      writes++;
      if (writes === 1) { revision = 4; return Response.json({ code: 40900001, resultMsg: '修订已变化' }, { status: 409 }); }
      expect(JSON.parse(String(options.body)).expectedRevision).toBe(4);
      return ok({ ...administrator, revision: 5 });
    }
    if (url.endsWith('/administrators/admin1')) return ok({ ...administrator, revision, permissions: revision === 4 ? ['VIEW_AUDIT'] : administrator.permissions });
    return defaultFetch(url, options);
  });
  vi.stubGlobal('fetch', fetchMock); mount();
  fireEvent.click(await screen.findByRole('button', { name: '调整权限 示例甲' }));
  await template('审核模板');
  fireEvent.change(await screen.findByLabelText('调整原因'), { target: { value: '保留原因' } });
  fireEvent.click(screen.getByRole('button', { name: '确认调整' }));
  fireEvent.click(await screen.findByRole('button', { name: '读取最新记录并保留输入' }));
  await screen.findByText(/已读取最新记录（修订 4）/);
  expect(screen.getByLabelText('发布审核')).toHaveProperty('checked', true);
  expect(screen.getByLabelText('调整原因')).toHaveProperty('value', '保留原因');
  expect(screen.getByText(/移除 审计查询/)).toBeTruthy();
  expect(writes).toBe(1);
  fireEvent.click(await screen.findByRole('button', { name: '确认调整' }));
  await screen.findByText(/管理员权限已更新/);
  expect(writes).toBe(2);
});

test('新建分阶段选人且关闭抽屉前保护输入，取消保留，姓名选择不叠模态', async () => {
  history.replaceState({}, '', '/#/administrators');
  vi.stubGlobal('fetch', vi.fn(defaultFetch)); mount();
  assign();
  await screen.findByLabelText('员工租户 ID');
  expect(screen.queryByLabelText('发布审核')).toBeNull();
  await verifyEmployee(); await template('审核模板');
  fireEvent.change(screen.getByLabelText('调整原因'), { target: { value: '待提交' } });
  fireEvent.click(screen.getByRole('button', { name: '按姓名选择' }));
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: '收起姓名选择' }));
  closeDrawer();
  const guard = await leaveDialog();
  fireEvent.click(within(guard).getByRole('button', { name: '取消', hidden: true }));
  expect(screen.getByLabelText('调整原因')).toHaveProperty('value', '待提交');
  expect(screen.getByLabelText('发布审核')).toHaveProperty('checked', true);
});

test('结构化5xx先核对最新状态，不自动再次提交', async () => {
  let writes = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
    if (options?.method === 'PUT') { writes++; return Response.json({ code: 50000001, resultMsg: '回包异常' }, { status: 502 }); }
    return defaultFetch(url, options);
  }));
  mount(); fireEvent.click(await screen.findByRole('button', { name: '调整权限 示例甲' }));
  fireEvent.change(await screen.findByLabelText('调整原因'), { target: { value: '测试未知结果' } });
  fireEvent.click(screen.getByRole('button', { name: '确认调整' }));
  await screen.findByRole('button', { name: '核对最新授权状态' });
  expect(screen.getByRole('button', { name: /确认调整/ })).toHaveProperty('disabled', true);
  fireEvent.click(screen.getByRole('button', { name: '关闭错误提示' }));
  fireEvent.click(screen.getByRole('button', { name: '核对最新授权状态' }));
  await screen.findByText(/已读取最新记录/);
  expect(writes).toBe(1);
});

test('写入中不能放弃离开，成功返回不残留过期离开确认', async () => {
  history.replaceState({}, '', '/#/administrators');
  let finish!: (response: Response) => void;
  const pending = new Promise<Response>(resolve => { finish = resolve; });
  vi.stubGlobal('fetch', vi.fn((url: string, options?: RequestInit) => options?.method === 'PUT' ? pending : defaultFetch(url, options)));
  mount(); fireEvent.click(await screen.findByRole('button', { name: '调整权限 示例甲' }));
  fireEvent.change(await screen.findByLabelText('调整原因'), { target: { value: '保存中保护' } });
  fireEvent.click(screen.getByRole('button', { name: '确认调整' }));
  closeDrawer();
  const guard = await leaveDialog();
  expect(within(guard).getByRole('button', { name: '放弃更改并离开', hidden: true })).toHaveProperty('disabled', true);
  expect(location.hash).toContain('administrator=admin1');
  finish(ok({ ...administrator, revision: 4 }));
  await screen.findByText(/管理员权限已更新/);
  expect(screen.queryByText('离开前处理未保存更改')).toBeNull();
});

test('撤销工作区改回启用时，动作名称随最终提交效果变化', async () => {
  history.replaceState({}, '', '/#/administrators?administrator=admin1&administratorView=revoke');
  vi.stubGlobal('fetch', vi.fn(defaultFetch)); mount();
  await screen.findByRole('button', { name: '确认撤销' });
  fireEvent.click(screen.getByLabelText('启用管理资格（取消即停用）'));
  expect(screen.getByRole('button', { name: '确认调整' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: '确认撤销' })).toBeNull();
});
