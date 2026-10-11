import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { AdminNavigationProvider } from '../navigation/AdminNavigation';
import TenantPermissionsPanel from './TenantPermissionsPanel';
import type { AdminApi } from './api';

const page = (items: unknown[]) => ({ items, total: items.length, page: 1, pageSize: 20 });
afterEach(() => { cleanup(); vi.restoreAllMocks(); history.replaceState({}, '', '/'); });

test('租户视角复用权限组开通与撤销，刷新数量且不把公共通用当直接授予', async () => {
  const tenantId = '90071992547409931';
  let granted = false;
  const api = vi.fn(async (path: string, options?: Parameters<AdminApi>[1]) => {
    if (options?.method === 'POST' || options?.method === 'DELETE') { granted = options.method === 'POST'; return {}; }
    if (path.includes('/scopes?')) return page([
      { id: 'public', code: 'common', name: '公共查询', enabled: true, publicAccess: true, grantId: null, grantStatus: null, available: true },
      { id: 'private', code: 'orders', name: '专属订单', enabled: true, publicAccess: false, grantId: granted ? 'g1' : null, grantStatus: granted ? 'ACTIVE' : null, available: granted },
    ]);
    return page([{ tenantId, tenantName: null, grantedScopeCount: granted ? 1 : 0, updatedAt: '2026-10-05T00:00:00Z' }]);
  });
  history.replaceState({}, '', '/#/tenant-permissions');
  render(<AdminNavigationProvider><TenantPermissionsPanel api={api as unknown as AdminApi} /></AdminNavigationProvider>);
  fireEvent.click(await screen.findByRole('button', { name: tenantId }));
  const dialog = await screen.findByRole('dialog', { name: '租户权限' });
  const publicRow = (await within(dialog).findByText('公共查询')).closest('tr')!;
  expect(within(publicRow).getByText('无需单独开通')).toBeTruthy();
  expect(within(publicRow).queryByRole('button', { name: '撤销' })).toBeNull();
  fireEvent.click(within(dialog).getByRole('button', { name: '开通' }));
  await waitFor(() => expect(api).toHaveBeenCalledWith('/scopes/private/tenant-grants', { method: 'POST', body: { tenantId } }));
  fireEvent.click(await within(dialog).findByRole('button', { name: '撤销' }));
  const confirm = await screen.findByRole('tooltip');
  fireEvent.click(within(confirm).getByRole('button', { name: /撤\s*销/ }));
  await waitFor(() => expect(api).toHaveBeenCalledWith('/scopes/private/tenant-grants/g1', { method: 'DELETE' }));
  expect(await within(dialog).findByText('已撤销此权限组。')).toBeTruthy();
  expect(api.mock.calls.filter(([, options]) => options?.method)).toHaveLength(2);
});

test('租户列表批量显示可见规则数并按租户跳转，清除规则页旧筛选', async () => {
  const tenantId = 't'.repeat(64);
  const requests: string[] = [];
  const api = vi.fn(async (path: string) => {
    requests.push(path);
    if (path.startsWith('/governance-rules/association-counts?')) return { [tenantId]: 2 };
    return page([{ tenantId, tenantName: '测试租户', grantedScopeCount: 3, updatedAt: '2026-10-06T00:00:00Z' }]);
  });
  history.replaceState({}, '', '/#/tenant-permissions?filter.governanceRules.apiId=old-api&filter.governanceRules.page=5');
  render(<AdminNavigationProvider><TenantPermissionsPanel api={api as AdminApi} /></AdminNavigationProvider>);
  fireEvent.click(await screen.findByRole('button', { name: '查看 2 条关联规则' }));
  const params = new URLSearchParams(location.hash.split('?')[1]);
  expect(location.hash).toContain('/traffic-rules');
  expect(params.get('filter.governanceRules.tenantId')).toBe(tenantId);
  expect(params.has('filter.governanceRules.apiId')).toBe(false);
  expect(params.has('filter.governanceRules.page')).toBe(false);
  expect(requests.filter(path => path.startsWith('/governance-rules/association-counts?'))).toHaveLength(1);
});
