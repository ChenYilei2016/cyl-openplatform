import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import type { ApiClient } from '@cyl/open-platform-web-shared/http';
import PortalDelegations from './PortalDelegations';
import { PortalMutationError, type PortalApplication } from './api';

const application: PortalApplication = { scopes: [], id: 'binding', applicationId: 'app', appKey: 'a'.repeat(32), name: '仓储', applicationStatus: 'ENABLED', status: 'ACTIVE', authorizationVersion: 0, note: '', noteRevision: 0 };
const session = { tenantId: 'tenant', userId: 'actor-user', employeeNo: 'actor', displayName: '操作人' };
const target = { tenantId: 'tenant', userId: 'target-user', employeeId: 'target-id', employeeNo: 'E1001', displayName: '目标员工', enabled: true };
const grant = { ...target, id: 'user-grant', status: 'ACTIVE', authorizationVersion: 0 };
const page = (items: unknown[]) => ({ items, total: items.length, page: 1, pageSize: 20 });
afterEach(cleanup);

test('先核验再建立，发送固定身份保护值，撤销说明与Token入口指向当前人员', async () => {
  let established = false;
  const call = vi.fn(async (path: string, options?: Parameters<ApiClient>[1]) => {
    if (path.endsWith('/employee-lookup')) return target;
    if (options?.method === 'POST') { established = true; return grant; }
    return page(established ? [grant] : []);
  });
  const onToken = vi.fn();
  render(<PortalDelegations api={call as ApiClient} application={application} session={session} onBusy={() => {}} onToken={onToken} />);
  expect(screen.queryByRole('button', { name: '确认建立委托' })).toBeNull();
  fireEvent.change(screen.getByLabelText('调用员工工号'), { target: { value: 'E1001' } });
  fireEvent.click(screen.getByRole('button', { name: '核验员工' }));
  fireEvent.click(await screen.findByRole('button', { name: '确认建立委托' }));
  await screen.findByText('有效委托');
  expect(call).toHaveBeenCalledWith('/bindings/binding/users', { signal:expect.any(AbortSignal), method: 'POST', body: { employeeNo: 'E1001', expectedUserId: 'target-user', expectedEmployeeId: 'target-id' } });
  fireEvent.click(screen.getByRole('button', { name: '获取人员 Token' }));
  expect(onToken).toHaveBeenCalledWith('E1001');
  fireEvent.click(screen.getByRole('button', { name: '撤销委托' }));
  expect(screen.getByText(/旧 Token 的后续调用会被拒绝/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '确认撤销此员工' }));
  await waitFor(() => expect(call).toHaveBeenCalledWith('/bindings/binding/users/user-grant/revoke', { signal:expect.any(AbortSignal), method: 'POST', body: { expectedAuthorizationVersion: 0 } }));
});

test('姓名选择只提供线索，工号回收后不显示确认建立', async () => {
  const call = vi.fn(async (path: string) => path.startsWith('/employee-profiles') ? page([{ ...target, lastSeenAt: '2026-09-23T00:00:00Z' }]) : path.endsWith('/employee-lookup') ? { ...target, employeeId: 'reassigned' } : page([]));
  render(<PortalDelegations api={call as ApiClient} application={application} session={session} onBusy={() => {}} onToken={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: '按姓名选择' }));
  fireEvent.click(await screen.findByRole('button', { name: '选择 目标员工 · E1001' }));
  expect((await screen.findByRole('alert')).textContent).toContain('人员已变化');
  expect(screen.queryByRole('button', { name: '确认建立委托' })).toBeNull();
});

test('结果未知时锁定新写入，成功核对后才重新允许核验', async () => {
  const call = vi.fn(async (path: string, options?: Parameters<ApiClient>[1]) => {
    if (path.endsWith('/employee-lookup')) return target;
    if (options?.method === 'POST') throw new PortalMutationError('结果未知', 'UNKNOWN');
    return page([]);
  });
  const onBusy = vi.fn();
  render(<PortalDelegations api={call as ApiClient} application={application} session={session} onBusy={onBusy} onToken={() => {}} />);
  fireEvent.change(screen.getByLabelText('调用员工工号'), { target: { value: 'E1001' } });
  fireEvent.click(screen.getByRole('button', { name: '核验员工' }));
  fireEvent.click(await screen.findByRole('button', { name: '确认建立委托' }));
  await screen.findByRole('button', { name: '核对最新委托' });
  expect(onBusy).toHaveBeenLastCalledWith(true);
  expect((screen.getByRole('button', { name: '核验员工' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '核对最新委托' }));
  await waitFor(() => expect((screen.getByRole('button', { name: '核验员工' }) as HTMLButtonElement).disabled).toBe(false));
  expect(call).toHaveBeenCalledWith('/bindings/binding/users?page=1&pageSize=20&employeeNo=E1001', expect.objectContaining({signal:expect.any(AbortSignal)}));
  expect(onBusy).toHaveBeenLastCalledWith(false);
});


test('已有另一待确认员工时，撤销超时必须核对实际撤销目标', async () => {
  const other = { ...grant, employeeNo: 'E1002', displayName: '另一员工' };
  const call = vi.fn(async (path: string, options?: Parameters<ApiClient>[1]) => {
    if (path.endsWith('/employee-lookup')) return target;
    if (options?.method === 'POST') throw new PortalMutationError('结果未知', 'UNKNOWN');
    return page([other]);
  });
  render(<PortalDelegations api={call as ApiClient} application={application} session={session} onBusy={() => {}} onToken={() => {}} />);
  fireEvent.change(screen.getByLabelText('调用员工工号'), { target: { value: 'E1001' } });
  fireEvent.click(screen.getByRole('button', { name: '核验员工' }));
  await screen.findByRole('button', { name: '确认建立委托' });
  fireEvent.click(screen.getByRole('button', { name: '撤销委托' }));
  fireEvent.click(screen.getByRole('button', { name: '确认撤销此员工' }));
  fireEvent.click(await screen.findByRole('button', { name: '核对最新委托' }));
  await waitFor(() => expect(call).toHaveBeenCalledWith('/bindings/binding/users?page=1&pageSize=20&employeeNo=E1002', expect.objectContaining({signal:expect.any(AbortSignal)})));
});
