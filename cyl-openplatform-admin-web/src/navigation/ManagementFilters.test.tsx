import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import { AdminNavigationProvider, useAdminNavigation } from './AdminNavigation';
import { useManagementFilters } from './useManagementFilters';

function QueryPage() {
  const navigation = useAdminNavigation();
  const { filters, setFilters, page, apply, onPage } = useManagementFilters('credentials', {
    query: '',
    status: [] as string[],
  });
  if (navigation.route.page === 'scopes')
    return (
      <button onClick={() => navigation.navigate({ ...navigation.route, page: 'applications' })}>
        返回凭据
      </button>
    );
  return (
    <>
      <label>
        备注包含
        <input
          value={filters.query}
          onChange={(event) => setFilters((current) => ({ ...current, query: event.target.value }))}
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={filters.status.includes('DISABLED')}
          onChange={(event) =>
            setFilters((current) => ({
              ...current,
              status: event.target.checked ? ['DISABLED'] : [],
            }))
          }
        />
        停用
      </label>
      <button onClick={() => apply()}>查询</button>
      <button onClick={() => onPage(2)}>第二页</button>
      <span>当前第 {page} 页</span>
      <button
        onClick={() =>
          navigation.navigate({ ...navigation.route, page: 'scopes' })
        }
      >
        查看权限组
      </button>
    </>
  );
}
afterEach(() => {
  cleanup();
  window.history.replaceState({}, '', '/');
});
test('只读组合条件与页码经跨页返回、刷新和popstate恢复，未知秘密字段不进入新URL', async () => {
  window.history.replaceState({}, '', '/#/applications');
  const view = render(<QueryPage />, { wrapper: AdminNavigationProvider });
  fireEvent.change(screen.getByLabelText('备注包含'), { target: { value: '订单_%' } });
  fireEvent.click(screen.getByLabelText('停用'));
  fireEvent.click(screen.getByText('查询'));
  fireEvent.click(screen.getByText('第二页'));
  expect(
    new URLSearchParams(window.location.hash.split('?')[1]).get('filter.credentials.query'),
  ).toBe('订单_%');
  fireEvent.click(screen.getByText('查看权限组'));
  fireEvent.click(screen.getByText('返回凭据'));
  expect(screen.getByLabelText('备注包含')).toHaveProperty('value', '订单_%');
  expect(screen.getByText('当前第 2 页')).toBeTruthy();
  view.unmount();
  render(<QueryPage />, { wrapper: AdminNavigationProvider });
  expect(screen.getByLabelText('停用')).toHaveProperty('checked', true);
  window.history.replaceState(
    {},
    '',
    '/#/applications?filter.credentials.query=restored&filter.credentials.page=1&filter.credentials.appSecret=never-retain',
  );
  fireEvent(window, new PopStateEvent('popstate'));
  await waitFor(() =>
    expect(screen.getByLabelText('备注包含')).toHaveProperty('value', 'restored'),
  );
  fireEvent.click(screen.getByText('查询'));
  expect(window.location.hash).not.toContain('appSecret');
  expect(screen.getByText('当前第 1 页')).toBeTruthy();
});


test('旧 Token 排障地址替换为凭据列表，带凭据时打开 Token 页签并保留原筛选', () => {
  function Route() {
    const { route } = useAdminNavigation();
    return <output>{route.page}:{route.applicationId ?? ''}:{route.applicationTab ?? ''}</output>;
  }
  window.history.replaceState({}, '', '/#/tokens?application=app-1&tenantId=t1&employeeNo=E1&filter.tokens.status=ACTIVE&filter.tokens.tokenId=TOK_1');
  const view = render(<Route />, { wrapper: AdminNavigationProvider });
  expect(screen.getByText('applications:app-1:tokens')).toBeTruthy();
  const hash = window.location.hash;
  expect(hash.startsWith('#/credentials?')).toBe(true);
  const query = new URLSearchParams(hash.split('?')[1]);
  expect(query.get('tab')).toBe('tokens');
  expect(query.get('filter.tokens.status')).toBe('ACTIVE');
  expect(query.get('filter.tokens.tokenId')).toBe('TOK_1');
  expect(query.get('tenantId')).toBe('t1');
  view.unmount();
  window.history.replaceState({}, '', '/#/credentials/tokens');
  render(<Route />, { wrapper: AdminNavigationProvider });
  expect(screen.getByText('applications::')).toBeTruthy();
  expect(window.location.hash).toBe('#/credentials');
});
