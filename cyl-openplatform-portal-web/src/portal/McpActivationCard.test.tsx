import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import type { ApiClient } from '@cyl/open-platform-web-shared/http';
import McpActivationCard from './McpActivationCard';

const activation = { id: 'MCPTENANT_1', keyCode: 'MCP_0123456789ABCDEF', status: 'ENABLED', disabledByPlatform: false, activatedByEmployeeNo: 'E1', activatedByName: '员工一', createdAt: '2026-10-03T00:00:00Z' };
afterEach(cleanup);

test('开通请求不携带租户，开通后不再提供开通入口', async () => {
  let opened = false;
  const call = vi.fn(async (_path: string, options?: Parameters<ApiClient>[1]) => {
    if (options?.method === 'POST') { opened = true; return activation; }
    return opened ? activation : null;
  });
  render(<McpActivationCard api={call as ApiClient} />);
  fireEvent.click(await screen.findByRole('button', { name: '开通 MCP' }));
  await screen.findByText('已开通');
  expect(call).toHaveBeenCalledWith('/mcp/activation', { method: 'POST', body: {} });
  expect(screen.queryByRole('button', { name: '开通 MCP' })).toBeNull();
  expect(screen.getByText('MCP_0123456789ABCDEF')).toBeTruthy();
});

test('平台停用后租户不能自行启用', async () => {
  const call = vi.fn(async () => ({ ...activation, status: 'DISABLED', disabledByPlatform: true }));
  render(<McpActivationCard api={call as unknown as ApiClient} />);
  await screen.findByText('平台已停用');
  expect(screen.getByRole('button', { name: /启\s?用/ })).toHaveProperty('disabled', true);
  expect(screen.queryByRole('button', { name: '开通 MCP' })).toBeNull();
});
