import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import HomePage from './HomePage';

const response = (data: unknown) => Response.json({ code: 200, data });
const summary = { apiId: 'a1', releaseId: 'r1', stateVersion: 1, draftRevision: 1, name: '查询订单', category: '订单', service: 'orders', version: 'v1', method: 'query', lifecycleStatus: 'ACTIVE' };
const view = { releaseId: 'r1', stateVersion: 1, service: 'orders', version: 'v1', method: 'query', category: '订单', document: { id: 'a1', draftRevision: 1, title: '查询订单', path: '/api/oauth/orders/v1/query', httpMethod: 'POST', scopeCodes: [], requestSchema: { type: 'OBJECT' }, responseSchema: { type: 'OBJECT' }, requestExample: { orderNo: 'SO-1' }, responseExample: { status: 'PAID' }, errorDefinitions: [] } };
let reduced = true;
beforeEach(() => {
  reduced = true;
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduced-motion') ? reduced : false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); history.replaceState(null, '', '/'); });

function mount(fetchImpl?: (url: string) => Response | Promise<Response>) {
  const fetchMock = vi.fn(async (url: string) => fetchImpl?.(url) ?? (url.includes('/categories') ? response({ items: [{ category: '订单', apiCount: 7 }, { category: '用户', apiCount: 3 }], total: 2, page: 1, pageSize: 50 }) : url.endsWith('/view') ? response(view) : response({ items: [summary], total: 12, page: 1, pageSize: 1 })));
  vi.stubGlobal('fetch', fetchMock);
  const props = { onSearch: vi.fn(), onNavigate: vi.fn(), onOpenApi: vi.fn(), onOpenCategory: vi.fn() };
  render(<HomePage gatewayBaseUrl="https://gw.example.test" {...props} />);
  return { fetchMock, props };
}

test('只展示真实的 API 数与分类数；热门分类与分类卡片进入对应文档；大搜索框打开搜索', async () => {
  const { props } = mount();
  const region = await screen.findByLabelText('平台数据');
  expect(within(region).getByText('12')).toBeTruthy();
  expect(within(region).getByText('2')).toBeTruthy();
  expect(screen.queryByText(/可用|P95/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '搜索 API' }));
  expect(props.onSearch).toHaveBeenCalled();
  fireEvent.click(within(screen.getByText('热门分类').parentElement!).getByRole('button', { name: '订单' }));
  expect(props.onOpenCategory).toHaveBeenCalledWith('订单');
  fireEvent.click(screen.getByRole('button', { name: /用户\s*3 个 API/ }));
  expect(props.onOpenCategory).toHaveBeenCalledWith('用户');
});

test('调用示例由真实公开 API 生成并填入网关地址；减少动态效果时直接完整显示，不播放打字效果', async () => {
  const { props } = mount();
  const demo = await screen.findByLabelText('调用示例');
  expect(within(demo).getByText('/api/oauth/orders/v1/query')).toBeTruthy();
  const code = demo.querySelector('.op-code-block__pre')!.textContent ?? '';
  expect(code).toContain('https://gw.example.test/api/oauth/orders/v1/query');
  expect(code).toContain('SO-1');
  expect(demo.textContent).toContain('PAID');
  for (const tab of ['cURL', 'Java', 'Python']) expect(within(demo).getByRole('tab', { name: tab })).toBeTruthy();
  fireEvent.click(within(demo).getByRole('button', { name: /查看文档/ }));
  expect(props.onOpenApi).toHaveBeenCalledWith(expect.objectContaining({ service: 'orders', method: 'query' }));
});

test('未开启减少动态效果时打字效果只播放一次，结束后显示完整代码', async () => {
  reduced = false;
  mount();
  const demo = await screen.findByLabelText('调用示例');
  await waitFor(() => expect(demo.querySelector('.op-code-block__pre')!.textContent).toContain('--data-binary @-'), { timeout: 4000 });
});

test('三步流程链接到接入指南对应步骤；平台数据读取失败时给出说明而不是空白', async () => {
  const { props } = mount();
  const steps = await screen.findByRole('list');
  expect(within(steps).getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual(['?section=guide#credential', '?section=guide#token', '?section=guide#invoke']);
  fireEvent.click(within(steps).getAllByRole('link')[1]);
  expect(props.onNavigate).toHaveBeenCalledWith('guide');
  cleanup();
  mount(() => Response.json({ code: 500, resultMsg: '服务不可用' }, { status: 500 }));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('平台数据暂时无法读取'));
});
