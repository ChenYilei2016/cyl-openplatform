import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { createAdminApi } from '../access/api';
import { AdminNavigationProvider } from '../navigation/AdminNavigation';
import Workbench, { type WorkbenchData } from './Workbench';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

const pending = { id: 'r1', apiId: 'a1', name: '订单详情查询', service: 'order', version: 'v1', method: 'lookup', draftRevision: 3, submittedAt: '2026-09-30T08:00:00Z', submittedByEmployeeNo: 'E1001', submittedByName: '示例人员' };
const draft = { id: 'a2', name: '库存同步', service: 'stock', version: 'v1', method: 'sync', draftRevision: 5, liveDraftRevision: 4, pendingReleaseId: null, updatedAt: '2026-10-01T08:00:00Z' };
const full: WorkbenchData = {
  pendingReviews: { total: 4, items: [pending] },
  myDrafts: { ownerId: 'p1', truncated: false, items: [draft] },
  traffic: { from: '2026-10-02T00:00:00Z', to: '2026-10-02T01:00:00Z', requests: 200, failures: 50, failureRate: '25.00' },
  alerts: { firing: 1, stale: false },
};
const serve = (data: Partial<WorkbenchData>) => {
  const fetchMock = vi.fn(async (_url: string) => Response.json({ code: 200, data }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};
const show = (permissions: string[]) => {
  window.history.replaceState({}, '', '/#/workbench');
  render(<Workbench api={createAdminApi('proof', vi.fn())} session={{ displayName: '示例人员', employeeNo: 'E1001', permissions, superAdministrator: false }} />, { wrapper: AdminNavigationProvider });
};
const all = ['MANAGE_APIS', 'REVIEW_APIS', 'VIEW_AUDIT'];

test('单次聚合请求展示待审核、我的草稿与近 1 小时运行，点击进入对应页面', async () => {
  const fetchMock = serve(full);
  show(all);
  expect(await screen.findByText('待审核 · 4')).toBeTruthy();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(String(fetchMock.mock.calls[0][0])).toContain('/admin-api/workbench');
  expect(screen.getByText('25.00%')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /订单详情查询/ }));
  expect(window.location.hash).toBe('#/reviews?release=r1');
  fireEvent.click(screen.getByRole('button', { name: /库存同步/ }));
  expect(window.location.hash).toBe('#/apis/a2/config');
  fireEvent.click(screen.getByRole('button', { name: /我负责的 API/ }));
  expect(window.location.hash).toBe('#/apis?ownerId=p1');
  fireEvent.click(screen.getByRole('button', { name: /失败率 25.00%/ }));
  expect(window.location.hash).toBe('#/logs?filter.logs.range=1h&filter.logs.outcome=FAILURE');
  fireEvent.click(screen.getByRole('button', { name: /未恢复告警 1/ }));
  expect(window.location.hash).toBe('#/alerts');
});

test('各区块空态', async () => {
  serve({ pendingReviews: { total: 0, items: [] }, myDrafts: { ownerId: null, truncated: false, items: [] }, traffic: { ...full.traffic!, requests: 0, failures: 0, failureRate: null }, alerts: { firing: 0, stale: false } });
  show(all);
  expect(await screen.findByText('没有待审核的发布')).toBeTruthy();
  expect(screen.getByText('还没有负责的 API')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /我负责的 API/ })).toBeNull();
  expect(screen.getByText('近 1 小时没有正式调用，也没有未恢复的告警。')).toBeTruthy();
  expect(screen.getByText('还没有访问记录')).toBeTruthy();
});

test('只有审计权限时隐藏审核与草稿区块', async () => {
  serve({ pendingReviews: null, myDrafts: null, traffic: full.traffic, alerts: full.alerts });
  show(['VIEW_AUDIT']);
  expect(await screen.findByText('25.00%')).toBeTruthy();
  expect(screen.queryByRole('region', { name: /待审核/ })).toBeNull();
  expect(screen.queryByRole('region', { name: '我的草稿' })).toBeNull();
  expect(screen.queryByRole('button', { name: /新建 API/ })).toBeNull();
});

test('服务端裁剪掉的区块不显示；无聚合权限时不请求', async () => {
  serve({ pendingReviews: full.pendingReviews, myDrafts: null, traffic: null, alerts: null });
  show(all);
  expect(await screen.findByText('待审核 · 4')).toBeTruthy();
  expect(screen.queryByRole('region', { name: '我的草稿' })).toBeNull();
  expect(screen.queryByRole('region', { name: '近 1 小时运行' })).toBeNull();
  cleanup();
  const fetchMock = serve(full);
  show(['MANAGE_APPLICATIONS']);
  expect(fetchMock).not.toHaveBeenCalled();
  expect(screen.getByText('还没有访问记录')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /接入凭据/ }));
  expect(window.location.hash).toBe('#/credentials');
});
