import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import CustomerDocuments from './CustomerDocuments';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); history.replaceState(null, '', '/'); });
const page = (items: unknown[]) => Response.json({ code: 200, data: { items, total: items.length, page: 1, pageSize: 20 } });
const summary = { apiId: 'a1', name: '授权订单', service: 'orders', version: 'v1', method: 'query', lifecycleStatus: 'ACTIVE' };
const view = { releaseId: 'r1', stateVersion: 1, service: 'orders', version: 'v1', method: 'query', category: '订单', document: { id: 'a1', draftRevision: 1, title: '授权订单详情', path: '/api/oauth/orders/v1/query', httpMethod: 'POST', scopeCodes: ['orders.read'], requestSchema: { type: 'OBJECT', properties: {} }, responseSchema: { type: 'OBJECT', properties: {} }, errorDefinitions: [], requestExample: {}, responseExample: {} } };

test.each(['/docs', '/docs/'])('%s无需平台登录，文档和历史SDK只带业务Bearer，401清除身份', async path => {
  history.replaceState(null, '', path);
  let authorized = true;
  const calls: [string, RequestInit | undefined][] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push([url, init]);
    if (!authorized) return Response.json({ code: 40100001, resultMsg: 'Token已失效' }, { status: 401 });
    if (url.endsWith('/view')) return Response.json({ code: 200, data: view });
    return page(url.includes('categories') || url.startsWith('/api/sdk-assets') ? [] : [summary]);
  }));
  const storage = vi.spyOn(Storage.prototype, 'setItem');
  render(<CustomerDocuments />);
  await screen.findByLabelText('业务 Token');
  expect(calls).toHaveLength(0);
  fireEvent.change(screen.getByLabelText('业务 Token'), { target: { value: 'private-doc-token' } });
  fireEvent.click(screen.getByRole('button', { name: '读取授权文档' }));
  fireEvent.click(await screen.findByRole('button', { name: '授权订单' }));
  await screen.findByText('此生效版本暂无已发布 SDK。');
  expect(calls.some(([url]) => url.startsWith('/api/sdk-assets?service=orders&version=v1&method=query'))).toBe(true);
  expect(calls.every(([url, init]) => (url.startsWith('/api/docs') || url.startsWith('/api/sdk-assets')) && init?.credentials === 'omit' && new Headers(init.headers).get('Authorization') === 'Bearer private-doc-token')).toBe(true);
  expect(location.href).not.toContain('private-doc-token');
  expect(storage).not.toHaveBeenCalled();
  authorized = false;
  fireEvent.click(screen.getByRole('button', { name: '刷新 SDK' }));
  await screen.findByRole('button', { name: '读取授权文档' });
  expect(screen.getByRole('status').textContent).toContain('业务 Token 已失效');
  expect(screen.queryByRole('heading', { name: '授权订单详情' })).toBeNull();
  expect((screen.getByLabelText('业务 Token') as HTMLInputElement).value).toBe('');
});

test('pagehide清除未提交输入与已用Token，恢复页面不恢复工作区，旧401不清新身份', async () => {
  history.replaceState(null, '', '/docs/');
  let resolveOld: ((response: Response) => void) | undefined;
  let first = true;
  vi.stubGlobal('fetch', vi.fn(async () => {
    if (first) {
      first = false;
      return new Promise<Response>(resolve => { resolveOld = resolve; });
    }
    return page([]);
  }));
  render(<CustomerDocuments />);
  await screen.findByLabelText('业务 Token');
  fireEvent.change(screen.getByLabelText('业务 Token'), { target: { value: 'private-doc-token' } });
  fireEvent(window, new Event('pagehide'));
  expect((screen.getByLabelText('业务 Token') as HTMLInputElement).value).toBe('');
  const enter = () => {
    fireEvent.change(screen.getByLabelText('业务 Token'), { target: { value: 'private-doc-token' } });
    fireEvent.click(screen.getByRole('button', { name: '读取授权文档' }));
  };
  enter();
  await waitFor(() => expect(resolveOld).toBeTruthy());
  fireEvent(window, new Event('pagehide'));
  fireEvent(window, new Event('pageshow'));
  expect(screen.queryByRole('button', { name: '清除 Token' })).toBeNull();
  expect((screen.getByLabelText('业务 Token') as HTMLInputElement).value).toBe('');
  enter();
  await screen.findByText('当前条件下没有可读取的生效文档。');
  await act(async () => { resolveOld!(Response.json({ code: 40100001, resultMsg: '旧请求失效' }, { status: 401 })); });
  await waitFor(() => expect(screen.getByRole('button', { name: '清除 Token' })).toBeTruthy());
  expect(screen.queryByText(/业务 Token 已失效/)).toBeNull();
});

test('清除与离页卸载取消文档请求，重新打开不恢复Token', async () => {
  history.replaceState(null, '', '/docs/');
  const signals: AbortSignal[] = [];
  vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => {
    signals.push(init.signal!);
    return new Promise<Response>(() => {});
  }));
  const instance = render(<CustomerDocuments />);
  await screen.findByLabelText('业务 Token');
  const enter = () => {
    fireEvent.change(screen.getByLabelText('业务 Token'), { target: { value: 'private-doc-token' } });
    fireEvent.click(screen.getByRole('button', { name: '读取授权文档' }));
  };
  enter();
  await waitFor(() => expect(signals).toHaveLength(2));
  fireEvent.click(screen.getByRole('button', { name: '清除 Token' }));
  await waitFor(() => expect(signals.every(signal => signal.aborted)).toBe(true));
  enter();
  await waitFor(() => expect(signals).toHaveLength(4));
  instance.unmount();
  expect(signals.every(signal => signal.aborted)).toBe(true);
  render(<CustomerDocuments />);
  await screen.findByLabelText('业务 Token');
  expect((screen.getByLabelText('业务 Token') as HTMLInputElement).value).toBe('');
  expect(signals).toHaveLength(4);
});
