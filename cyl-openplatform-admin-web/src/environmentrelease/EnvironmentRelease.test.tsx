import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { createAdminApi } from '../access/api';
import EnvironmentReleasePanel from './EnvironmentReleasePanel';
import ReleaseReview from '../publication/ReleaseReview';

const ok = (data: unknown) => Response.json({ code: 200, data });
const definition = { category: '订单', owner: '研发', protocol: 'HTTP', scopeCodes: [], mappings: [], errorDefinitions: [], id: 'api1', name: '订单', service: 'orders', version: 'v1', method: 'query', draftRevision: 3, requestSchema: { type: 'OBJECT' as const, properties: {} }, responseSchema: { type: 'OBJECT' as const, properties: {} }, binding: { protocol: 'HTTP' } };
const release = { apiId: definition.id, draftRevision: definition.draftRevision, auditRequired: true, baseline: null, baselineKnown: true, id: 'r1', name: '订单', service: 'orders', version: 'v1', method: 'query', status: 'APPLIED', snapshot: definition };
const preview = { environmentId: 'prod', nodeId: 'a', definition, before: { ...definition, name: '旧订单' }, change: 'UPDATE', expectedRevision: 2, changedFields: ['name'], previewDigest: 'digest', auditRequired: true };
const receipt = { environmentId: 'prod', nodeId: 'a', sourceEnvironment: 'dev', transferId: 'key', apiId: 'api1', releaseId: 'target-r1', draftRevision: 3, status: 'APPLIED', auditRequired: true, liveReleaseId: 'target-r1', enabled: true, stateVersion: 2, observedAt: '2026-09-10T00:00:00Z' };
const transfer = { id: 'key', request: { sourceEnvironment: 'dev', targetEnvironment: 'prod', sourceReleaseId: 'r1' }, deliveryState: 'ACCEPTED', receipt, observations: [], createdAt: '2026-09-10T00:00:00Z', updatedAt: '', version: 0 };
function setup(write?: (url: string, init: RequestInit) => Promise<Response>) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') return url.endsWith('/preview') ? ok(preview) : write ? write(url, init) : ok(transfer);
    if (url.endsWith('/targets')) return ok([{ id: 'prod', name: '生产', nodeIds: ['a', 'b'] }]);
    if (url.endsWith('/publications/r1')) return ok(release);
    if (url.includes('/publications?')) return ok({ items: [release], total: 1 });
    if (url.includes('/environment-releases?')) return ok({ items: [{ id: transfer.id, targetId: 'prod', sourceReleaseId: 'r1', service: 'orders', version: 'v1', method: 'query', deliveryState: transfer.deliveryState, createdAt: transfer.createdAt }], total: 1 });
    return ok(transfer);
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<EnvironmentReleasePanel api={createAdminApi('csrf', vi.fn())} />);
  return fetchMock;
}
/** antd 下拉：按可访问名称打开，再点选可见选项。 */
async function choose(label: string, option: string | RegExp, hidden = false) {
  fireEvent.mouseDown(await screen.findByRole('combobox', { name: label, hidden }));
  const options = await screen.findAllByText(option, { selector: '.ant-select-item-option-content' });
  fireEvent.click(options[options.length - 1]);
}
const optionTexts = () => [...document.querySelectorAll('.ant-select-item-option-content')].map(node => node.textContent);
async function chooseSource() { await choose('来源发布快照', /订单 · orders\/v1\/query · r3/); }
async function previewRelease() {
  await chooseSource();
  await choose('目标环境', '生产（prod）');
  await waitFor(() => expect(screen.getByRole('button', { name: '预览目标差异' }).matches(':disabled')).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: '预览目标差异' }));
  expect((await screen.findAllByRole('columnheader', { name: '目标当前草稿' })).length).toBeGreaterThan(0);
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

test('预览拒绝直接展示原因、处理指引和目标请求号，保留选择并可重新预览', async () => {
  let attempts = 0;
  const snapshot = { ...definition, scopeCodes: ['regression.aag.dubbo', 'common_open_api'] };
  const message = '目标「生产（prod）」拒绝预览：以下权限组不存在或已停用：regression.aag.dubbo、common_open_api。请在目标环境的「权限组」按代码创建缺失的组或启用停用的组，再重新预览；跨环境发布不会自动创建权限组。（目标 HTTP 400，错误码 40000001；目标请求号：target-proof）';
  const fetchMock = vi.fn(async (url: string) => {
    if (url.endsWith('/targets')) return ok([{ id: 'prod', name: '生产', nodeIds: ['a'] }]);
    if (url.includes('/publications?')) return ok({ items: [release], total: 1, page: 1, pageSize: 20 });
    if (url.endsWith('/publications/r1')) return ok({ ...release, snapshot });
    if (url.endsWith('/preview')) {
      attempts++;
      return attempts === 1 ? Response.json({ code: 40900001, resultMsg: message, requestId: 'source-proof', data: null }, { status: 409 }) : ok({ ...preview, definition: snapshot });
    }
    throw new Error(url);
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<EnvironmentReleasePanel api={createAdminApi('proof', vi.fn())} canPublish />);
  await chooseSource();
  await choose('目标环境', '生产（prod）');
  expect(screen.getByText('目标需启用的权限组（2）')).toBeTruthy();
  expect(screen.getByText('regression.aag.dubbo')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '预览目标差异' }));
  await screen.findByText('目标预览未通过');
  const feedback = screen.getByText(/目标请求号：target-proof/);
  expect(feedback.closest('details')).toBeNull();
  expect(feedback.textContent).toContain('source-proof');
  expect(screen.getByRole('button', { name: '重新预览' }).matches(':disabled')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '重新预览' }));
  await screen.findByRole('button', { name: '返回调整配置' });
  expect(attempts).toBe(2);
  expect(fetchMock.mock.calls.filter(([url]) => url === '/admin-api/environment-releases')).toHaveLength(0);
});

test('先预览完整差异再确认，覆盖binding保精度，修改目标输入废弃预览', async () => {
  const fetchMock = setup();
  await previewRelease();
  expect(screen.getByText(/旧订单/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'返回调整配置'}));
  fireEvent.click(screen.getByText('目标准备与高级配置'));
  fireEvent.change(screen.getByLabelText('目标绑定覆盖 JSON（可选）'), { target: { value: '{"protocol":"HTTP","amount":0.123456789012345678901}' } });
  expect(screen.queryAllByRole('columnheader', { name: '目标当前草稿' })).toHaveLength(0);
  await waitFor(() => expect(screen.getByRole('button', { name: '预览目标差异' }).matches(':disabled')).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: '预览目标差异' }));
  expect((await screen.findAllByRole('columnheader', { name: '目标当前草稿' })).length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole('button', { name: '核对跨环境发送' }));
  expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(2);
  // 测试环境固定 useId，弹窗可访问名称无法区分，按内容核对标题与后果说明。
  expect(screen.getByRole('dialog').textContent).toMatch(/^跨环境发送.*完整替换/);
  fireEvent.click(screen.getByRole('button', { name: '确认跨环境发送' }));
  await screen.findByText('已取得目标回执');
  const posts = fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST');
  expect(String(posts[2][1]?.body)).toContain('0.123456789012345678901');
  expect(String(posts[2][1]?.body)).toContain(String(posts[1][1]?.body).slice(0, -1));
  expect(new Headers(posts[2][1]?.headers).get('X-CSRF-Token')).toBe('csrf');
  expect(screen.queryByText('全部目标节点当前已生效')).toBeNull();
});

test('未知结果保留原正文及UUID手工重试，不能生成新的发送', async () => {
  let count = 0;
  const fetchMock = setup(async () => { if (++count === 1) throw new TypeError('lost response'); return ok(transfer); });
  const original = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation(async (url, init) => url.match(/\/environment-releases\/[^/?]+$/) && !url.endsWith('/targets') && init?.method !== 'POST' ? Response.json({ code: 404, resultMsg: '不存在' }, { status: 404 }) : original(url, init));
  await previewRelease();
  fireEvent.click(screen.getByRole('button', { name: '核对跨环境发送' }));
  fireEvent.click(screen.getByRole('button', { name: '确认跨环境发送' }));
  expect((await screen.findByRole('alert')).textContent).toContain('未收到操作结果');
  expect(screen.getByLabelText('目标环境').matches(':disabled')).toBe(true);
  expect(screen.queryByRole('button', { name: '同键重试原发送' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '查询原传输' }));
  fireEvent.click(await screen.findByRole('button', { name: '同键重试原发送' }));
  await screen.findByText('已取得目标回执');
  const writes = fetchMock.mock.calls.filter(([url, init]) => init?.method === 'POST' && !url.endsWith('/preview'));
  expect(writes).toHaveLength(2);
  expect(writes[0][1]?.body).toBe(writes[1][1]?.body);
});



test('目标审核展示固定来源差异，保留原审批流程', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url.includes('/incoming/') ? ok({ sourceEnvironment: 'dev', sourceReleaseId: 'r1', operatorTenantId: 'tenant', operatorEmployeeNo: 'E1', before: { name: '旧订单' }, after: definition, changedFields: ['name'] }) : ok({ ...release, status: 'PENDING', draftRevision: 3, snapshot: definition })));
  render(<ReleaseReview onChanged={vi.fn()} onBack={vi.fn()} api={createAdminApi('csrf', vi.fn())} releaseId="r1" canReview={true} />);
  await screen.findByText('跨环境来源：dev');
  expect(screen.getByText(/旧订单/)).toBeTruthy();
  expect(screen.getByRole('button', { name: '通过审核' })).toBeTruthy();
});



test('目标来源读取未完成或失败时不可在缺少差异情况下审批', async () => {
  let rejectIncoming: (reason: unknown) => void = () => {};
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url.includes('/incoming/') ? new Promise<Response>((_resolve, reject) => { rejectIncoming = reject; }) : ok({ ...release, status: 'PENDING', snapshot: definition })));
  render(<ReleaseReview onChanged={vi.fn()} onBack={vi.fn()} api={createAdminApi('csrf', vi.fn())} releaseId="r1" canReview={true} />);
  expect((await screen.findByRole('button', { name: '通过审核' })).matches(':disabled')).toBe(true);
  rejectIncoming(new Error('network'));
  await screen.findByText(/跨环境来源读取失败/);
  expect(screen.getByRole('button', { name: '通过审核' }).matches(':disabled')).toBe(true);
});

test('切换主导航卸载后仍从会话保留的正文恢复同键重试', async () => {
  const pendingTransfers = new Map<string, string>();
  const api = createAdminApi('csrf', vi.fn());
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/preview')) return ok(preview);
    if (url.endsWith('/publications/r1')) return ok(release);
    if (/\/environment-releases\/[^/?]+$/.test(url) && !url.endsWith('/targets') && init?.method !== 'POST') return Response.json({ code: 404, resultMsg: '不存在' }, { status: 404 });
    if (init?.method === 'POST') throw new TypeError('lost response');
    if (url.endsWith('/targets')) return ok([{ id: 'prod', name: '生产', nodeIds: ['a', 'b'] }]);
    return ok({ items: url.includes('/publications?') ? [release] : [], total: 1 });
  });
  vi.stubGlobal('fetch', fetchMock);
  const view = render(<EnvironmentReleasePanel api={api} pendingTransfers={pendingTransfers} />);
  await previewRelease();
  fireEvent.click(screen.getByRole('button', { name: '核对跨环境发送' }));
  fireEvent.click(screen.getByRole('button', { name: '确认跨环境发送' }));
  await screen.findByRole('alert');
  expect(pendingTransfers.size).toBe(1);
  view.unmount();
  render(<EnvironmentReleasePanel api={api} pendingTransfers={pendingTransfers} />);
  fireEvent.click(await screen.findByRole('button', { name: '查询原传输' }));
  fireEvent.click(await screen.findByRole('button', { name: '同键重试原发送' }));
  await screen.findByRole('alert');
  const writes = fetchMock.mock.calls.filter(([url, init]) => init?.method === 'POST' && !url.endsWith('/preview'));
  expect(writes).toHaveLength(2);
  expect(writes[0][1]?.body).toBe(writes[1][1]?.body);
});

test('单API跨环境来源固定为生效快照，无目标时不展示虚构环境或连接映射', async () => {
  const fetchMock = vi.fn(async (_url: string) => ok([]));
  vi.stubGlobal('fetch', fetchMock);
  render(<EnvironmentReleasePanel api={createAdminApi('csrf', vi.fn())} source={{ apiId: definition.id, releaseId: 'fixed-live-r1', stateVersion: 1, enabled: false, appliedAt: '', snapshot: definition }} />);
  await screen.findByText(/尚未配置可发送的目标环境/);
  expect(screen.getByText('fixed-live-r1')).toBeTruthy();
  expect(screen.queryByLabelText('来源发布快照')).toBeNull();
  expect(screen.queryByLabelText('目标环境')).toBeNull();
  expect(screen.getByRole('button', { name: '预览目标差异' }).matches(':disabled')).toBe(true);
  expect(fetchMock.mock.calls.every(([url]) => String(url).endsWith('/environment-releases/targets'))).toBe(true);
});

test('目标Dubbo连接使用远端分页目录的固定修订，切换目标后清空映射和预览', async () => {
  const snapshot = { ...definition, protocol: 'DUBBO', binding: { protocol: 'DUBBO', timeoutMillis: 3000, dubbo: { connectionId: 'source-connection', connectionRevision: 1, interfaceName: 'example.OrderService', method: 'query', parameterTypes: ['java.lang.String'], version: 'v1', group: '' } } };
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/targets')) return ok([{ id: 'pre', name: '预发', nodeIds: ['n1'] }, { id: 'prod', name: '生产', nodeIds: ['n2'] }]);
    if (url.includes('/dubbo-connections?')) return new Response('{"code":200,"data":{"environmentId":"pre","nodeId":"n1","items":[{"id":"target-connection","name":"目标订单服务","description":"目标注册中心","revision":9007199254740993}],"total":21,"page":1,"pageSize":20}}');
    if (url.endsWith('/preview')) return ok({ ...preview, definition: snapshot });
    throw new Error(`unexpected ${init?.method} ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<EnvironmentReleasePanel api={createAdminApi('csrf', vi.fn())} source={{ apiId: definition.id, releaseId: 'fixed-live-r1', stateVersion: 1, enabled: false, appliedAt: '', snapshot }} />);
  await choose('目标环境', '预发（pre）');
  await screen.findByRole('combobox', { name: '目标 Dubbo 连接' });
  expect(screen.getByRole('button', { name: '预览目标差异' }).matches(':disabled')).toBe(true);
  await choose('目标 Dubbo 连接', '目标订单服务 · r9007199254740993');
  fireEvent.click(screen.getByRole('button', { name: '预览目标差异' }));
  expect((await screen.findAllByRole('columnheader', { name: '目标当前草稿' })).length).toBeGreaterThan(0);
  const body = String(fetchMock.mock.calls.find(([url]) => url.endsWith('/preview'))?.[1]?.body);
  expect(body).toContain('"releaseId":"fixed-live-r1"');
  expect(body).toContain('"connectionId":"target-connection","connectionRevision":9007199254740993');
  expect(body).not.toContain('source-connection');
  // 改目标会作废当前预览/跟踪并回到第一步，这里直接操作已收起的设置区。
  await choose('目标环境', '生产（prod）', true);
  await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url.includes('/targets/prod/dubbo-connections?page=1&pageSize=20'))).toBe(true));
  expect(screen.queryAllByRole('columnheader', { name: '目标当前草稿' })).toHaveLength(0);
  expect(screen.getByRole('button', { name: '预览目标差异' }).matches(':disabled')).toBe(true);
});

test('高级绑定按原文到达预览严格边界，重复键失败保留输入且不发送', async () => {
  const raw = '{"protocol":"HTTP","timeoutMillis":3000,"http":{"url":"https://first.example/orders","url":"https://second.example/orders","method":"POST"}}';
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/targets')) return ok([{ id: 'prod', name: '生产', nodeIds: ['a'] }]);
    if (url.endsWith('/preview')) {
      expect(String(init?.body)).toContain(`"binding":${raw}`);
      return Response.json({ code: 400, resultMsg: '请求必须是合法JSON对象' }, { status: 400 });
    }
    throw new Error(`unexpected ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<EnvironmentReleasePanel api={createAdminApi('csrf', vi.fn())} source={{ apiId: definition.id, releaseId: 'r1', stateVersion: 1, enabled: true, appliedAt: '', snapshot: definition }} />);
  await choose('目标环境', '生产（prod）');
  fireEvent.click(screen.getByText('目标准备与高级配置'));
  fireEvent.change(screen.getByLabelText('目标绑定覆盖 JSON（可选）'), { target: { value: raw } });
  fireEvent.click(screen.getByRole('button', { name: '预览目标差异' }));
  await screen.findByText('请求必须是合法JSON对象');
  expect((screen.getByLabelText('目标绑定覆盖 JSON（可选）') as HTMLTextAreaElement).value).toBe(raw);
  expect(screen.queryByRole('button', { name: '核对跨环境发送' })).toBeNull();
  expect(fetchMock.mock.calls.some(([url]) => url.includes('/apis/validate-json') || url.endsWith('/environment-releases'))).toBe(false);
});

test('HTTP目标配置完整支持五种真实方法并正确显示来源PUT', async () => {
  const snapshot = { ...definition, binding: { protocol: 'HTTP', timeoutMillis: 3000, http: { url: 'https://source.example/orders', method: 'PUT' } } };
  const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => url.endsWith('/targets') ? ok([{ id: 'prod', name: '生产', nodeIds: ['a'] }]) : ok(preview));
  vi.stubGlobal('fetch', fetchMock);
  render(<EnvironmentReleasePanel api={createAdminApi('csrf', vi.fn())} source={{ apiId: definition.id, releaseId: 'r1', stateVersion: 1, enabled: true, appliedAt: '', snapshot }} />);
  await choose('目标环境', '生产（prod）');
  fireEvent.mouseDown(await screen.findByRole('combobox', { name: '目标 HTTP 方法' }));
  await waitFor(() => expect(optionTexts()).toEqual(expect.arrayContaining(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])));
  expect([...document.querySelectorAll('.ant-select-item-option-selected')].at(-1)?.textContent).toBe('PUT');
  await choose('目标 HTTP 方法', 'PATCH');
  fireEvent.click(screen.getByRole('button', { name: '预览目标差异' }));
  expect((await screen.findAllByRole('columnheader', { name: '目标当前草稿' })).length).toBeGreaterThan(0);
  expect(String(fetchMock.mock.calls.find(([url]) => url.endsWith('/preview'))?.[1]?.body)).toContain('"method":"PATCH"');
});

test('共享未决发送按API归属恢复，B不接管A，同API新生效仍追踪旧固定来源', async () => {
  const pendingTransfers = new Map([['api:api-a', '{"transferId":"transfer-a","releaseId":"old-release-a","targetId":"prod"}']]);
  const api = createAdminApi('csrf', vi.fn());
  vi.stubGlobal('fetch', vi.fn(async () => ok([{ id: 'prod', name: '生产', nodeIds: ['a'] }])));
  const sourceB = { apiId: 'api-b', releaseId: 'release-b', stateVersion: 1, enabled: true, appliedAt: '', snapshot: { ...definition, id: 'api-b', name: 'API B' } };
  const view = render(<EnvironmentReleasePanel api={api} source={sourceB} pendingTransfers={pendingTransfers} />);
  const target = await screen.findByLabelText('目标环境');
  expect(target.matches(':disabled')).toBe(false);
  expect(screen.queryByRole('button', { name: '查询原传输' })).toBeNull();
  expect(screen.queryByText(/transfer-a/)).toBeNull();
  view.rerender(<EnvironmentReleasePanel api={api} source={{ ...sourceB, apiId: 'api-a', releaseId: 'new-release-a', snapshot: { ...definition, id: 'api-a', name: 'API A', draftRevision: 5 } }} pendingTransfers={pendingTransfers} />);
  await screen.findByRole('button', { name: '查询原传输' });
  expect(screen.getByText(/固定来源发布 old-release-a → 目标 prod/)).toBeTruthy();
  expect(screen.queryByText(/固定发布记录 new-release-a/)).toBeNull();
  expect(pendingTransfers.size).toBe(1);
});

test('来源发布变化与卸载中止预览，晚到响应不能恢复旧差异或解锁错误发送', async () => {
  let finish: (value: Response) => void = () => {};
  let signal: AbortSignal | undefined;
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/targets')) return ok([{ id: 'prod', name: '生产', nodeIds: ['a'] }]);
    if (url.endsWith('/preview')) {
      signal = init?.signal as AbortSignal;
      return new Promise<Response>(resolve => { finish = resolve; });
    }
    throw new Error(`unexpected ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  const api = createAdminApi('csrf', vi.fn());
  const source = { apiId: definition.id, releaseId: 'r1', stateVersion: 1, enabled: true, appliedAt: '', snapshot: definition };
  const view = render(<EnvironmentReleasePanel api={api} source={source} />);
  await choose('目标环境', '生产（prod）');
  fireEvent.click(screen.getByRole('button', { name: '预览目标差异' }));
  await waitFor(() => expect(signal).toBeDefined());
  view.rerender(<EnvironmentReleasePanel api={api} source={{ ...source, releaseId: 'r2' }} />);
  expect(signal?.aborted).toBe(true);
  await act(async () => { finish(ok(preview)); });
  expect(screen.queryAllByRole('columnheader', { name: '目标当前草稿' })).toHaveLength(0);
  expect(screen.queryByRole('button', { name: '核对跨环境发送' })).toBeNull();
  expect(screen.getByRole('button', { name: '预览目标差异' }).matches(':disabled')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '预览目标差异' }));
  await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/preview'))).toHaveLength(2));
  view.unmount();
  expect(signal?.aborted).toBe(true);
});

test('另一工作区已经留下同API未决发送时，确认不会覆盖原正文或建立新传输', async () => {
  const pendingTransfers = new Map<string, string>();
  const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => url.endsWith('/targets') ? ok([{ id: 'prod', name: '生产', nodeIds: ['a'] }]) : ok(preview));
  vi.stubGlobal('fetch', fetchMock);
  render(<EnvironmentReleasePanel api={createAdminApi('csrf', vi.fn())} pendingTransfers={pendingTransfers} source={{ apiId: definition.id, releaseId: 'r1', stateVersion: 1, enabled: true, appliedAt: '', snapshot: definition }} />);
  await choose('目标环境', '生产（prod）');
  fireEvent.click(screen.getByRole('button', { name: '预览目标差异' }));
  expect((await screen.findAllByRole('columnheader', { name: '目标当前草稿' })).length).toBeGreaterThan(0);
  const original = '{"transferId":"previous-transfer","releaseId":"r0","targetId":"prod"}';
  pendingTransfers.set('api:api1', original);
  fireEvent.click(screen.getByRole('button', { name: '核对跨环境发送' }));
  fireEvent.click(screen.getByRole('button', { name: '确认跨环境发送' }));
  await screen.findByText('此 API 已有结果未确认的原传输，请先查询原传输。');
  expect(fetchMock.mock.calls.some(([url]) => url.endsWith('/environment-releases'))).toBe(false);
  expect(pendingTransfers.get('api:api1')).toBe(original);
  expect(screen.getByRole('button', { name: '查询原传输' })).toBeTruthy();
});

test.each(['发送成功', '发送失败', '查询成功'])('旧工作区卸载后%s晚到不会清除新工作区同API未决发送', async outcome => {
  let finishOld: ((response: Response) => void) | undefined;
  let oldId = 'old-transfer';
  let writes = 0;
  let reads = 0;
  const pendingTransfers = new Map<string, string>();
  if (outcome === '查询成功') pendingTransfers.set('api:api1', JSON.stringify({ transferId: oldId, releaseId: 'r1', targetId: 'prod' }));
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/targets')) return ok([{ id: 'prod', name: '生产', nodeIds: ['a'] }]);
    if (url.endsWith('/preview')) return ok(preview);
    if (url.endsWith('/environment-releases') && init?.method === 'POST') {
      if (++writes === 1 && outcome !== '查询成功') {
        oldId = JSON.parse(String(init.body)).transferId;
        return new Promise<Response>(resolve => { finishOld = resolve; });
      }
      throw new TypeError('new response lost');
    }
    if (url.endsWith(`/environment-releases/${oldId}`)) {
      if (++reads === 1 && outcome === '查询成功') return new Promise<Response>(resolve => { finishOld = resolve; });
      return ok({ ...transfer, id: oldId });
    }
    throw new Error(`unexpected ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  const api = createAdminApi('csrf', vi.fn());
  const source = { apiId: definition.id, releaseId: 'r1', stateVersion: 1, enabled: true, appliedAt: '', snapshot: definition };
  const oldView = render(<EnvironmentReleasePanel api={api} source={source} pendingTransfers={pendingTransfers} />);
  if (outcome === '查询成功') fireEvent.click(await screen.findByRole('button', { name: '查询原传输' }));
  else {
    await choose('目标环境', '生产（prod）');
    fireEvent.click(screen.getByRole('button', { name: '预览目标差异' }));
    fireEvent.click(await screen.findByRole('button', { name: '核对跨环境发送' }));
    fireEvent.click(screen.getByRole('button', { name: '确认跨环境发送' }));
  }
  await waitFor(() => expect(finishOld).toBeDefined());
  oldView.unmount();
  render(<EnvironmentReleasePanel api={api} source={source} pendingTransfers={pendingTransfers} />);
  fireEvent.click(await screen.findByRole('button', { name: '查询原传输' }));
  await waitFor(() => expect(pendingTransfers.size).toBe(0));
  // 改目标会作废当前预览/跟踪并回到第一步，这里直接操作已收起的设置区。
  await choose('目标环境', '生产（prod）', true);
  fireEvent.click(screen.getByRole('button', { name: '预览目标差异' }));
  fireEvent.click(await screen.findByRole('button', { name: '核对跨环境发送' }));
  fireEvent.click(screen.getByRole('button', { name: '确认跨环境发送' }));
  await screen.findByRole('alert');
  const newBody = pendingTransfers.get('api:api1');
  expect(newBody).toBeDefined();
  expect(JSON.parse(newBody!).transferId).not.toBe(oldId);
  await act(async () => { finishOld!(outcome === '发送失败' ? Response.json({ code: 409, resultMsg: '旧请求冲突' }, { status: 409 }) : ok({ ...transfer, id: oldId })); });
  expect(pendingTransfers.get('api:api1')).toBe(newBody);
  expect(screen.getByRole('button', { name: '查询原传输' })).toBeTruthy();
  expect(screen.queryByText('旧请求冲突')).toBeNull();
});

test('旧API查询晚到只结算自身记录，不覆盖当前API的追踪状态', async () => {
  let finish: ((response: Response) => void) | undefined;
  const bodyA = JSON.stringify({ transferId: 'transfer-a', releaseId: 'release-a', targetId: 'prod' });
  const bodyB = JSON.stringify({ transferId: 'transfer-b', releaseId: 'release-b', targetId: 'prod' });
  const pendingTransfers = new Map([['api:api-a', bodyA], ['api:api-b', bodyB]]);
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/targets') ? ok([{ id: 'prod', name: '生产', nodeIds: ['a'] }]) : new Promise<Response>(resolve => { finish = resolve; })));
  const api = createAdminApi('csrf', vi.fn());
  const source = { apiId: 'api-a', releaseId: 'release-a', stateVersion: 1, enabled: true, appliedAt: '', snapshot: { ...definition, id: 'api-a' } };
  const view = render(<EnvironmentReleasePanel api={api} source={source} pendingTransfers={pendingTransfers} />);
  fireEvent.click(await screen.findByRole('button', { name: '查询原传输' }));
  await waitFor(() => expect(finish).toBeDefined());
  view.rerender(<EnvironmentReleasePanel api={api} source={{ ...source, apiId: 'api-b', releaseId: 'release-b', snapshot: { ...definition, id: 'api-b' } }} pendingTransfers={pendingTransfers} />);
  await screen.findByText(/原传输号：transfer-b/);
  await act(async () => { finish!(ok({ ...transfer, id: 'transfer-a' })); });
  expect(pendingTransfers.has('api:api-a')).toBe(false);
  expect(pendingTransfers.get('api:api-b')).toBe(bodyB);
  expect(screen.queryByText(/原传输号：transfer-a/)).toBeNull();
  expect(screen.queryByRole('region', { name: '传输详情' })).toBeNull();
  expect(screen.getByRole('button', { name: '查询原传输' }).matches(':disabled')).toBe(false);
});

test('收起的高级绑定格式错误自动展开定位，输入保留且不发送预览', async () => {
  const fetchMock=setup();
  await chooseSource();
  await choose('目标环境','生产（prod）');
  const input=await screen.findByLabelText('目标绑定覆盖 JSON（可选）');
  const details=input.closest('details')!;
  details.open=true;
  fireEvent.change(input,{target:{value:'{"protocol":'}});
  details.open=false;
  fireEvent.click(screen.getByRole('button',{name:'预览目标差异'}));
  await waitFor(()=>expect(input.getAttribute('aria-invalid')).toBe('true'));
  expect(details.open).toBe(true);
  expect(document.activeElement).toBe(input);
  expect((input as HTMLTextAreaElement).value).toBe('{"protocol":');
  expect(fetchMock.mock.calls.some(([,init])=>init?.method==='POST')).toBe(false);
});

test('发送被目标拒绝后回到可调整配置，不遗留空白核对步骤', async()=>{
  setup(async()=>Response.json({code:409,resultMsg:'目标草稿已更新，请重新预览'},{status:409}));
  await previewRelease();
  fireEvent.click(screen.getByRole('button',{name:'核对跨环境发送'}));
  fireEvent.click(screen.getByRole('button',{name:'确认跨环境发送'}));
  await screen.findByText('目标草稿已更新，请重新预览');
  expect(screen.getByRole('button',{name:'预览目标差异'}).matches(':disabled')).toBe(false);
  expect(screen.getByRole('combobox',{name:'目标环境'}).closest('.ant-select')?.textContent).toContain('生产（prod）');
  expect(screen.queryByRole('button',{name:'核对跨环境发送'})).toBeNull();
});

test('预览接近正文上限但最终发送超限时定位配置，不留未决记录或发出写入',async()=>{
 const fetchMock=setup();
 await chooseSource();
 await choose('目标环境','生产（prod）');
 const input=await screen.findByLabelText('目标绑定覆盖 JSON（可选）');
 fireEvent.change(input,{target:{value:JSON.stringify({protocol:'HTTP',padding:'x'.repeat(262000)})}});
 fireEvent.change(screen.getByLabelText('跨环境发布备注'),{target:{value:'备注'.repeat(100)}});
 fireEvent.click(screen.getByRole('button',{name:'预览目标差异'}));
 fireEvent.click(await screen.findByRole('button',{name:'核对跨环境发送'}));
 fireEvent.click(screen.getByRole('button',{name:'确认跨环境发送'}));
 await screen.findByText('正文不能超过 256 KiB。');
 await waitFor(()=>expect(document.activeElement).toBe(input));
 expect(input.closest('details')!.open).toBe(true);
 expect(screen.queryByRole('button',{name:'查询原传输'})).toBeNull();
 expect(screen.getByRole('button',{name:'预览目标差异'}).matches(':disabled')).toBe(false);
 expect(fetchMock.mock.calls.filter(([,init])=>init?.method==='POST')).toHaveLength(1);
});

test('服务名来源的可选URL覆盖清空恢复继承，保留已明确的发现目标', async () => {
  const snapshot = {...definition,binding:{protocol:'HTTP',timeoutMillis:3000,http:{url:'https://inactive.example/old',method:'POST',targetMode:'SERVICE_NAME',serviceName:'orders',path:'/lookup'}}};
  const fetchMock=vi.fn(async(url:string,_init?:RequestInit)=>url.endsWith('/targets') ? ok([{id:'prod',name:'生产',nodeIds:['a']}]) : ok({...preview,definition:snapshot}));
  vi.stubGlobal('fetch',fetchMock);
  render(<EnvironmentReleasePanel api={createAdminApi('csrf',vi.fn())} source={{apiId:definition.id,releaseId:"r1",stateVersion:1,enabled:true,appliedAt:"",snapshot}}/>);
  await choose('目标环境','生产（prod）');
  fireEvent.click(screen.getByText('目标准备与高级配置'));
  const address=screen.getByLabelText('目标环境固定 URL（可选覆盖服务名发现）');
  expect(address).toHaveProperty('value','');
  fireEvent.change(address,{target:{value:'https://target.example/lookup'}});
  fireEvent.change(address,{target:{value:''}});
  fireEvent.click(screen.getByRole('button',{name:'预览目标差异'}));
  await screen.findByRole('button',{name:'返回调整配置'});
  const submitted=fetchMock.mock.calls.find(([url])=>url.endsWith('/preview'))![1]!;
  expect(JSON.parse(String(submitted.body))).not.toHaveProperty('binding');
});
