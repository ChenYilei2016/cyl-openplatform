import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import SigningKeysPanel from './SigningKeysPanel';
import { createAdminApi } from './api';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const key = { keyId: 'a'.repeat(32), applicationId: 'app1', revision: 1, status: 'ACTIVE', createdAt: '2026-09-10T00:00:00Z', changedAt: '2026-09-10T00:00:00Z' };
const ok = (data: unknown) => Response.json({ code: 200, data });
test('签名密钥使用CAS与CSRF，一次性明文清理，轮换撤销', async () => {
  const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
    if (options?.method !== 'POST') return ok({ configured: true, key: null });
    if (url.endsWith('/revoke')) return ok({ ...key, revision: 3, status: 'REVOKED' });
    return ok({ key: { ...key, revision: url.endsWith('/rotate') ? 2 : 1 }, signingSecret: 'one-time-signing-secret' });
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<SigningKeysPanel api={createAdminApi('proof', vi.fn())} applicationId="app1" />);
  fireEvent.click(await screen.findByRole('button', { name: '生成签名密钥' }));
  fireEvent.click(within(await screen.findByRole('tooltip')).getByRole('button', { name: '确认生成' }));
  expect(await screen.findByText('one-time-signing-secret')).toBeTruthy();
  const write = fetchMock.mock.calls.find(([, o]) => o?.method === 'POST');
  expect(new Headers(write?.[1]?.headers).get('X-CSRF-Token')).toBe('proof');
  expect(JSON.parse(String(write?.[1]?.body))).toEqual({ expectedRevision: 0 });
  fireEvent.click(screen.getByRole('button', { name: '已保存，关闭签名密钥' }));
  expect(screen.queryByText('one-time-signing-secret')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '轮换签名密钥' }));
  fireEvent.click(await screen.findByRole('button', { name: '确认轮换' }));
  expect(await screen.findByText('one-time-signing-secret')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '已保存，关闭签名密钥' }));
  fireEvent.click(screen.getByRole('button', { name: '撤销签名密钥' }));
  fireEvent.click(await screen.findByRole('button', { name: '确认撤销' }));
  expect(await screen.findByText('已撤销')).toBeTruthy();
  expect(JSON.parse(String(fetchMock.mock.calls.find(([url]) => url.endsWith('/revoke'))?.[1]?.body))).toEqual({ expectedRevision: 2 });
});
test('未配置禁用生成，切换应用立即清除秘密', async () => {
  let configured = false;
  vi.stubGlobal('fetch', vi.fn(async (_url: string, options?: RequestInit) => options?.method === 'POST'
    ? ok({ key, signingSecret: 'private-once' }) : ok({ configured, key: null })));
  const api = createAdminApi('proof', vi.fn());
  const view = render(<SigningKeysPanel api={api} applicationId="app1" />);
  expect(await screen.findByText('签名密钥服务尚未配置，请联系平台运维。')).toBeTruthy();
  expect((screen.getByRole('button', { name: '生成签名密钥' }) as HTMLButtonElement).disabled).toBe(true);
  configured = true;
  fireEvent.click(screen.getByRole('button', { name: '刷新签名密钥状态' }));
  await screen.findByText(/尚未生成签名密钥/);
  fireEvent.click(screen.getByRole('button', { name: '生成签名密钥' }));
  fireEvent.click(await screen.findByRole('button', { name: '确认生成' }));
  expect(await screen.findByText('private-once')).toBeTruthy();
  view.rerender(<SigningKeysPanel api={api} applicationId="app2" />);
  expect(screen.queryByText('private-once')).toBeNull();
});

test('刷新和普通重绘保留一次交付，未知轮换先读状态不重发', async () => {
  let current = key, writes = 0, fail = false;
  const fetchMock = vi.fn(async (_url: string, options?: RequestInit) => {
    if (options?.method === 'POST') {
      writes++; current = {...current, revision: current.revision + 1};
      if (fail) return Response.json({code:50000001,resultMsg:'回包异常'}, {status:502});
      return ok({key:current,signingSecret:'only-memory-secret'});
    }
    return ok({configured:true,key:current});
  });
  vi.stubGlobal('fetch',fetchMock);const api=createAdminApi('proof',vi.fn());
  const screenView=render(<SigningKeysPanel api={api} applicationId="app1"/>);
  fireEvent.click(await screen.findByRole('button',{name:'轮换签名密钥'}));
  fireEvent.click(await screen.findByRole('button',{name:'确认轮换'}));
  await screen.findByText('only-memory-secret');
  fireEvent.click(screen.getByRole('button',{name:'刷新签名密钥状态'}));
  screenView.rerender(<SigningKeysPanel api={api} applicationId="app1" applicationName="新展示名"/>);
  expect(await screen.findByText('only-memory-secret')).toBeTruthy();
  expect(localStorage.length).toBe(0);expect(sessionStorage.length).toBe(0);
  fireEvent.click(screen.getByRole('button',{name:'已保存，关闭签名密钥'}));
  fail=true;fireEvent.click(screen.getByRole('button',{name:'轮换签名密钥'}));
  fireEvent.click(await screen.findByRole('button',{name:'确认轮换'}));
  await screen.findByRole('button',{name:'核对签名密钥状态'});
  expect(screen.getByRole('button',{name:'轮换签名密钥'})).toHaveProperty('disabled',true);
  fireEvent.click(screen.getByRole('button',{name:'关闭错误提示'}));
  fireEvent.click(screen.getByRole('button',{name:'核对签名密钥状态'}));
  await screen.findByText(/本次未收到的 SigningSecret 无法找回/);
  expect(writes).toBe(2);
});
