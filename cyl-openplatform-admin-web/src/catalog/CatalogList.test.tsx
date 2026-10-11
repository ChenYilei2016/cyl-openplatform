import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import type { AdminApi } from '../access/api';
import { AdminNavigationProvider } from '../navigation/AdminNavigation';
import CatalogList from './CatalogList';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  localStorage.clear();
  window.history.replaceState({}, '', '/');
});
const rawRevision = (source: string) => (JSON as typeof JSON & { rawJSON: (source: string) => object }).rawJSON(source) as unknown as number;
const summary = {
  id: 'api1',
  service: 'orders',
  version: 'v1',
  method: 'query',
  name: '查询订单',
  category: '订单',
  owner: '研发',
  protocol: 'HTTP',
  draftRevision: rawRevision('9007199254740994'),
  liveDraftRevision: rawRevision('9007199254740993'),
  hasUnpublishedChanges: true,
  enabled: false,
  pendingReleaseId: 'release1',
  latestReviewStatus: 'PENDING_REVIEW',
  latestReviewDraftRevision: rawRevision('9007199254740994'),
  updatedAt: '2026-09-30T08:12:00Z',
};
const unpublished = { ...summary, id: 'api2', method: 'create', name: '创建订单', liveDraftRevision: null, enabled: false, pendingReleaseId: null, latestReviewStatus: 'NOT_SUBMITTED', latestReviewDraftRevision: null };
const me = { id: 'EMP_me', displayName: '示例人员', employeeNo: 'E1001' };
const listCalls = (requests: string[]) => requests.filter((path) => path.startsWith('/apis?'));

function createApi(requests: string[], items: object[] = [summary, unpublished], total = 42): AdminApi {
  return vi.fn(async (path: string) => {
    requests.push(path);
    if (path === '/apis/owners/current') return me;
    if (path.startsWith('/apis/categories')) return { items: ['订单', '订单归档'], total: 2, page: 1, pageSize: 50 };
    return { items, total, page: 1, pageSize: 20 };
  }) as unknown as AdminApi;
}
function mount(api = createApi([]), onSelect = vi.fn(), onCopy = vi.fn()) {
  return render(
    <AdminNavigationProvider>
      <CatalogList api={api} onSelect={onSelect} onCopy={onCopy} />
    </AdminNavigationProvider>,
  );
}
const query = () => new URLSearchParams(window.location.hash.split('?')[1]);
const pick = async (combobox: string, option: string) => {
  fireEvent.mouseDown(screen.getByRole('combobox', { name: combobox }));
  fireEvent.click(await screen.findByText(option, { selector: '.ant-select-item-option-content' }));
};

test('状态列合并版本、草稿差异、审核与访问；编辑/调试一次进入，次要动作保留对象', async () => {
  const select = vi.fn(), copy = vi.fn();
  mount(createApi([]), select, copy);
  const row = await screen.findByRole('row', { name: /查询订单/ });
  expect(within(row).getByText('已暂停')).toBeTruthy();
  expect(within(row).getByText('生效 r9007199254740993')).toBeTruthy();
  expect(within(row).getByText(/待审核 提交 r9007199254740994/)).toBeTruthy();
  const other = screen.getByRole('row', { name: /创建订单/ });
  expect(within(other).getByText('未发布')).toBeTruthy();
  expect(within(other).getByText('尚未发布，暂不可调用')).toBeTruthy();
  fireEvent.click(within(row).getByRole('button', { name: '调试' }));
  expect(select).toHaveBeenLastCalledWith('api1', 'test');
  fireEvent.click(within(row).getByRole('button', { name: '查询订单' }));
  expect(select).toHaveBeenLastCalledWith('api1', 'outer');
  for (const [label, step] of [['返回与文档', 'doc'], ['发布', 'pub'], ['版本记录', 'history'], ['复制为新 API', 'copy']]) {
    fireEvent.click(within(row).getByRole('button', { name: '查询订单更多操作' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: label }));
    if (step === 'copy') expect(copy).toHaveBeenLastCalledWith(summary);
    else expect(select).toHaveBeenLastCalledWith('api1', step);
  }
});

test('已发布且有未发布修改时提示草稿修订；相信服务端差异摘要，不逐行补请求', async () => {
  const requests: string[] = [];
  mount(createApi(requests, [{ ...summary, enabled: true, pendingReleaseId: null, latestReviewStatus: 'APPROVED' }, { ...summary, id: 'same', name: '内容相同', enabled: true, pendingReleaseId: null, latestReviewStatus: 'APPROVED', hasUnpublishedChanges: false }]));
  const changed = await screen.findByRole('row', { name: /查询订单/ });
  expect(within(changed).getByText('已发布')).toBeTruthy();
  expect(within(changed).getByText('草稿 r9007199254740994 有未发布修改')).toBeTruthy();
  const same = screen.getByRole('row', { name: /内容相同/ });
  expect(same.textContent).not.toContain('未发布修改');
  expect(listCalls(requests)).toHaveLength(1);
});

test('负责人档案显示姓名、工号与租户；同名旧文本标明未关联档案，不逐行查询', async () => {
  const requests: string[] = [];
  mount(createApi(requests, [
    { ...summary, id: 'linked', name: '档案接口', owner: 'EMP_reference', ownerName: '张三', ownerProfileLinked: true, ownerEmployeeNo: 'E1001', ownerTenantId: 'tenant-1', ownerTenantName: '示例租户A' },
    { ...summary, id: 'legacy', name: '旧文本接口', owner: '张三', ownerName: '张三', ownerProfileLinked: false },
  ]));
  const linked = await screen.findByRole('row', { name: /档案接口/ });
  expect(within(linked).getByText('张三')).toBeTruthy();
  expect(within(linked).getByText('工号 E1001 · 示例租户A')).toBeTruthy();
  expect(within(linked).queryByText('未关联档案')).toBeNull();
  const legacy = screen.getByRole('row', { name: /旧文本接口/ });
  expect(within(legacy).getByText('未关联档案')).toBeTruthy();
  expect(legacy.textContent).not.toContain('E1001');
  expect(listCalls(requests)).toHaveLength(1);
  expect(requests.some((path) => path.startsWith('/apis/owners/EMP'))).toBe(false);
});

test('快捷筛选立即生效并回第一页；同维度多选取并集，已筛选条件可单项清除', async () => {
  window.history.replaceState({}, '', '/#/apis?pageNo=3&review=APPROVED');
  const requests: string[] = [];
  mount(createApi(requests));
  await screen.findByText('查询订单');
  expect(listCalls(requests)[0]).toContain('page=3');
  expect(listCalls(requests)[0]).toContain('sort=UPDATED_DESC');
  await pick('协议', 'Dubbo');
  await waitFor(() => expect(query().getAll('protocol')).toEqual(['DUBBO']));
  expect(query().has('pageNo')).toBe(false);
  await pick('状态', '已发布');
  await pick('状态', '待审核');
  await waitFor(() => expect(query().getAll('review')).toEqual(['APPROVED', 'PENDING_REVIEW']));
  expect(query().getAll('publication')).toEqual(['PUBLISHED']);
  const last = new URL(listCalls(requests).at(-1)!, 'https://test').searchParams;
  expect(last.getAll('protocol')).toEqual(['DUBBO']);
  expect(last.getAll('review')).toEqual(['APPROVED', 'PENDING_REVIEW']);
  const chips = screen.getByRole('group', { name: '已生效的筛选条件' });
  expect(within(chips).getByText('审核：审核通过')).toBeTruthy();
  fireEvent.click(within(chips).getByRole('button', { name: '清除 协议：Dubbo' }));
  await waitFor(() => expect(query().has('protocol')).toBe(false));
  expect(query().getAll('publication')).toEqual(['PUBLISHED']);
  fireEvent.click(within(chips).getByRole('button', { name: '清除全部' }));
  await waitFor(() => expect(window.location.hash).toBe('#/apis'));
});

test('搜索框停止输入后才查询，回车立即查询；输入法确认中不提交', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const requests: string[] = [];
  mount(createApi(requests));
  await screen.findByText('查询订单');
  const box = screen.getByRole('combobox', { name: '搜索 API' });
  fireEvent.change(box, { target: { value: ' order ' } });
  expect(query().has('query')).toBe(false);
  await act(async () => { vi.advanceTimersByTime(350); });
  await waitFor(() => expect(query().get('query')).toBe('order'));
  fireEvent.change(box, { target: { value: 'orders' } });
  fireEvent.keyDown(box, { key: 'Enter', isComposing: true });
  expect(query().get('query')).toBe('order');
  fireEvent.keyDown(box, { key: 'Enter' });
  await waitFor(() => expect(query().get('query')).toBe('orders'));
});

test('输入类名时建议按内部类搜索；内部定位筛选时自动显示内部定位列', async () => {
  const requests: string[] = [];
  mount(createApi(requests, [{ ...summary, internalClass: 'com.company.order.OrderClient', internalMethod: 'lookup' }]));
  await screen.findByText('查询订单');
  expect(screen.queryByRole('columnheader', { name: '内部定位' })).toBeNull();
  const box = screen.getByRole('combobox', { name: '搜索 API' });
  fireEvent.change(box, { target: { value: 'OrderClient#lookup' } });
  fireEvent.click(await screen.findByText(/按内部类搜索/));
  await waitFor(() => expect(query().get('internalClass')).toBe('OrderClient'));
  expect(query().get('internalMethod')).toBe('lookup');
  expect(query().has('query')).toBe(false);
  const params = new URL(listCalls(requests).at(-1)!, 'https://test').searchParams;
  expect(params.get('internalMatch')).toBe('CONTAINS');
  expect(await screen.findByRole('columnheader', { name: '内部定位' })).toBeTruthy();
  const row = screen.getByRole('row', { name: /查询订单/ });
  expect(row.textContent).toContain('OrderClient#lookup');
});

test('内部类、方法、精确匹配与负责人在更多筛选中组合，地址可还原', async () => {
  window.history.replaceState({}, '', '/#/apis?internalClass=OrderClient&internalMatch=EXACT&internalMethod=lookup&ownerId=EMP_reference&pageNo=2');
  const requests: string[] = [];
  const selected = vi.fn();
  mount(createApi(requests, [{ ...summary, internalClass: 'com.company.order.OrderClient', internalMethod: 'lookup', owner: 'old_owner', ownerProfileLinked: false }]), selected);
  const row = await screen.findByRole('row', { name: /查询订单/ });
  expect(row.textContent).toContain('OrderClient#lookup');
  expect(row.textContent).toContain('未关联档案');
  const url = new URL(listCalls(requests)[0], 'https://test');
  expect(url.searchParams.get('internalClass')).toBe('OrderClient');
  expect(url.searchParams.get('internalMethod')).toBe('lookup');
  expect(url.searchParams.get('internalMatch')).toBe('EXACT');
  expect(url.searchParams.get('ownerId')).toBe('EMP_reference');
  expect(url.searchParams.get('page')).toBe('2');
  const chips = screen.getByRole('group', { name: '已生效的筛选条件' });
  expect(within(chips).getByText('内部类（精确）：OrderClient')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /更多筛选/ }));
  fireEvent.click(await screen.findByText('包含'));
  await waitFor(() => expect(query().get('internalMatch')).toBe('CONTAINS'));
  expect(query().has('pageNo')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: /^完\s*成$/ }));
  const refreshed = await screen.findByRole('row', { name: /查询订单/ });
  fireEvent.click(within(refreshed).getByRole('button', { name: /^编\s*辑$/ }));
  expect(selected).toHaveBeenCalledWith('api1', 'outer');
});

test('更多筛选中的分类、审核与访问立即生效，空结果提示清除筛选而非首次接入', async () => {
  const requests: string[] = [];
  mount(createApi(requests, [], 0));
  expect(await screen.findByText('还没有 API')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /更多筛选/ }));
  fireEvent.click(await screen.findByRole('checkbox', { name: '访问关闭' }));
  await waitFor(() => expect(listCalls(requests).some((path) => path.includes('access=DISABLED') && path.includes('page=1'))).toBe(true));
  fireEvent.click(screen.getByRole('checkbox', { name: '已驳回' }));
  await waitFor(() => expect(query().getAll('review')).toEqual(['REJECTED']));
  await pick('展示分类', '订单归档');
  await waitFor(() => expect(query().get('category')).toBe('订单归档'));
  fireEvent.click(screen.getByRole('button', { name: /^完\s*成$/ }));
  expect(await screen.findByText('没有符合条件的 API')).toBeTruthy();
  expect(screen.queryByText('还没有 API')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '清除筛选' }));
  await waitFor(() => expect(window.location.hash).toBe('#/apis'));
});

test('“我负责的”按当前人员稳定引用查询，不自动套用；不发起核验请求', async () => {
  const calls: { path: string; method?: string }[] = [];
  const api = vi.fn(async (path: string, options?: { method?: string }) => {
    calls.push({ path, method: options?.method });
    if (path === '/apis/owners/current') return me;
    return { items: [summary], total: 1, page: 1, pageSize: 20 };
  }) as unknown as AdminApi;
  mount(api);
  await screen.findByText('查询订单');
  expect(calls.filter((call) => call.path.startsWith('/apis?')).every((call) => !call.path.includes('ownerId'))).toBe(true);
  await pick('负责人', '我负责的');
  await waitFor(() => expect(calls.some((call) => call.path.includes('ownerId=EMP_me'))).toBe(true));
  expect(within(screen.getByRole('group', { name: '已生效的筛选条件' })).getByText('负责人：我负责的')).toBeTruthy();
  expect(calls.some((call) => call.path.includes('/verify') || call.method === 'POST')).toBe(false);
});

test('点击更新时间排序写入地址并回第一页；默认倒序不写入', async () => {
  window.history.replaceState({}, '', '/#/apis?pageNo=2');
  const requests: string[] = [];
  mount(createApi(requests));
  await screen.findByText('查询订单');
  fireEvent.click(screen.getByRole('columnheader', { name: /更新时间/ }));
  await waitFor(() => expect(query().get('sort')).toBe('UPDATED_ASC'));
  expect(query().has('pageNo')).toBe(false);
  expect(listCalls(requests).at(-1)).toContain('sort=UPDATED_ASC');
});

test('加载失败清除旧列表且不自动重试，用户可重试恢复', async () => {
  let fail = true;
  const api = vi.fn(async (path: string) => {
    if (path === '/apis/owners/current') return me;
    if (fail) throw new Error('读取失败（请求号：req）');
    return { items: [summary], total: 1, page: 1, pageSize: 20 };
  }) as unknown as AdminApi;
  mount(api);
  expect(await screen.findByText('API 列表加载失败')).toBeTruthy();
  expect(screen.getByText('读取失败（请求号：req）')).toBeTruthy();
  fail = false;
  fireEvent.click(screen.getByRole('button', { name: '重新加载' }));
  expect(await screen.findByText('查询订单')).toBeTruthy();
});

test('身份客户端改变不会展示上一身份缓存', async () => {
  const view = mount(createApi([]));
  await screen.findByText('查询订单');
  const second = vi.fn(() => new Promise(() => {})) as unknown as AdminApi;
  view.rerender(
    <AdminNavigationProvider>
      <CatalogList api={second} onSelect={vi.fn()} onCopy={vi.fn()} />
    </AdminNavigationProvider>,
  );
  expect(screen.queryByText('查询订单')).toBeNull();
});

test('列设置可隐藏列并在本地记住', async () => {
  const view = mount();
  await screen.findByText('查询订单');
  fireEvent.click(screen.getByRole('button', { name: '列设置' }));
  fireEvent.click(await screen.findByRole('checkbox', { name: '分类' }));
  await waitFor(() => expect(screen.queryByRole('columnheader', { name: '分类' })).toBeNull());
  view.unmount();
  mount();
  await screen.findByText('查询订单');
  expect(screen.queryByRole('columnheader', { name: '分类' })).toBeNull();
});

test('复制的 service.method 优先按标识搜索，当前页规则数批量读取并清除目标页旧筛选', async () => {
  const requests: string[] = [];
  window.history.replaceState({}, '', '/#/apis?filter.governanceRules.nameContains=旧条件&filter.governanceRules.page=3');
  const base = createApi(requests);
  const api = vi.fn(async (path: string, options) => {
    if (path.startsWith('/governance-rules/association-counts?')) {
      requests.push(path);
      return { api1: 3 };
    }
    return base(path, options);
  }) as AdminApi;
  mount(api);
  const row = await screen.findByRole('row', { name: /查询订单/ });
  const link = await within(row).findByRole('button', { name: '查看 3 条关联规则' });
  const counts = requests.filter(path => path.startsWith('/governance-rules/association-counts?'));
  expect(counts).toHaveLength(1);
  expect(new URL(counts[0], 'https://test').searchParams.getAll('targetId')).toEqual(['api1', 'api2']);
  const box = screen.getByRole('combobox', { name: '搜索 API' });
  fireEvent.change(box, { target: { value: 'orders.query' } });
  fireEvent.click(await screen.findByText(/按名称或标识搜索/));
  await waitFor(() => expect(query().get('query')).toBe('orders.query'));
  expect(query().has('internalClass')).toBe(false);
  const longestIdentity = 's'.repeat(64) + '.' + 'm'.repeat(64);
  fireEvent.change(box, { target: { value: longestIdentity } });
  fireEvent.click(await screen.findByText(/按名称或标识搜索/));
  await waitFor(() => expect(query().get('query')).toBe(longestIdentity));
  expect(box).toHaveProperty('maxLength', 129);
  fireEvent.click(link);
  expect(window.location.hash).toContain('/traffic-rules');
  expect(query().get('filter.governanceRules.apiId')).toBe('api1');
  expect(query().has('filter.governanceRules.nameContains')).toBe(false);
  expect(query().has('filter.governanceRules.page')).toBe(false);
});
