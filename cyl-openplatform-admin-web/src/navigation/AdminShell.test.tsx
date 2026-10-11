import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { AdminNavigationProvider, useAdminNavigation } from './AdminNavigation';
import AdminShell from './AdminShell';

const session = { permissions: ['MANAGE_APIS', 'VIEW_AUDIT'], superAdministrator: false, displayName: '示例人员', employeeNo: 'E1001', tenantId: 't1' };
function Page() {
  return <p data-testid="page">{useAdminNavigation().route.page}</p>;
}
const renderShell = () =>
  render(
    <AdminNavigationProvider>
      <AdminShell name="开放平台" environmentId="prod" session={session}>
        <Page />
      </AdminShell>
    </AdminNavigationProvider>,
  );

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState({}, '', '/#/workbench');
});
afterEach(cleanup);

test('菜单按新分组展示有权入口，顶栏位置与当前页一致', () => {
  window.history.replaceState({}, '', '/#/logs');
  renderShell();
  const nav = screen.getByRole('navigation', { name: '后台主导航' });
  expect(within(nav).getByRole('link', { name: '调用日志' }).getAttribute('aria-current')).toBe('page');
  expect(within(nav).queryByRole('link', { name: '接入凭据' })).toBeNull();
  expect(within(nav).queryByRole('link', { name: 'Token 排障' })).toBeNull();
  expect(within(screen.getByLabelText('当前位置')).getByText('调用日志')).toBeTruthy();
  expect(screen.getByLabelText('当前环境 prod')).toBeTruthy();
});

test('侧栏收起后只显示图标，并在下次打开时保持', () => {
  const view = renderShell();
  fireEvent.click(screen.getByRole('button', { name: '收起侧栏' }));
  expect(screen.getByRole('link', { name: 'API 列表' })).toBeTruthy();
  expect(screen.queryByText('API 列表')).toBeNull();
  view.unmount();
  renderShell();
  expect(screen.getByRole('button', { name: '展开侧栏' })).toBeTruthy();
});

test('Ctrl+K 打开命令面板，键盘选择后跳转并记入最近访问', async () => {
  renderShell();
  fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
  const input = await screen.findByRole('textbox', { name: '搜索页面' });
  fireEvent.change(input, { target: { value: '日志' } });
  expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([expect.stringContaining('调用日志')]);
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(window.location.hash).toBe('#/logs');
  expect(screen.getByTestId('page').textContent).toBe('calls');
  expect(JSON.parse(localStorage.getItem('op-admin-recent-pages') ?? '[]')[0]).toMatchObject({ path: '/logs', title: '调用日志' });
});
