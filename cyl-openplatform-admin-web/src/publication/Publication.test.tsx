import { PlatformTheme } from '@cyl/open-platform-web-shared/ui/PlatformTheme';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import PublicationPanel from './PublicationPanel';
import PublishPage from './PublishPage';
import { createAdminApi } from '../access/api';
import { AdminNavigationProvider } from '../navigation/AdminNavigation';
import type { ReactNode } from 'react';
import type { ApiDefinition } from '../catalog/CatalogPanel';

const ok = (data: unknown) => Response.json({ code: 200, data, requestId: 'r1' });
const page = (items: unknown[], total = items.length) => ({ items, total, page: 1, pageSize: 20 });
const definition = { id: 'api1', name: '查询订单', service: 'orders', version: 'v1', method: 'query', category: '订单', owner: '研发', protocol: 'HTTP', draftRevision: 3, scopeCodes: ['orders'], requestSchema: {} as ApiDefinition['requestSchema'], responseSchema: {} as ApiDefinition['responseSchema'], errorDefinitions: [], binding: { protocol: 'HTTP' }, mappings: [] };
const state = { apiId: 'api1', stateVersion: 2, enabled: false, liveReleaseId: 'old', pendingReleaseId: null };
const release = { id: 'r1', apiId: 'api1', name: '查询订单', service: 'orders', version: 'v1', method: 'query', draftRevision: 3, status: 'PENDING', auditRequired: true, submittedAt: '2026-09-09T00:00:00Z', submittedByTenantId: 't1', submittedByEmployeeNo: 'E1', reviewedAt: null, reviewedByTenantId: null, reviewedByEmployeeNo: null, failureReason: null, submissionKey: 'key', comment: '升级订单', reviewComment: null, baseline: null, baselineKnown: true, snapshot: definition };
function renderPage(content: ReactNode) { window.history.replaceState({}, '', '/#/publications'); return render(<PlatformTheme><AdminNavigationProvider>{content}</AdminNavigationProvider></PlatformTheme>); }
async function chooseMore(item: string) { fireEvent.click(await screen.findByRole('button', { name: '更多发布操作' })); fireEvent.click(await screen.findByText(item)); }
async function openApi() { const opener = screen.queryByRole('button', { name: '发布与调用状态' }); if (opener) fireEvent.click(opener); fireEvent.click(await screen.findByRole('button', { name: '查询订单' })); }
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

test('工作区按固定快照内容判断相同，修订不同也不重复发布', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('/candidate')) return ok(definition);
    if (url.endsWith('/scope-labels')) return ok({ orders: { name: '订单读取', enabled: true } });
    if (url.endsWith('/config')) return ok({ auditEnabled: true });
    if (url.endsWith('/state')) return ok(state);
    if (url.endsWith('/effective')) return ok({ ...state, releaseId: 'old', appliedAt: '', snapshot: { ...definition, draftRevision: 1 } });
    return ok(page([]));
  }));
  render(<PublishPage api={createAdminApi('proof', vi.fn())} definition={definition} canPublish onChanged={vi.fn()} onReview={vi.fn()} pendingSubmissions={new Map()} />);
  expect(await screen.findByText('已保存草稿与生效版本一致，无需发布。')).toBeTruthy();
  expect(screen.getByRole('button', { name: '提交审核' }).matches(':disabled')).toBe(true);
  expect(screen.getByText('已保存草稿与生效版本内容一致')).toBeTruthy();
});

test('未知提交结果保留原UUID和修订备注重试，携带CSRF且不会重新启用API', async () => {
  let writes = 0;
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/candidate')) return ok(definition);
    if (url.endsWith('/scope-labels')) return ok({ orders: { name: '订单读取', enabled: true } });
    if (init?.method === 'POST') { if (++writes === 1) throw new TypeError('network'); return ok(release); }
    if (/\/submissions\/[^/]+$/.test(url)) return Response.json({ code: 404, resultMsg: '不存在' }, { status: 404 });
    if (url.endsWith('/config')) return ok({ auditEnabled: true });
    if (url.endsWith('/state')) return ok(state);
    if (url.endsWith('/effective')) return ok({ ...state, releaseId: 'old', appliedAt: '', snapshot: { ...definition, name: '旧订单', draftRevision: 1 } });
    if (url.includes('/audit?')) return ok(page([]));
    return ok(page(url.includes('/publications/apis?') ? [definition] : []));
  });
  vi.stubGlobal('fetch', fetchMock);
  renderPage(<PublicationPanel pendingSubmissions={new Map()} api={createAdminApi('proof', vi.fn())} permissions={['PUBLISH_APIS']} />);
  await openApi();
  await waitFor(() => expect(screen.getByRole('button', { name: '提交审核' })).toHaveProperty('disabled', false));
  fireEvent.change(screen.getByLabelText('发布备注'), { target: { value: '升级订单' } });
  fireEvent.click(screen.getByRole('button', { name: '提交审核' }));
  expect(await screen.findByText(/未收到操作结果/)).toBeTruthy();
  expect(screen.getByText('提交结果未知，请先查询原提交')).toBeTruthy();
  expect(screen.getByRole('button',{name:'提交审核'})).toHaveProperty('disabled',true);
  expect(screen.queryByRole('button', { name: '重试原提交' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '查询原提交结果' }));
  fireEvent.click(await screen.findByRole('button', { name: '重试原提交' }));
  await screen.findByText(/提交结果：待审核/);
  const calls = fetchMock.mock.calls.filter(([url, init]) => init?.method === 'POST' && !url.endsWith('/scope-labels'));
  expect(calls).toHaveLength(2);
  expect(calls[0][1]?.body).toBe(calls[1][1]?.body);
  expect(JSON.parse(String(calls[0][1]?.body))).toEqual({ expectedDraftRevision: 3, expectedStateVersion: 2, comment: '升级订单', submissionKey: expect.stringMatching(/^[a-f0-9-]{36}$/) });
  expect(new Headers(calls[0][1]?.headers).get('X-CSRF-Token')).toBe('proof');
  expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false);
});

test('审核只展示固定快照，批准返回FAILED时显示失败事实并关闭审批按钮', async () => {
  const precise = JSON.stringify(release).replace('"requestSchema":{}', '"requestSchema":{"example":9007199254740993}');
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/candidate')) return ok(definition);
    if (url.endsWith('/scope-labels')) return ok({ orders: { name: '订单读取', enabled: true } });
    if (init?.method === 'POST') return ok({ ...release, status: 'FAILED', failureReason: 'Scope 已停用', reviewComment: '同意', reviewedByEmployeeNo: 'E2' });
    if (/\/submissions\/[^/]+$/.test(url)) return Response.json({ code: 404, resultMsg: '不存在' }, { status: 404 });
    if (url.endsWith('/config')) return ok({ auditEnabled: false });
    if (url.endsWith('/publications/r1')) return new Response(`{"code":200,"data":${precise}}`);
    return ok(page(url.includes('/publications/apis?') ? [] : [release]));
  });
  vi.stubGlobal('fetch', fetchMock);
  renderPage(<PublicationPanel pendingSubmissions={new Map()} api={createAdminApi('proof', vi.fn())} permissions={['REVIEW_APIS']} />);
  fireEvent.click(await screen.findByRole('button', { name: '查看固定快照与差异' }));
  fireEvent.click(await screen.findByRole('tab', { name: '固定快照' }));
  expect((await screen.findAllByText('9007199254740993', { selector: 'code' })).length).toBeGreaterThan(0);
  expect(screen.getByRole('region', { name: '内部服务' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: '提交当前修订' })).toBeNull();
  fireEvent.change(screen.getByLabelText('审核意见'), { target: { value: '同意' } });
  fireEvent.click(screen.getByRole('button', { name: '通过审核' }));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('Scope 已停用'));
  expect(screen.queryByRole('button', { name: '通过审核' })).toBeNull();
  expect(fetchMock.mock.calls.some(([url]) => url === '/admin-api/apis/api1')).toBe(false);
  expect(JSON.parse(String(fetchMock.mock.calls.find(([url, init]) => init?.method === 'POST' && !url.endsWith('/scope-labels'))?.[1]?.body))).toEqual({ comment: '同意' });
});

test('启停携带独立状态版本，冲突不伪装成功且可刷新最新生效状态', async () => {
  let current = state;
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/candidate')) return ok(definition);
    if (url.endsWith('/scope-labels')) return ok({ orders: { name: '订单读取', enabled: true } });
    if (init?.method === 'PUT') { current = { ...state, stateVersion: 3 }; return Response.json({ code: 409, resultMsg: '状态已变化', requestId: 'conflict-1' }, { status: 409 }); }
    if (/\/submissions\/[^/]+$/.test(url)) return Response.json({ code: 404, resultMsg: '不存在' }, { status: 404 });
    if (url.endsWith('/config')) return ok({ auditEnabled: true });
    if (url.endsWith('/state')) return ok(current);
    if (url.endsWith('/effective')) return ok({ ...current, releaseId: 'old', appliedAt: '', snapshot: definition });
    if (url.includes('/audit?')) return ok(page([]));
    return ok(page(url.includes('/publications/apis?') ? [definition] : []));
  });
  vi.stubGlobal('fetch', fetchMock);
  renderPage(<PublicationPanel pendingSubmissions={new Map()} api={createAdminApi('proof', vi.fn())} permissions={['PUBLISH_APIS']} />);
  await openApi();
  await screen.findByText('已停用');
  fireEvent.click(await screen.findByRole('button', { name: '启用当前环境 API' }));
  fireEvent.change(await screen.findByLabelText('启停原因'), { target: { value: '恢复订单服务' } });
  fireEvent.click(screen.getByRole('button', { name: '确认启用' }));
  expect(await screen.findByText(/conflict-1/)).toBeTruthy();
  expect(screen.getByText('已停用')).toBeTruthy();
  expect(JSON.parse(String(fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')?.[1]?.body))).toEqual({ enabled: true, expectedStateVersion: 2, reason: '恢复订单服务' });
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  fireEvent.click(screen.getByRole('button', { name: '刷新发布状态' }));
  await chooseMore('发布操作明细');
  fireEvent.click(await screen.findByText('状态指针与生效快照原文'));
  expect(await screen.findByText(/状态版本 3/)).toBeTruthy();
});

test('只读管理人员可过滤分页并核对快照，没有审核或发布按钮', async () => {
  const fetchMock = vi.fn(async (url: string) => {
    if (url.endsWith('/candidate')) return ok(definition);
    if (url.endsWith('/scope-labels')) return ok({ orders: { name: '订单读取', enabled: true } });
    if (/\/submissions\/[^/]+$/.test(url)) return Response.json({ code: 404, resultMsg: '不存在' }, { status: 404 });
    if (url.endsWith('/config')) return ok({ auditEnabled: true });
    if (url.endsWith('/publications/r1')) return ok(release);
    return ok(page(url.includes('/publications/apis?') ? [] : [release], 21));
  });
  vi.stubGlobal('fetch', fetchMock);
  renderPage(<PublicationPanel pendingSubmissions={new Map()} api={createAdminApi('proof', vi.fn())} permissions={['MANAGE_APIS']} />);
  await screen.findByRole('button', { name: '查看固定快照与差异' });
  fireEvent.mouseDown(screen.getByRole('combobox',{name:'结果'}));
  fireEvent.click(await screen.findByText('所有状态',{selector:'.ant-select-item-option-content'}));
  await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => /status=(&|$)/.test(url))).toBe(true));
  await waitFor(() => expect(screen.getByTitle(/下一页|Next Page/).className).not.toContain('disabled'));
  fireEvent.click(screen.getByTitle(/下一页|Next Page/));
  await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url.includes('publications?page=2&pageSize=20'))).toBe(true));
  fireEvent.click(await screen.findByRole('button', { name: '查看固定快照与差异' }));
  fireEvent.click(await screen.findByRole('tab', { name: '固定快照' }));
  await screen.findByText('固定提交快照 · 修订 3');
  expect(screen.getByText('查看原文（JSON）')).toBeTruthy();
  expect(screen.queryByLabelText('审核意见')).toBeNull();
  expect(screen.queryByRole('button', { name: '打开跨环境发布' })).toBeNull();
  expect(screen.queryByRole('button', { name: '提交当前修订' })).toBeNull();
});

test('拒绝必须有原因，审批网络失败需刷新核对后才可再审', async () => {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/candidate')) return ok(definition);
    if (url.endsWith('/scope-labels')) return ok({ orders: { name: '订单读取', enabled: true } });
    if (init?.method === 'POST') throw new TypeError('network');
    if (/\/submissions\/[^/]+$/.test(url)) return Response.json({ code: 404, resultMsg: '不存在' }, { status: 404 });
    if (url.endsWith('/config')) return ok({ auditEnabled: true });
    if (url.endsWith('/publications/r1')) return ok(release);
    return ok(page(url.includes('/publications/apis?') ? [] : [release]));
  });
  vi.stubGlobal('fetch', fetchMock);
  renderPage(<PublicationPanel pendingSubmissions={new Map()} api={createAdminApi('proof', vi.fn())} permissions={['REVIEW_APIS']} />);
  fireEvent.click(await screen.findByRole('button', { name: '查看固定快照与差异' }));
  expect((await screen.findByRole('button', { name: '驳回' })).matches(':disabled')).toBe(true);
  fireEvent.change(screen.getByLabelText('审核意见'), { target: { value: '缺少说明' } });
  fireEvent.click(screen.getByRole('button', { name: '驳回' }));
  expect(await within(screen.getByRole('group', { name: '审核操作' })).findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('未收到操作结果'));
  expect(screen.getByRole('button', { name: '驳回' }).matches(':disabled')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '刷新发布结果' }));
  expect((await screen.findByRole('button', { name: '驳回' })).matches(':disabled')).toBe(false);
});

test('离开API详情再返回仍可重试未知提交，不能静默生成新提交号', async () => {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/candidate')) return ok(definition);
    if (url.endsWith('/scope-labels')) return ok({ orders: { name: '订单读取', enabled: true } });
    if (init?.method === 'POST') throw new TypeError('network');
    if (/\/submissions\/[^/]+$/.test(url)) return Response.json({ code: 404, resultMsg: '不存在' }, { status: 404 });
    if (url.endsWith('/config')) return ok({ auditEnabled: false });
    if (url.endsWith('/state')) return ok({ ...state, liveReleaseId: null });
    if (url.includes('/audit?')) return ok(page([]));
    return ok(page(url.includes('/publications/apis?') ? [definition] : []));
  });
  vi.stubGlobal('fetch', fetchMock);
  renderPage(<PublicationPanel pendingSubmissions={new Map()} api={createAdminApi('proof', vi.fn())} permissions={['PUBLISH_APIS']} />);
  await openApi();
  await waitFor(() => expect(screen.getByRole('button', { name: '直接发布' })).toHaveProperty('disabled', false));
  fireEvent.click(screen.getByRole('button', { name: '直接发布' }));
  await screen.findByText('提交结果未知，请先查询原提交');
  fireEvent.click(screen.getByRole('button', { name: '返回审核列表' }));
  await openApi();
  fireEvent.click(await screen.findByRole('button', { name: '查询原提交结果' }));
  fireEvent.click(await screen.findByRole('button', { name: '重试原提交' }));
  await screen.findByText(/未收到操作结果/);
  const writes = fetchMock.mock.calls.filter(([url, init]) => init?.method === 'POST' && !url.endsWith('/scope-labels'));
  expect(writes).toHaveLength(2);
  expect(writes[0][1]?.body).toBe(writes[1][1]?.body);
});


test('发布状态版本超过安全整数仍精确展示并原样提交启停', async () => {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/candidate')) return ok(definition);
    if (init?.method === 'PUT' || url.endsWith('/state')) return new Response('{"code":200,"data":{"apiId":"api1","stateVersion":9007199254740993,"enabled":false,"liveReleaseId":"old","pendingReleaseId":null}}');
    if (/\/submissions\/[^/]+$/.test(url)) return Response.json({ code: 404, resultMsg: '不存在' }, { status: 404 });
    if (url.endsWith('/config')) return ok({ auditEnabled: true });
    if (url.endsWith('/effective')) return ok({ ...state, releaseId: 'old', appliedAt: '', snapshot: definition });
    if (url.includes('/audit?')) return ok(page([]));
    return ok(page(url.includes('/publications/apis?') ? [definition] : []));
  });
  vi.stubGlobal('fetch', fetchMock);
  renderPage(<PublicationPanel pendingSubmissions={new Map()} api={createAdminApi('proof', vi.fn())} permissions={['PUBLISH_APIS']} />);
  await openApi();
  await chooseMore('发布操作明细');
  fireEvent.click(await screen.findByText('状态指针与生效快照原文'));
  expect(await screen.findByText(/状态版本 9007199254740993/)).toBeTruthy();
  fireEvent.click(await screen.findByRole('button', { name: '启用当前环境 API' }));
  fireEvent.change(await screen.findByLabelText('启停原因'), { target: { value: '恢复服务' } });
  fireEvent.click(screen.getByRole('button', { name: '确认启用' }));
  await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(true));
  expect(String(fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')?.[1]?.body)).toContain('"expectedStateVersion":9007199254740993');
});

test('查询已存在的原提交只读取固定记录，不再次提交或创建新键', async () => {
  const pending = new Map([['api1', { submissionKey: 'original-key', expectedDraftRevision: 3, expectedStateVersion: 2, comment: '原备注' }]]);
  const fetchMock = vi.fn(async (url: string, _options?: RequestInit) => {
    if (url.endsWith('/candidate')) return ok(definition);
    if (url.endsWith('/scope-labels')) return ok({ orders: { name: '订单读取', enabled: true } });
    if (url.endsWith('/submissions/original-key')) return ok(release);
    if (url.endsWith('/config')) return ok({ auditEnabled: true });
    if (url.endsWith('/state')) return ok(state);
    if (url.endsWith('/effective')) return ok({ ...state, releaseId: 'old', appliedAt: '', snapshot: { ...definition, name: '旧订单', draftRevision: 1 } });
    return ok(page(url.includes('/publications/apis?') ? [definition] : []));
  });
  vi.stubGlobal('fetch', fetchMock);
  renderPage(<PublicationPanel pendingSubmissions={pending} api={createAdminApi('proof', vi.fn())} permissions={['PUBLISH_APIS']} />);
  await openApi();
  fireEvent.click(await screen.findByRole('button', { name: '查询原提交结果' }));
  await screen.findByText(/提交结果：待审核/);
  expect(pending.size).toBe(0);
  expect(screen.queryByRole('button', { name: '重试原提交' })).toBeNull();
  expect(fetchMock.mock.calls.every(([url, options]) => url.endsWith('/scope-labels') || !options || options.method === 'GET')).toBe(true);
});

test('撤销发布权限后仍可查询原提交，但不能从未知结果入口重试写入', async () => {
  const fetchMock = vi.fn(async (url: string) => {
    if (url.endsWith('/candidate')) return ok(definition);
    if (url.endsWith('/scope-labels')) return ok({ orders: { name: '订单读取', enabled: true } });
    if (url.includes('/submissions/')) return Response.json({ code: 404, resultMsg: '不存在' }, { status: 404 });
    if (url.endsWith('/config')) return ok({ auditEnabled: true });
    if (url.endsWith('/state')) return ok({ ...state, liveReleaseId: null });
    return ok(page([]));
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<PublishPage api={createAdminApi('proof', vi.fn())} definition={definition} canPublish={false} onChanged={vi.fn()} onReview={vi.fn()} pendingSubmissions={new Map([['api1', { submissionKey: 'original-key', expectedDraftRevision: 3, expectedStateVersion: 2, comment: '' }]])} />);
  fireEvent.click(await screen.findByRole('button', { name: '查询原提交结果' }));
  await screen.findByText(/暂未查到原提交记录/);
  expect(screen.queryByRole('button', { name: '重试原提交' })).toBeNull();
  expect(screen.queryByRole('button', { name: '提交审核' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '更多发布操作' }));
  expect(await screen.findByText('发布操作明细')).toBeTruthy();
  expect(screen.queryByRole('button', { name: '启用当前环境 API' })).toBeNull();
});

test('状态带显示生效、本次与待审修订；刷新失败不能当未发布', async () => {
  let failed = false;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('/state')) return ok({ ...state, enabled: true, pendingReleaseId: 'r1' });
    if (url.endsWith('/effective')) {
      if (failed) return Response.json({ code: 503, resultMsg: '生效信息读取失败' }, { status: 503 });
      return ok({ releaseId: 'old', snapshot: { ...definition, draftRevision: 1 } });
    }
    if (url.endsWith('/publications/r1')) return ok({ ...release, draftRevision: 2 });
    if (url.endsWith('/config')) return ok({ auditEnabled: true });
    return ok(page([]));
  }));
  render(<PublishPage api={createAdminApi('proof', vi.fn())} definition={definition} canPublish onChanged={vi.fn()} onReview={vi.fn()} pendingSubmissions={new Map()} />);
  await screen.findByText('待审核 r2');
  const band = screen.getByLabelText('当前发布状态');
  expect(band.textContent).toContain('生效r1');
  expect(band.textContent).toContain('本次r3');
  expect(band.textContent).toContain('提交后需人工审核');
  expect(screen.getByText('已有待审核的 r2，处理后才能再次提交。')).toBeTruthy();
  failed = true; fireEvent.click(screen.getByRole('button', { name: '刷新发布状态' }));
  await screen.findByText('生效信息读取失败');
  expect(band.textContent).not.toContain('尚未发布');
  expect(screen.getByRole('button', { name: '提交审核' })).toHaveProperty('disabled', true);
});

test('待审读取竞争不误标待审', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('/state')) return ok({ ...state, pendingReleaseId: 'r1' });
    if (url.endsWith('/effective')) return ok({ releaseId: 'old', snapshot: definition });
    if (url.endsWith('/publications/r1')) return ok({ ...release, status: 'REJECTED' });
    if (url.endsWith('/config')) return ok({ auditEnabled: true });
    return ok(page([]));
  }));
  render(<PublishPage api={createAdminApi('proof', vi.fn())} definition={definition} canPublish onChanged={vi.fn()} onReview={vi.fn()} pendingSubmissions={new Map()} />);
  await screen.findByText('审核状态在读取期间发生变化，请刷新后重新核对。');
  expect(screen.queryByText('待审核 r3')).toBeNull();
});

test('发布到其他环境先说明后果，取消不跳转也不发请求', async () => {
  const fetchMock = vi.fn(async (url: string) => {
    if (url.endsWith('/state')) return ok({ ...state, enabled: true });
    if (url.endsWith('/effective')) return ok({ releaseId: 'old', snapshot: { ...definition, draftRevision: 1 } });
    if (url.endsWith('/config')) return ok({ auditEnabled: true });
    return ok(page([]));
  });
  vi.stubGlobal('fetch', fetchMock);
  const onTransfer = vi.fn();
  render(<PublishPage api={createAdminApi('proof', vi.fn())} definition={definition} canPublish onChanged={vi.fn()} onReview={vi.fn()} onTransfer={onTransfer} pendingSubmissions={new Map()} />);
  await screen.findByText('已启用');
  const reads = fetchMock.mock.calls.length;
  fireEvent.click(await screen.findByRole('button', { name: '发布到其他环境' }));
  expect(await screen.findByText(/复制当前生效快照 r1，不包含之后的草稿修改/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /^取\s*消$/ }));
  expect(onTransfer).not.toHaveBeenCalled();
  expect(fetchMock.mock.calls.length).toBe(reads);
  fireEvent.click(await screen.findByRole('button', { name: '发布到其他环境' }));
  fireEvent.click(await screen.findByRole('button', { name: '继续选择目标环境' }));
  expect(onTransfer).toHaveBeenCalledWith('old');
});
