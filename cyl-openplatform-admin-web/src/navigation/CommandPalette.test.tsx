import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createAdminApi } from '../access/api';
import { AdminNavigationProvider } from './AdminNavigation';
import CommandPalette, { type GlobalSearchResult } from './CommandPalette';
import { pageEntries } from './routes';

const result: GlobalSearchResult = {
  apis: [{ id: 'API_1', name: '订单详情查询', service: 'order', version: 'v1', method: 'lookup' }],
  credentials: [{ id: 'APP_1', name: '订单系统', appKey: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', status: 'ENABLED' }],
  calls: [{ id: 'CALL_1', requestId: 'req-001', mode: 'PRODUCTION', service: 'order', method: 'lookup', outcome: 'FAILURE', httpStatus: 502, occurredAt: '2026-10-02T01:02:03Z' }],
  people: [{ id: 'P1', tenantId: 't1', tenantName: 'CYL', employeeId: 'e1', employeeNo: 'E1001', displayName: '示例人员' }],
};
const onClose = vi.fn();
const show = (data: Partial<GlobalSearchResult>) => {
  const fetchMock = vi.fn(async (_url: string) => Response.json({ code: 200, data }));
  vi.stubGlobal('fetch', fetchMock);
  render(
    <AdminNavigationProvider>
      <CommandPalette open onClose={onClose} entries={pageEntries} recent={[]} api={createAdminApi('proof', vi.fn())} />
    </AdminNavigationProvider>,
  );
  return { fetchMock, input: screen.getByRole('textbox', { name: '搜索页面' }) };
};

beforeEach(() => window.history.replaceState({}, '', '/#/workbench'));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  onClose.mockClear();
});

test('输入停顿后只请求一次，结果按 API、凭据、调用、人员分组', async () => {
  const { fetchMock, input } = show(result);
  fireEvent.change(input, { target: { value: '订' } });
  fireEvent.change(input, { target: { value: '订单' } });
  expect(await screen.findByText('订单详情查询')).toBeTruthy();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(String(fetchMock.mock.calls[0][0])).toContain('/admin-api/search?q=%E8%AE%A2%E5%8D%95');
  for (const section of ['API', '凭据', '调用', '人员']) expect(screen.getByText(section)).toBeTruthy();
  expect(screen.getByText('order.lookup · v1')).toBeTruthy();
  expect(screen.getByText(/失败 502/)).toBeTruthy();
});

test.each([
  ['订单详情查询', '#/apis/API_1/config'],
  ['订单系统', '#/credentials?application=APP_1'],
  ['req-001', '#/logs?record=CALL_1&recordAt=2026-10-02T01%3A02%3A03Z'],
  ['示例人员', '#/logs?filter.logs.tenantId=t1&filter.logs.employeeNo=E1001'],
])('点击 %s 打开对应页面', async (title, hash) => {
  const { input } = show(result);
  fireEvent.change(input, { target: { value: '订单' } });
  fireEvent.click(await screen.findByText(title));
  expect(onClose).toHaveBeenCalled();
  expect(window.location.hash).toBe(hash);
});

test('回车打开当前项；无调用日志权限时人员跳到其租户的凭据', async () => {
  const { input } = show({ apis: null, credentials: [], calls: null, people: result.people });
  fireEvent.change(input, { target: { value: '示例人员' } });
  expect(await screen.findByText('人员')).toBeTruthy();
  expect(screen.queryByText('API')).toBeNull();
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(window.location.hash).toBe('#/credentials?filter.credentials.tenantId=t1');
});

test('少于 2 个字符不请求；搜索失败时提示', async () => {
  const { fetchMock, input } = show(result);
  fireEvent.change(input, { target: { value: 'x' } });
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(fetchMock).not.toHaveBeenCalled();
  fetchMock.mockImplementation(async () => Response.json({ code: 40000001, resultMsg: '搜索内容需为1至100个字符' }, { status: 400 }));
  fireEvent.change(input, { target: { value: 'xyz-none' } });
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('实体搜索失败'));
});

test('粘贴完整 Token 不发请求、不进地址，提示改用 Token 记录 ID', async () => {
  const { fetchMock, input } = show(result);
  fireEvent.change(input, { target: { value: 'Bearer abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG' } });
  expect(await screen.findByText(/搜索不接受完整 Token/)).toBeTruthy();
  await new Promise((resolve) => setTimeout(resolve, 400));
  expect(fetchMock).not.toHaveBeenCalled();
});
