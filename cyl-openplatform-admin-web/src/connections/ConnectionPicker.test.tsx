import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { PlatformTheme } from '@cyl/open-platform-web-shared/ui/PlatformTheme';
import type { AdminApi } from '../access/api';
import { AdminApiError } from '../access/api';
import type { Binding } from '../catalog/BindingEditor';
import ConnectionPicker from './ConnectionPicker';

afterEach(cleanup);
const binding: Binding = { protocol: 'DUBBO', timeoutMillis: 3000,
  dubbo: { connectionId: 'c1', connectionRevision: 1, interfaceName: 'example.OrderFacade', method: 'query', version: '1.2', group: 'sales', parameterTypes: ['java.lang.String'] } };
const header = { id: 'c1', name: '原连接', environmentId: 'local', activeRevision: 1, draftRevision: 1, enabled: true };
const checks = (id: string, revision: number) => ({ connectionId: id, revision, checkedAt: '2026-09-30T01:00:00Z',
  checks: [{ stage: 'CONFIG', status: 'PASSED', summary: '配置有效' }, { stage: 'REGISTRY', status: 'PASSED', summary: '注册中心可访问' }, { stage: 'DEFINITION', status: 'NOT_CHECKED', summary: '未检查业务接口和方法' }] });

test('单个连接下拉保留业务签名，只有附近一次只读注册中心检查，不读目录或配置', async () => {
  const calls: { path: string; body?: unknown }[] = [], select = vi.fn();
  const api = vi.fn(async (path, init) => {
    calls.push({ path, body: init?.body });
    if (path.includes('/options')) return { items: [{ ...header, id: 'c2', name: '目标连接', activeRevision: 8, metadataType: 'NONE' }], total: 1, page: 1, pageSize: 20 };
    if (path.includes('/diagnostics')) return checks('c2', 8);
    return path.includes('/c2/') ? { ...header, id: 'c2', name: '目标连接', activeRevision: 8 } : header;
  }) as AdminApi;
  function Host() {
    const [value, setValue] = useState(binding);
    return <PlatformTheme><ConnectionPicker api={api} binding={value} onSelect={next => { select(next); setValue(next); }} /></PlatformTheme>;
  }
  render(<Host />);
  await screen.findByText(/原连接 · 固定 r1/);
  fireEvent.mouseDown(screen.getByRole('combobox', { name: '注册中心连接' }));
  fireEvent.click(await screen.findByText(/目标连接 · r8/));
  expect(select.mock.calls[0][0].dubbo).toEqual({ ...binding.dubbo, connectionId: 'c2', connectionRevision: 8 });
  expect(screen.getAllByRole('button', { name: '检查注册中心' })).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: '检查注册中心' }));
  await screen.findByRole('region', { name: '注册中心检查结果' });
  expect(calls.filter(value => value.path.includes('/diagnostics'))).toEqual([{ path: '/dubbo-connections/c2/diagnostics', body: { revision: 8 } }]);
  expect(calls.some(value => /services|methods|configuration|\/c2$/.test(value.path))).toBe(false);
  expect(screen.queryByRole('link', { name: '管理连接 ↗' })).toBeNull();
});

test('固定旧修订与最近新修订分别表达，管理入口不替换当前绑定', async () => {
  const api = vi.fn(async () => ({ ...header, activeRevision: 2, registryCheck: checks('c1', 2) })) as AdminApi;
  const select = vi.fn();
  render(<PlatformTheme><ConnectionPicker api={api} binding={binding} canManage onSelect={select} /></PlatformTheme>);
  await screen.findByText(/原连接 · 固定 r1 · 该修订检查状态未知；本实例最近r2/);
  expect(screen.getByRole('link', { name: '管理连接 ↗' }).getAttribute('href')).toBe('#/connections?connection=c1');
  expect(select).not.toHaveBeenCalled();
});

test('关闭404详情后仍保留当前环境不可用事实，重新加载成功才清除', async () => {
  let attempt = 0;
  let rejectRetry!: (reason: unknown) => void;
  const pending = new Promise<unknown>((_resolve, reject) => { rejectRetry = reject; });
  const api = vi.fn(async () => {
    attempt++;
    if (attempt === 1) throw new AdminApiError('服务连接不存在', 40400001, undefined, undefined, 404);
    if (attempt === 2) return pending;
    return header;
  }) as AdminApi;
  render(<PlatformTheme><ConnectionPicker api={api} binding={binding} onSelect={vi.fn()} /></PlatformTheme>);
  await screen.findByText('本环境连接不存在，请重新选择或处理连接。');
  fireEvent.click(screen.getByRole('button', { name: '关闭错误提示' }));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByText('本环境连接不存在，请重新选择或处理连接。')).toBeTruthy();
  expect((screen.getByRole('button', { name: '检查注册中心' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '重新加载' }));
  expect(screen.getByText('本环境连接不存在，请重新选择或处理连接。')).toBeTruthy();
  expect((screen.getByRole('button', { name: '检查注册中心' }) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => rejectRetry(new Error('网络连接失败，请重试。')));
  await screen.findByText('网络连接失败，请重试。');
  expect(screen.getByText('本环境连接不存在，请重新选择或处理连接。')).toBeTruthy();
  expect((screen.getByRole('button', { name: '检查注册中心' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '重新加载' }));
  await screen.findByText(/原连接 · 固定 r1/);
  expect(screen.queryByText('本环境连接不存在，请重新选择或处理连接。')).toBeNull();
});
