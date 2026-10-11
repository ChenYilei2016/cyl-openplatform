import { lifecycleStatusNames } from '@cyl/open-platform-web-shared/lifecycle';
import { PlatformTheme } from '@cyl/open-platform-web-shared/ui/PlatformTheme';
import type { ReactNode } from 'react';
import { workspaceSnapshot } from '../testing/workspace';
import { AdminNavigationProvider } from '../navigation/AdminNavigation';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { createAdminApi } from '../access/api';
import CatalogPanel from '../catalog/CatalogPanel';
import AffectedApplications from './AffectedApplications';
import LifecycleDetails, { defaultLifecycle } from '@cyl/open-platform-web-shared/lifecycle';

const ok = (data: unknown) => Response.json({ code: 200, data, requestId: 'lifecycle-test' });
const definition = { id: 'api1', service: 'orders', version: 'v1', method: 'query', name: '查询订单', category: '订单', owner: '研发', protocol: 'HTTP', draftRevision: 3, scopeCodes: ['orders'], requestSchema: { type: 'OBJECT' }, responseSchema: { type: 'OBJECT' }, errorDefinitions: [], binding: { protocol: 'HTTP', timeoutMillis: 3000, http: { url: 'http://orders.internal/query', method: 'POST' } }, mappings: [], lifecycle: { ...defaultLifecycle, status: 'DEPRECATED', deprecationNotice: '旧接口请迁移', replacementVersion: 'v2', sunsetDate: '2027-12-31' } };
const affected = { apiId: 'api1', service: 'orders', version: 'v1', method: 'query', basis: 'EFFECTIVE', draftRevision: 3, releaseId: 'release1', lifecycle: definition.lifecycle, enabled: false, evaluatedAt: '2026-09-10T00:00:00Z', applications: { items: [{ applicationId: 'app1', name: '停用的候选应用', ownerTenantId: 'tenant1', status: 'DISABLED', matchedScopeCodes: ['orders'], activeTenantGrantCount: 0 }], total: 21, page: 1, pageSize: 20 } };
vi.setConfig({ testTimeout: 15000 });
afterEach(() => { cleanup(); window.history.replaceState({}, '', '/#/apis'); vi.unstubAllGlobals(); });
const wrapper = ({ children }: { children: ReactNode }) => <PlatformTheme><AdminNavigationProvider>{children}</AdminNavigationProvider></PlatformTheme>;
const list = (url: string) => url.endsWith('/environment-releases/targets') ? ok([])
  : url.endsWith('/publications/apis/api1/state') ? ok({ apiId: 'api1', stateVersion: 0, enabled: true, liveReleaseId: null, pendingReleaseId: null })
  : url.endsWith('/publications/apis/api1/effective') ? ok(null)
  : ok({ items: url.includes('/categories') ? ['订单'] : url.includes('/scopes') ? [] : [], total: 0, page: 1, pageSize: 20 });
function openVersions(handler: (url: string, init?: RequestInit) => Response | undefined, permissions = ['MANAGE_APIS']) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => handler(url, init) ?? (url.endsWith('/apis/api1/workspace') ? ok(workspaceSnapshot(definition)) : url.endsWith('/apis/api1') ? ok(definition) : list(url)));
  vi.stubGlobal('fetch', fetchMock);
  window.history.replaceState({}, '', '/#/apis/api1/versions');
  const api = createAdminApi('proof', vi.fn());
  const view = render(<CatalogPanel api={api} permissions={permissions} />, { wrapper });
  return { fetchMock, view, api };
}



test('影响查询默认按生效版本、保留停用零授权候选并以快照修订翻页，冲突后可重试', async () => {
  const fetchMock = vi.fn(async (url: string) => url.includes('page=2') ? Response.json({ code: 40900001, resultMsg: '契约修订已变化' }, { status: 409 }) : ok(affected));
  vi.stubGlobal('fetch', fetchMock);
  render(<AffectedApplications api={createAdminApi('proof', vi.fn())} apiId="api1" />, { wrapper: PlatformTheme });
  expect(await screen.findByText('停用的候选应用')).toBeTruthy();
  expect(screen.getByText('已停用')).toBeTruthy();
  expect(screen.getByRole('cell', { name: '0' })).toBeTruthy();
  expect(screen.getByText(/这不是实际调用名单/)).toBeTruthy();
  expect(fetchMock.mock.calls[0][0]).toContain('basis=EFFECTIVE');
  fireEvent.click(screen.getByTitle('下一页'));
  expect(await screen.findByText('契约修订已变化')).toBeTruthy();
  expect(fetchMock.mock.calls[1][0]).toContain('expectedRevision=3');
  expect(screen.queryByText('停用的候选应用')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
});

test('切换查询依据取消旧请求，晚到生效结果不能覆盖草稿结果', async () => {
  let finish: ((response: Response) => void) | undefined;
  let oldSignal: AbortSignal | undefined;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes('basis=EFFECTIVE')) { oldSignal = init?.signal as AbortSignal; return new Promise<Response>(resolve => { finish = resolve; }); }
    return ok({ ...affected, basis: 'DRAFT', releaseId: null, draftRevision: 4, applications: { ...affected.applications, items: [] } });
  }));
  render(<AffectedApplications api={createAdminApi('proof', vi.fn())} apiId="api1" />, { wrapper: PlatformTheme });
  await waitFor(() => expect(finish).toBeTruthy());
  fireEvent.click(screen.getByText('按已保存草稿'));
  expect(await screen.findByText(/草稿修订 r4/)).toBeTruthy();
  expect(oldSignal?.aborted).toBe(true);
  finish!(ok(affected));
  await waitFor(() => expect(screen.queryByText('停用的候选应用')).toBeNull());
});

test('大整数修订显示与分页URL原样保留，租户授权计数使用JSON数值文本', async () => {
  const fetchMock = vi.fn(async (_url: string) => new Response(JSON.stringify({ code: 200, data: affected }).replace('"draftRevision":3', '"draftRevision":9007199254740993').replace('"activeTenantGrantCount":0', '"activeTenantGrantCount":9007199254740995'), { headers: { 'Content-Type': 'application/json' } }));
  vi.stubGlobal('fetch', fetchMock);
  render(<AffectedApplications api={createAdminApi('proof', vi.fn())} apiId="api1" />, { wrapper: PlatformTheme });
  expect(await screen.findByText(/生效修订 r9007199254740993/)).toBeTruthy();
  expect(screen.getByRole('cell', { name: '9007199254740995' })).toBeTruthy();
  fireEvent.click(screen.getByTitle('下一页'));
  await waitFor(() => expect(fetchMock.mock.calls[1]?.[0]).toContain('expectedRevision=9007199254740993'));
});

test('仅拥有凭据管理权限时显示“可能受影响的接入方”入口', async () => {
  const { view, api } = openVersions(() => undefined);
  await screen.findByRole('button', { name: '编辑维护声明' }, { timeout: 5000 });
  expect(screen.queryByRole('button', { name: '可能受影响的接入方' })).toBeNull();
  view.rerender(<CatalogPanel api={api} permissions={['MANAGE_APIS', 'MANAGE_APPLICATIONS']} />);
  expect(await screen.findByRole('button', { name: '可能受影响的接入方' })).toBeTruthy();
});

test('维护声明在版本页编辑：按状态提示缺项，保存整份草稿后可去发布', async () => {
  const { fetchMock } = openVersions((_url, init) => init?.method === 'PUT' ? ok({ ...definition, ...JSON.parse(String(init.body)), draftRevision: 4 }) : undefined);
  fireEvent.click(await screen.findByRole('button', { name: '编辑维护声明' }, { timeout: 5000 }));
  expect((screen.getByLabelText('废弃说明') as HTMLTextAreaElement).value).toBe('旧接口请迁移');
  fireEvent.click(screen.getByText(lifecycleStatusNames.RETIRED));
  fireEvent.change(screen.getByLabelText('废弃说明'), { target: { value: '' } });
  expect(screen.getAllByText('请填写迁移或停止服务公告。').length).toBeGreaterThan(0);
  expect(screen.getByRole('button', { name: '保存维护声明' })).toHaveProperty('disabled', true);
  expect(screen.getByRole('tab', { name: '版本与生命周期，有未保存修改' })).toBeTruthy();
  fireEvent.change(screen.getByLabelText('废弃说明'), { target: { value: '请迁移至v2，旧服务结束' } });
  fireEvent.change(screen.getByLabelText('替代外部版本'), { target: { value: 'v1' } });
  expect(screen.getByRole('button', { name: '保存维护声明' })).toHaveProperty('disabled', true);
  fireEvent.change(screen.getByLabelText('替代外部版本'), { target: { value: 'v2' } });
  fireEvent.click(screen.getByRole('button', { name: '保存维护声明' }));
  await screen.findByText('已保存为新修订，发布后对外生效。');
  const puts = fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT');
  expect(puts).toHaveLength(1);
  expect(JSON.parse(String(puts[0][1]?.body))).toMatchObject({ expectedRevision: 3, owner: '研发', lifecycle: { status: 'RETIRED', replacementVersion: 'v2', deprecationNotice: '请迁移至v2，旧服务结束' } });
  fireEvent.click(screen.getByRole('button', { name: '去发布' }));
  await waitFor(() => expect(window.location.hash).toContain('/apis/api1/publish'));
});

test('恢复正常清除废弃信息并保留兼容性声明；撤销修改回到已保存内容', async () => {
  const { fetchMock } = openVersions((_url, init) => init?.method === 'PUT' ? ok({ ...definition, draftRevision: 4 }) : undefined);
  fireEvent.click(await screen.findByRole('button', { name: '编辑维护声明' }, { timeout: 5000 }));
  fireEvent.click(screen.getByText(lifecycleStatusNames.ACTIVE));
  expect(screen.queryByLabelText('废弃说明')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '撤销修改' }));
  fireEvent.click(screen.getByRole('button', { name: '编辑维护声明' }));
  expect((screen.getByLabelText('废弃说明') as HTMLTextAreaElement).value).toBe('旧接口请迁移');
  fireEvent.click(screen.getByText(lifecycleStatusNames.ACTIVE));
  fireEvent.click(screen.getByRole('button', { name: '保存维护声明' }));
  await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(true));
  expect(JSON.parse(String(fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')?.[1]?.body)).lifecycle).toEqual(defaultLifecycle);
});

test('维护声明保存冲突保留输入并进入统一冲突处理', async () => {
  openVersions((_url, init) => init?.method === 'PUT' ? Response.json({ code: 40900001, resultMsg: '草稿已更新' }, { status: 409 }) : undefined);
  fireEvent.click(await screen.findByRole('button', { name: '编辑维护声明' }, { timeout: 5000 }));
  fireEvent.change(screen.getByLabelText('废弃说明'), { target: { value: '保留输入' } });
  fireEvent.click(screen.getByRole('button', { name: '保存维护声明' }));
  expect(await screen.findByText(/草稿已更新/)).toBeTruthy();
  expect(screen.getByLabelText('废弃说明')).toHaveProperty('value', '保留输入');
});

test('生效说明显示退出410及计划边界，旧快照使用正常默认值', () => {
  const view = render(<LifecycleDetails lifecycle={{ ...definition.lifecycle, status: 'RETIRED', compatibility: 'BREAKING', compatibilityNotes: '返回结构变化' }} />);
  expect(screen.getByText(/已退出（调用返回 410）/)).toBeTruthy();
  expect(screen.getByText(/到期不会自动退出/)).toBeTruthy();
  expect(screen.getByText(/不自动跳转或授权/)).toBeTruthy();
  expect(screen.getByText(/未经自动兼容性证明/)).toBeTruthy();
  view.rerender(<LifecycleDetails />);
  expect(screen.getByText('生命周期：正常服务')).toBeTruthy();
});
