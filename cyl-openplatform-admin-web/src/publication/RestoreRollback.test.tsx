import { PlatformTheme } from '@cyl/open-platform-web-shared/ui/PlatformTheme';
import type { ReactNode } from 'react';
import { workspaceSnapshot } from '../testing/workspace';
import { cleanup, fireEvent, render as rawRender, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { parseJson, stringifyJson } from '@cyl/open-platform-web-shared/json';
import { createAdminApi } from '../access/api';
import CatalogPanel, { type ApiDefinition } from '../catalog/CatalogPanel';
import RestoreDrawer from '../catalog/versions/RestoreDrawer';
import RollbackDrawer from '../catalog/versions/RollbackDrawer';
import { AdminNavigationProvider } from '../navigation/AdminNavigation';
import PublicationPanel from './PublicationPanel';
import ReleaseReview from './ReleaseReview';
import type { PublicationSubmission } from './types';

const render = (ui: ReactNode) => rawRender(ui, { wrapper: PlatformTheme });
const current: ApiDefinition = {
  id: 'api1', name: '工作草稿', service: 'orders', version: 'v1', method: 'query', category: '订单', owner: '研发',
  protocol: 'HTTP', draftRevision: parseJson('9007199254740993'), scopeCodes: [],
  requestSchema: { type: 'OBJECT', properties: {} }, responseSchema: { type: 'OBJECT', properties: {} },
  errorDefinitions: [], mappings: [], binding: { protocol: 'HTTP', timeoutMillis: 3000, http: { url: 'http://orders.internal/query', method: 'POST' } },
};
const historical = { ...current, name: '历史配置', draftRevision: 1 };
const state = { apiId: 'api1', stateVersion: parseJson<number>('9007199254740994'), enabled: false, liveReleaseId: 'live', pendingReleaseId: null };
const source = { id: 'source', apiId: 'api1', name: '历史配置', service: 'orders', version: 'v1', method: 'query', draftRevision: 1,
  status: 'APPLIED', auditRequired: true, submittedAt: '2026-09-21T08:00:00Z', submittedByEmployeeNo: '001', submittedByTenantId: 't1', submittedByName: '张三',
  snapshot: historical, baselineKnown: true, baseline: null, comment: '原发布', kind: 'STANDARD' };
const live = { ...source, id: 'live', draftRevision: 2, submittedAt: '2026-09-22T08:00:00Z', snapshot: { ...current, name: '在线配置', draftRevision: 2 } };
const metadata = { apiId: 'api1', revision: 1, source: 'UPDATE_API_DRAFT', summary: '编辑保存', operatorTenantId: 't1', operatorEmployeeNo: '001', operatorName: '张三', recordedAt: '2026-09-21T07:00:00Z' };
const page = (items: unknown[]) => ({ items, total: items.length, page: 1, pageSize: 20 });
const ok = (data: unknown) => new Response(stringifyJson({ code: 200, data }));
const liveWorkspace = (definition: ApiDefinition, publication: { pendingReleaseId?: string | null } = {}) => {
  const value = workspaceSnapshot(definition);
  return { ...value, publication: { ...value.publication, ...state, ...publication }, liveDraftRevision: 2 };
};
// 版本页用例经完整 API 工作区挂载，整轮并行时较慢。
vi.setConfig({ testTimeout: 15000 });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState({}, '', '/#/catalog'); });

function setup(handler?: (path: string, init?: RequestInit) => Response | Promise<Response> | undefined) {
  const calls = vi.fn(async (path: string, init?: RequestInit) => {
    const custom = await handler?.(path, init);
    if (custom) return custom;
    if (path.endsWith('/apis/api1/workspace')) return ok(liveWorkspace(current));
    if (path.endsWith('/apis/api1')) return ok(current);
    if (path.endsWith('/revisions/1')) return ok({ ...metadata, snapshot: historical });
    if (path.includes('/revisions?')) return ok(page([metadata]));
    if (path.includes('/releases?')) return ok(page([live, source, { ...source, id: 'rejected', draftRevision: 3, status: 'REJECTED', submittedAt: '2026-09-20T08:00:00Z' }]));
    if (path.endsWith('/state')) return ok(state);
    if (path.endsWith('/config')) return ok({ auditEnabled: true });
    if (path.endsWith('/effective')) return ok({ ...state, releaseId: 'live', snapshot: live.snapshot });
    if (path.endsWith('/publications/source')) return ok(source);
    if (path.endsWith('/publications/live')) return ok(live);
    if (path.endsWith('/environment-releases/targets')) return ok([]);
    if (path.includes('/categories?')) return ok(page(['订单']));
    if (path.includes('?')) return ok(page([]));
    throw new Error(path);
  });
  vi.stubGlobal('fetch', calls);
  return { calls, api: createAdminApi('proof', vi.fn()) };
}

function openVersions(api: ReturnType<typeof createAdminApi>, permissions = ['MANAGE_APIS', 'PUBLISH_APIS'], pending = new Map<string, PublicationSubmission>()) {
  window.history.replaceState({}, '', '/#/apis/api1/versions');
  return render(<AdminNavigationProvider><CatalogPanel api={api} permissions={permissions} pendingSubmissions={pending} /></AdminNavigationProvider>);
}

async function openRollback() {
  const button = await screen.findByRole('button', { name: '回滚到 r1' }, { timeout: 5000 });
  await waitFor(() => expect(button.matches(':disabled')).toBe(false));
  fireEvent.click(button);
  await screen.findByText('当前生效 r2');
  fireEvent.change(screen.getByLabelText('回滚原因'), { target: { value: '恢复已验证配置' } });
}

test('恢复先处理未保存输入，取消不读取快照', async () => {
  const { calls, api } = setup();
  const onClose = vi.fn();
  render(<RestoreDrawer api={api} apiId="api1" revision="1" canManage hasUnsavedChanges={() => true} onClose={onClose} onRestored={vi.fn()} />);
  expect(await screen.findByText('配置页有未保存的修改')).toBeTruthy();
  expect(screen.getByRole('button', { name: '确认恢复草稿' }).matches(':disabled')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(onClose).toHaveBeenCalledOnce();
  expect(calls).not.toHaveBeenCalled();
});

test.each([true, false])('恢复固定快照后同步编辑器及时间线，changed=%s反馈准确', async changed => {
  let restored = false;
  const { calls, api } = setup(path => {
    if (path.endsWith('/restore')) { restored = true; return ok({ ...historical, draftRevision: changed ? 4 : current.draftRevision, changed }); }
    if (path.endsWith('/apis/api1/workspace')) return ok(liveWorkspace(restored ? historical : current));
    if (path.endsWith('/apis/api1')) return ok(restored ? historical : current);
  });
  window.history.replaceState({}, '', '/#/apis/api1/config');
  render(<AdminNavigationProvider><CatalogPanel api={api} permissions={['MANAGE_APIS']} /></AdminNavigationProvider>);
  fireEvent.change(await screen.findByLabelText('接口名称'), { target: { value: '未保存工作' } });
  fireEvent.click(screen.getByRole('tab', { name: '版本与生命周期' }));
  fireEvent.click(await screen.findByRole('button', { name: '恢复 r1 为草稿' }));
  fireEvent.click(await screen.findByLabelText('我确认放弃未保存的修改，继续核对恢复内容'));
  await screen.findByText('恢复为 r1');
  expect(screen.getByText('当前草稿 r9007199254740993')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '确认恢复草稿' }));
  await screen.findByText(changed ? /已恢复为新草稿 r4/ : /内容相同，未增加草稿修订/);
  fireEvent.click(screen.getByRole('tab', { name: '配置' }));
  expect((await screen.findByLabelText('接口名称') as HTMLInputElement).value).toBe('历史配置');
  const writes = calls.mock.calls.filter(([, init]) => init?.method === 'POST');
  expect(writes).toHaveLength(1);
  expect(writes[0][0]).toContain('/revisions/1/restore');
  expect(writes[0][1]?.body).toBe('{"expectedRevision":9007199254740993}');
});

test('恢复409保留并要求重新读取，撤销权限不能恢复', async () => {
  const { calls, api } = setup(path => path.endsWith('/restore') ? new Response(stringifyJson({ code: 40900001, resultMsg: '草稿已更新' }), { status: 409 }) : undefined);
  const props = { api, apiId: 'api1', revision: '1', hasUnsavedChanges: () => false, onClose: vi.fn(), onRestored: vi.fn() };
  const view = render(<RestoreDrawer {...props} canManage />);
  await screen.findByText('恢复为 r1');
  fireEvent.click(screen.getByRole('button', { name: '确认恢复草稿' }));
  await screen.findByText(/草稿已更新/);
  expect(screen.getByRole('button', { name: '确认恢复草稿' }).matches(':disabled')).toBe(true);
  expect(screen.getByRole('button', { name: '重新读取' })).toBeTruthy();
  expect(props.onRestored).not.toHaveBeenCalled();
  view.rerender(<RestoreDrawer {...props} canManage={false} />);
  expect(screen.getByText(/当前账号没有 API 管理权限/)).toBeTruthy();
  expect(calls.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
});

test('恢复核对期间产生未保存修改，需重新确认放弃', async () => {
  const { api, calls } = setup();
  let dirty = false;
  const props = { api, apiId: 'api1', revision: '1', canManage: true, hasUnsavedChanges: () => dirty, onClose: vi.fn(), onRestored: vi.fn() };
  const view = render(<RestoreDrawer {...props} />);
  await screen.findByText('恢复为 r1');
  dirty = true;
  view.rerender(<RestoreDrawer {...props} />);
  expect(screen.getByLabelText('我确认放弃未保存的修改，继续核对恢复内容')).toHaveProperty('checked', false);
  expect(screen.getByRole('button', { name: '确认恢复草稿' })).toHaveProperty('disabled', true);
  expect(calls.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
});

test.each([502, 50000001])('回滚%s保留原提交键和原正文，404查无记录后才允许同请求重试', async code => {
  let writes = 0;
  const pending = new Map<string, PublicationSubmission>();
  const { calls, api } = setup((path, init) => {
    if (path.endsWith('/rollbacks') && init?.method === 'POST') {
      writes++;
      if (writes === 1) return new Response(stringifyJson({ code, resultMsg: '结果未知' }), { status: 502 });
      return ok({ ...source, id: 'rollback1', status: 'PENDING', kind: 'ROLLBACK', sourceReleaseId: 'source' });
    }
    if (path.includes('/submissions/')) return new Response(stringifyJson({ code: 40400001, resultMsg: '未找到' }), { status: 404 });
  });
  openVersions(api, ['MANAGE_APIS', 'PUBLISH_APIS'], pending);
  await openRollback();
  expect(screen.getByText(/工作草稿保留，访问开关保持“已停用”/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '提交回滚审核' }));
  await screen.findByText('提交结果未知，请先查询原提交');
  expect(screen.getByText(/回滚发布 · 备注：恢复已验证配置/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: '重试原提交' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '查询原提交结果' }));
  fireEvent.click(await screen.findByRole('button', { name: '重试原提交' }));
  await screen.findByText(/回滚结果：待审核/);
  expect(pending.size).toBe(0);
  const posts = calls.mock.calls.filter(([, init]) => init?.method === 'POST');
  expect(posts).toHaveLength(2);
  expect(posts[1][1]?.body).toBe(posts[0][1]?.body);
  expect(posts[0][1]?.body).toContain('"expectedStateVersion":9007199254740994');
  expect(parseJson(String(posts[0][1]?.body))).toMatchObject({ sourceReleaseId: 'source', expectedLiveReleaseId: 'live', comment: '恢复已验证配置', submissionKey: expect.any(String) });
  expect(posts.every(([path]) => path.endsWith('/rollbacks'))).toBe(true);
});

test('读取期间基线变化阻断回滚，不将当前草稿冒充生效快照', async () => {
  let reads = 0;
  const { api } = setup(path => path.endsWith('/state') ? ok(++reads > 1 ? { ...state, liveReleaseId: 'new-live' } : state) : undefined);
  const submit = vi.fn();
  render(<RollbackDrawer api={api} apiId="api1" releaseId="source" canPublish blocked={false} onSubmit={submit} onClose={vi.fn()} />);
  expect(await screen.findByText(/生效版本或访问状态在读取期间发生变化/)).toBeTruthy();
  expect(screen.getByRole('button', { name: '确认回滚' })).toHaveProperty('disabled', true);
  expect(submit).not.toHaveBeenCalled();
});

test('待审核时回滚不可用并说明原因；无发布权限不出现回滚；当前生效记录不出现回滚', async () => {
  const { api } = setup(path => path.endsWith('/apis/api1/workspace') ? ok(liveWorkspace(current, { pendingReleaseId: 'pending1' })) : undefined);
  const view = openVersions(api);
  const button = await screen.findByRole('button', { name: '回滚到 r1' }, { timeout: 5000 });
  expect(button).toHaveProperty('disabled', true);
  expect(screen.queryByRole('button', { name: '回滚到 r2' })).toBeNull();
  view.unmount();
  openVersions(api, ['MANAGE_APIS']);
  await screen.findAllByRole('button', { name: '查看快照' }, { timeout: 5000 });
  expect(screen.queryByRole('button', { name: '回滚到 r1' })).toBeNull();
});

test('免审回滚原因必填，权限撤销保留原因且不能提交', async () => {
  const { api } = setup(path => path.endsWith('/config') ? ok({ auditEnabled: false }) : undefined);
  const submit = vi.fn();
  const props = { api, apiId: 'api1', releaseId: 'source', blocked: false, onSubmit: submit, onClose: vi.fn() };
  const view = render(<RollbackDrawer {...props} canPublish />);
  await screen.findByText('当前生效 r2');
  expect(screen.getByText(/本环境免审，确认后直接生效/)).toBeTruthy();
  const confirm = screen.getByRole('button', { name: '确认回滚并生效' });
  expect(confirm.matches(':disabled')).toBe(true);
  fireEvent.change(screen.getByLabelText('回滚原因'), { target: { value: '回滚原因保留' } });
  expect(confirm.matches(':disabled')).toBe(false);
  view.rerender(<RollbackDrawer {...props} canPublish={false} />);
  expect(screen.getByRole('button', { name: '确认回滚并生效' }).matches(':disabled')).toBe(true);
  expect((screen.getByLabelText('回滚原因') as HTMLTextAreaElement).value).toBe('回滚原因保留');
  expect(submit).not.toHaveBeenCalled();
});

test('409回滚结束原提交但保留原因，重新核对会再读生效基线', async () => {
  const pending = new Map<string, PublicationSubmission>();
  const { calls, api } = setup(path => path.endsWith('/rollbacks') ? new Response(stringifyJson({ code: 40900001, resultMsg: '生效基线已变更' }), { status: 409 }) : undefined);
  openVersions(api, ['MANAGE_APIS', 'PUBLISH_APIS'], pending);
  await openRollback();
  fireEvent.click(screen.getByRole('button', { name: '提交回滚审核' }));
  await screen.findByText('生效基线已变更');
  expect(pending.size).toBe(0);
  expect(screen.queryByRole('button', { name: '查询原提交结果' })).toBeNull();
  const reads = calls.mock.calls.filter(([path]) => path.endsWith('/publications/live')).length;
  fireEvent.click(await screen.findByRole('button', { name: '重新核对' }));
  await waitFor(() => expect(calls.mock.calls.filter(([path]) => path.endsWith('/publications/live')).length).toBe(reads + 1));
  expect((screen.getByLabelText('回滚原因') as HTMLTextAreaElement).value).toBe('恢复已验证配置');
});

test('重进工作区查询到原回滚结果直接接纳，不再创建新提交', async () => {
  const pending = new Map<string, PublicationSubmission>([['api1', {
    submissionKey: 'rollback-original', sourceReleaseId: 'source', expectedLiveReleaseId: 'live', expectedStateVersion: state.stateVersion, comment: '原回滚原因',
  }]]);
  const { calls, api } = setup(path => path.endsWith('/submissions/rollback-original') ? ok({ ...source, id: 'rollback1', kind: 'ROLLBACK', sourceReleaseId: 'source', status: 'APPLIED' }) : undefined);
  openVersions(api, ['MANAGE_APIS', 'PUBLISH_APIS'], pending);
  fireEvent.click(await screen.findByRole('button', { name: '查询原提交结果' }, { timeout: 5000 }));
  await screen.findByText(/回滚结果：已生效/);
  expect(pending.size).toBe(0);
  expect(calls.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
});

test('审核列表和固定详情明确显示回滚来源与原因', async () => {
  const rollback = { ...source, id: 'rollback1', kind: 'ROLLBACK', sourceReleaseId: 'source', status: 'PENDING', comment: '修复线上错误', baseline: live.snapshot };
  const { api } = setup(path => {
    if (path.includes('/publications?page=')) return ok(page([rollback]));
    if (path.endsWith('/publications/rollback1')) return ok(rollback);
    if (path.endsWith('/environment-releases/incoming/rollback1')) return ok(null);
  });
  window.history.replaceState({}, '', '/#/publications');
  render(<AdminNavigationProvider><PublicationPanel api={api} permissions={['REVIEW_APIS']} pendingSubmissions={new Map()} /></AdminNavigationProvider>);
  expect(await screen.findByText(/回滚发布 · 修复线上错误/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '查看固定快照与差异' }));
  expect(await screen.findByText(/回滚发布 · 来源 source/)).toBeTruthy();
  expect(screen.getByText(/通过后只更新生效快照，草稿和独立开关保持/)).toBeTruthy();
  // 提交人显示姓名与工号，租户 ID 只在悬停中。
  const facts = within(screen.getByRole('region', { name: '提交信息' }));
  expect(facts.getByText('张三')).toBeTruthy();
  expect(facts.getByText('工号 001')).toBeTruthy();
  expect(facts.queryByText(/租户/)).toBeNull();
});

test('升级前申请即使保存了快照，缺少状态基线仍禁止批准并保留驳回', async () => {
  const oldPending = { ...source, status: 'PENDING', baselineKnown: true, baseline: live.snapshot, baselineStateVersion: null };
  const { calls, api } = setup((path, init) => {
    if (path.endsWith('/publications/source')) return ok(oldPending);
    if (path.endsWith('/environment-releases/incoming/source')) return ok(null);
    if (path.endsWith('/publications/source/reject') && init?.method === 'POST') return ok({ ...oldPending, status: 'REJECTED', reviewComment: '旧申请重新提交' });
  });
  render(<ReleaseReview api={api} releaseId="source" canReview onChanged={vi.fn()} onBack={vi.fn()} />);
  expect(await screen.findByText('此申请缺少精确生效基线，不能通过；请填写驳回原因，退回重新提交。')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('审核意见'), { target: { value: '旧申请重新提交' } });
  await waitFor(() => expect(screen.getByRole('button', { name: '驳回' }).matches(':disabled')).toBe(false));
  expect(screen.getByRole('button', { name: '通过审核' }).matches(':disabled')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '驳回' }));
  await screen.findByText(/本次申请已驳回/);
  const posts = calls.mock.calls.filter(([, init]) => init?.method === 'POST');
  expect(posts).toHaveLength(1);
  expect(posts[0][0]).toContain('/publications/source/reject');
});

test('发布与版本页签共用未知提交状态，切换后不能发起新回滚覆盖原键', async () => {
  let queried = false;
  const pending = new Map<string, PublicationSubmission>();
  const submitted = { ...source, id: 'new-release', status: 'PENDING', draftRevision: current.draftRevision, snapshot: current };
  const { api, calls } = setup((path, init) => {
    if (path.endsWith('/submissions') && init?.method === 'POST') throw new TypeError('lost response');
    if (path.includes('/submissions/')) { queried = true; return ok(submitted); }
    if (path.endsWith('/state')) return ok({ ...state, pendingReleaseId: queried ? 'new-release' : null });
    if (path.endsWith('/publications/new-release')) return ok(submitted);
  });
  window.history.replaceState({}, '', '/#/apis/api1/publish');
  render(<AdminNavigationProvider><CatalogPanel api={api} permissions={['MANAGE_APIS', 'PUBLISH_APIS']} pendingSubmissions={pending} /></AdminNavigationProvider>);
  const submit = await screen.findByRole('button', { name: '提交审核' }, { timeout: 5000 });
  await waitFor(() => expect(submit).toHaveProperty('disabled', false));
  fireEvent.click(submit);
  await screen.findByRole('button', { name: '查询原提交结果' });
  const original = pending.get('api1')?.submissionKey;
  expect(original).toBeTruthy();
  fireEvent.click(screen.getByRole('tab', { name: '版本与生命周期' }));
  expect(await screen.findByRole('button', { name: '回滚到 r1' }, { timeout: 5000 })).toHaveProperty('disabled', true);
  expect(pending.get('api1')?.submissionKey).toBe(original);
  fireEvent.click(screen.getByRole('button', { name: '查询原提交结果' }));
  await screen.findByText(/提交结果：待审核/);
  expect(pending.size).toBe(0);
  expect(calls.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
});

test('时间线按时间合并草稿修订与发布，可按类型筛选并显示操作人姓名', async () => {
  const { api } = setup();
  openVersions(api);
  const timeline = await screen.findByRole('list', { name: '版本时间线' }, { timeout: 5000 });
  await waitFor(() => expect(within(timeline).getAllByRole('listitem')).toHaveLength(4));
  const titles = within(timeline).getAllByRole('listitem').map((item) => item.textContent ?? '');
  expect(titles[0]).toContain('发布r2');
  expect(titles[0]).toContain('当前生效');
  expect(titles[1]).toContain('发布r1');
  expect(titles[2]).toContain('草稿r1');
  expect(titles[2]).toContain('张三');
  expect(titles[3]).toContain('已驳回');
  fireEvent.click(screen.getByText('草稿修订 1'));
  await waitFor(() => expect(within(timeline).getAllByRole('listitem')).toHaveLength(1));
  fireEvent.click(screen.getByText('发布 3'));
  await waitFor(() => expect(within(timeline).getAllByRole('listitem')).toHaveLength(3));
});

test('时间线分页归并：只展示能确定顺序的记录，加载更多读取卡住边界的来源', async () => {
  const older = { ...source, id: 'older', draftRevision: 0, submittedAt: '2026-09-01T08:00:00Z' };
  const { api, calls } = setup(path => {
    if (path.includes('/releases?page=1')) return ok({ items: [live], total: 2, page: 1, pageSize: 20 });
    if (path.includes('/releases?page=2')) return ok({ items: [older], total: 2, page: 2, pageSize: 20 });
  });
  openVersions(api);
  const timeline = await screen.findByRole('list', { name: '版本时间线' }, { timeout: 5000 });
  // 发布还有下一页，末项 r2（09-22）之后的草稿 r1（09-21）暂不能确定顺序。
  await waitFor(() => expect(within(timeline).getAllByRole('listitem')).toHaveLength(1));
  fireEvent.click(screen.getByRole('button', { name: '加载更早的记录' }));
  await waitFor(() => expect(within(timeline).getAllByRole('listitem')).toHaveLength(3));
  expect(calls.mock.calls.filter(([path]) => path.includes('/revisions?')).length).toBe(1);
  expect(screen.queryByRole('button', { name: '加载更早的记录' })).toBeNull();
});

test('勾选任意两项比较，第三项不可选；比较失败可重试', async () => {
  let fail = true;
  const { api, calls } = setup(path => {
    if (path.endsWith('/publications/source')) return fail ? Response.json({ code: 500, resultMsg: '快照读取失败' }, { status: 500 }) : ok(source);
  });
  openVersions(api);
  fireEvent.click(await screen.findByLabelText('选择草稿 r1', {}, { timeout: 5000 }));
  fireEvent.click(screen.getByLabelText('选择发布 r1'));
  expect(screen.getByLabelText('选择发布 r2')).toHaveProperty('disabled', true);
  fireEvent.click(screen.getByRole('button', { name: '比较所选' }));
  await screen.findByText(/快照读取失败/);
  fail = false;
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  await screen.findByText('草稿 r1 → 发布 r1 · 审核通过');
  expect(screen.getByText('两个版本内容无差异')).toBeTruthy();
  expect(calls.mock.calls.filter(([path]) => path.endsWith('/publications/source'))).toHaveLength(2);
});

test('查看发布快照可由地址定位并返回版本页', async () => {
  const { api } = setup(path => path.endsWith('/environment-releases/incoming/source') ? ok(null) : undefined);
  openVersions(api);
  const row = (await screen.findByLabelText('选择发布 r1', {}, { timeout: 5000 })).closest('li')!;
  fireEvent.click(within(row as HTMLElement).getByRole('button', { name: '查看快照' }));
  await screen.findByRole('button', { name: '返回版本与生命周期' });
  expect(window.location.hash).toContain('release=source');
  fireEvent.click(screen.getByRole('button', { name: '返回版本与生命周期' }));
  await screen.findByRole('list', { name: '版本时间线' }, { timeout: 5000 });
  expect(window.location.hash).not.toContain('release=');
});
