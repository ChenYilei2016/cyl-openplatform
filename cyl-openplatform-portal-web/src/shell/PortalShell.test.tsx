import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import CustomerDocuments from '../documentation/CustomerDocuments';
import CodeBlock from './CodeBlock';
import { useReducedMotion } from './useColorMode';

const response = (data: unknown) => Response.json({ code: 200, data });
const page = (items: unknown[]) => response({ items, total: items.length, page: 1, pageSize: 20 });
const summary = { apiId: 'a1', releaseId: 'r1', stateVersion: 1, draftRevision: 1, name: '查询订单', category: '订单', service: 'orders', version: 'v1', method: 'query', lifecycleStatus: 'ACTIVE' };
let darkSystem = false;
let reducedMotion = false;
const listeners: Array<() => void> = [];

beforeEach(() => {
  darkSystem = false;
  reducedMotion = false;
  listeners.length = 0;
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() { return query.includes('prefers-color-scheme: dark') ? darkSystem : query.includes('prefers-reduced-motion') ? reducedMotion : false; },
    media: query,
    addEventListener: (_: string, listener: () => void) => listeners.push(listener),
    removeEventListener: vi.fn(),
  }));
  const view = { releaseId: 'r1', stateVersion: 1, service: 'orders', version: 'v1', method: 'query', category: '订单', document: { id: 'a1', draftRevision: 1, title: '查询订单', path: '/api/oauth/orders/v1/query', httpMethod: 'POST', scopeCodes: [], requestSchema: { type: 'OBJECT' }, responseSchema: { type: 'OBJECT' }, requestExample: {}, responseExample: {}, errorDefinitions: [] } };
  vi.stubGlobal('fetch', vi.fn(async (url: string) => (String(url).includes('/categories') ? page([{ category: '订单', apiCount: 1 }]) : String(url).startsWith('/platform-info') ? response({ gatewayBaseUrl: 'https://gw.example.test' }) : String(url).endsWith('/view') ? response(view) : page([summary]))));
  // 测试环境的 localStorage 不一定可用，用内存实现保证行为可断言。
  const memory = new Map<string, string>();
  vi.stubGlobal('scrollTo', vi.fn());
  vi.stubGlobal('localStorage', { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => memory.set(key, value), removeItem: (key: string) => memory.delete(key), clear: () => memory.clear() });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); history.replaceState(null, '', '/'); delete (Element.prototype as Partial<Element>).scrollIntoView; });

test('默认跟随系统主题，系统切换即时生效；手动选择后记住并不再跟随', async () => {
  history.replaceState(null, '', '/portal/');
  render(<CustomerDocuments />);
  await waitFor(() => expect(document.documentElement.dataset.opMode).toBe('light'));
  darkSystem = true;
  act(() => listeners.forEach((listener) => listener()));
  await waitFor(() => expect(document.documentElement.dataset.opMode).toBe('dark'));
  fireEvent.click(screen.getByRole('button', { name: /切换主题/ }));
  fireEvent.click(await screen.findByText('浅色'));
  await waitFor(() => expect(document.documentElement.dataset.opMode).toBe('light'));
  expect(localStorage.getItem('op-portal-color-mode')).toBe('light');
  darkSystem = true;
  act(() => listeners.forEach((listener) => listener()));
  expect(document.documentElement.dataset.opMode).toBe('light');
});

test('无参数进入首页；带具体 API 或筛选条件的链接直接进入 API 文档；未知页面显示 404 与下一步', async () => {
  history.replaceState(null, '', '/portal/');
  const view = render(<CustomerDocuments />);
  expect(await screen.findByRole('region', { name: '首页' })).toBeTruthy();
  view.unmount();
  history.replaceState(null, '', '/portal/?service=orders&method=query');
  const docs = render(<CustomerDocuments />);
  await waitFor(() => expect(screen.queryByRole('region', { name: '首页' })).toBeNull());
  expect(screen.getByRole('link', { name: 'API 文档' }).getAttribute('aria-current')).toBe('page');
  // 唯一匹配的 service/method 直接打开文档（115 用户故事 6）。
  expect(await screen.findByRole('heading', { name: '查询订单', level: 1 })).toBeTruthy();
  docs.unmount();
  history.replaceState(null, '', '/portal/?section=unknown');
  render(<CustomerDocuments />);
  expect(await screen.findByText('没有找到这个页面')).toBeTruthy();
  fireEvent.click(screen.getByRole('link', { name: '浏览 API 文档' }));
  expect(location.search).toBe('?section=documents');
});

test('任意页面 ⌘K 打开搜索，输入即查询公开 API，回车打开对应文档', async () => {
  history.replaceState(null, '', '/portal/?section=guide');
  render(<CustomerDocuments />);
  fireEvent.keyDown(window, { key: 'k', metaKey: true });
  const input = await screen.findByRole('textbox', { name: '搜索 API' });
  fireEvent.change(input, { target: { value: '订单' } });
  expect(await screen.findByText('查询订单')).toBeTruthy();
  expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).startsWith('/public-api/documents?') && String(url).includes('query=%E8%AE%A2%E5%8D%95'))).toBe(true);
  fireEvent.keyDown(input, { key: 'Enter' });
  await waitFor(() => expect(location.search).toContain('apiService=orders'));
  expect(location.search).toContain('section=documents');
  expect(location.search).toContain('apiMethod=query');
});

test('代码块高亮、行号与复制原始代码，多语言页签切换', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  render(<CodeBlock samples={[{ label: 'JSON', language: 'json', code: '{\n  "code": 0\n}' }, { label: 'cURL', language: 'bash', code: 'curl -X POST https://gw' }]} />);
  expect(document.querySelectorAll('.op-code-block__line')).toHaveLength(3);
  expect(document.querySelector('.token.property')?.textContent).toBe('"code"');
  fireEvent.click(screen.getByRole('button', { name: '复制JSON代码' }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith('{\n  "code": 0\n}'));
  expect(await screen.findByText('已复制')).toBeTruthy();
  fireEvent.click(screen.getByRole('tab', { name: 'cURL' }));
  expect(document.querySelectorAll('.op-code-block__line')).toHaveLength(1);
});

test('系统开启减少动态效果时可检测到', () => {
  reducedMotion = true;
  let value = false;
  function Probe() { value = useReducedMotion(); return null; }
  render(<Probe />);
  expect(value).toBe(true);
});

test('首页三步进入接入指南对应步骤：同一条历史记录带锚点，指南挂载后定位到该步骤', async () => {
  const scrolled: string[] = [];
  Element.prototype.scrollIntoView = function (this: Element) { scrolled.push(this.id); };
  history.replaceState(null, '', '/portal/');
  render(<CustomerDocuments />);
  const steps = await screen.findByRole('region', { name: '首页' });
  const length = history.length;
  fireEvent.click(within(steps).getAllByRole('link', { name: /查看详细说明/ })[1]);
  expect(location.search).toBe('?section=guide');
  expect(location.hash).toBe('#token');
  expect(history.length).toBe(length + 1);
  await waitFor(() => expect(scrolled).toContain('token'));
});
