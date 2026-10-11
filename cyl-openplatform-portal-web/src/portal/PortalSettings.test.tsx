import { act, cleanup, fireEvent, render as renderRaw, screen, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { PlatformTheme } from '@cyl/open-platform-web-shared/ui/PlatformTheme';
import PortalApplications from './PortalApplications';
import { createPortalApi, type PortalSession } from './api';

// 与生产一致套用门户主题（含中文语言包、按钮不插空格）。
const render = (node: ReactElement) => renderRaw(node, { wrapper: ({ children }) => <PlatformTheme variant="portal">{children}</PlatformTheme> });
const openCard = async (name: string) => fireEvent.click(await screen.findByRole('button', { name: `查看 ${name} 详情` }));

const appKey = 'a'.repeat(32);
const application = { scopes: [], id: 'grant-1', applicationId: 'app-1', appKey, name: '仓储接入', note: '仓储接入', applicationStatus: 'ENABLED', status: 'ACTIVE', authorizationVersion: 1 };
let sequence = 0;
let session: PortalSession;
const ok = (data: unknown) => Response.json({ code: 200, data });
const page = (items: unknown[] = [application], total = items.length) => ok({ items, total, page: 1, pageSize: 20 });
const portalApi = createPortalApi('csrf', () => {});
const api: typeof portalApi = (path, options) => path === '/creation-availability' ? Promise.resolve({available:true,defaultScopeCount:1,reason:''} as never) : portalApi(path, options);
const create = async () => {
  fireEvent.click(screen.getByRole('button', { name: '生成新 AK' }));
  await waitFor(() => expect((screen.getByRole('button', {name:'生成并绑定本租户'}) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: '生成并绑定本租户' }));
};
beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  session = { tenantId: `tenant-${++sequence}`, employeeNo: 'employee', userId: 'user', displayName: '员工' };
  history.replaceState(null, '', '/portal/?section=settings');
  sessionStorage.clear();
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

test('凭据以列表展示名称、状态与可复制AK；独立条件AND查询、翻页、返回和重挂载从URL恢复', async () => {
  const fetchMock = vi.fn(async (_url: string) => page([application], 45));
  vi.stubGlobal('fetch', fetchMock);
  const clipboard = { writeText: vi.fn(async () => {}) };
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: clipboard });
  const view = render(<PortalApplications session={session} api={api} />);
  const card = (await screen.findByRole('button', { name: '查看 仓储接入 详情' })).closest('article')!;
  expect(screen.queryByLabelText('备注（可选）')).toBeNull();
  expect(screen.queryByLabelText('绑定用 AppSecret')).toBeNull();
  expect(screen.queryByRole('table')).toBeNull();
  expect(within(card).getByText('已绑定')).toBeTruthy();
  expect(within(card).queryByText(session.tenantId)).toBeNull();
  fireEvent.click(within(card).getByRole('button', { name: '复制AK' }));
  await waitFor(() => expect(clipboard.writeText).toHaveBeenCalledWith(appKey));
  expect(location.search).not.toContain('credential=');
  expect(fetchMock.mock.calls[0][0]).not.toContain('appKey=');
  fireEvent.change(screen.getByLabelText('AK（精确匹配）'), { target: { value: appKey } });
  fireEvent.change(screen.getByLabelText('用途备注（包含）'), { target: { value: '仓储' } });
  fireEvent.click(screen.getByRole('button', { name: '查询' }));
  await waitFor(() => expect(fetchMock.mock.lastCall?.[0]).toContain(`appKey=${appKey}&name=`));
  const first = location.href;
  fireEvent.click(screen.getByTitle('下一页'));
  await waitFor(() => expect(fetchMock.mock.lastCall?.[0]).toContain('page=2'));
  expect(location.search).toContain('credentialPage=2');
  await act(async () => { history.replaceState(null, '', first); window.dispatchEvent(new PopStateEvent('popstate')); });
  await waitFor(() => expect(fetchMock.mock.lastCall?.[0]).toContain('page=1'));
  view.unmount();
  render(<PortalApplications session={session} api={api} />);
  expect((screen.getByLabelText('AK（精确匹配）') as HTMLInputElement).value).toBe(appKey);
  expect((screen.getByLabelText('用途备注（包含）') as HTMLInputElement).value).toBe('仓储');
  fireEvent.click(screen.getByRole('button', { name: '重置' }));
  await waitFor(() => expect(fetchMock.mock.lastCall?.[0]).toBe('/portal-api/applications?page=1&pageSize=20&status=ACTIVE'));
  expect(location.search).toBe('?section=settings');
});

test('生成双击仅一次，Secret可复制且列表刷新不丢，关闭和卸载后清除', async () => {
  let finish: ((value: Response) => void) | undefined;
  const fetchMock = vi.fn((url: string) => url === '/portal-api/applications' ? new Promise<Response>(resolve => { finish = resolve; }) : Promise.resolve(page()));
  vi.stubGlobal('fetch', fetchMock);
  const clipboard = { writeText: vi.fn(async () => {}) };
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: clipboard });
  const view = render(<PortalApplications session={session} api={api} />);
  await screen.findByText('仓储接入');
  await create();
  fireEvent.submit(screen.getByRole('button', { name: '正在提交…' }).closest('form')!);
  expect(fetchMock.mock.calls.filter(([url]) => url === '/portal-api/applications')).toHaveLength(1);
  await act(async () => finish!(ok({ application: { appKey }, appSecret: 'one-time-secret' })));
  await screen.findByText('one-time-secret');
  expect(screen.getByText('Secret 只显示这一次，关闭后无法再次查看')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '复制 Secret' }));
  await waitFor(() => expect(clipboard.writeText).toHaveBeenCalledWith('one-time-secret'));
  expect(await screen.findByText('Secret 已复制，请粘贴到安全位置保存。')).toBeTruthy();
  expect(screen.getByRole('button', { name: '已复制 Secret' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '刷新核对列表' }));
  await screen.findByText('仓储接入');
  expect(screen.getByText('one-time-secret')).toBeTruthy();
  // 未确认已保存：Esc、关闭按钮和两个出口都不能清除 Secret。
  const secretDialog = screen.getByRole('dialog', { name: '请保存本次 Secret' });
  fireEvent(secretDialog, new Event('cancel', { cancelable: true }));
  expect(screen.getByText('one-time-secret')).toBeTruthy();
  expect((screen.getByRole('button', { name: '关闭弹窗' }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: '已保存，清除 Secret' }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: '我已保存，继续接入' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('checkbox', { name: /我已安全保存本次 Secret/ }));
  fireEvent(secretDialog, new Event('cancel', { cancelable: true }));
  expect(screen.queryByText('one-time-secret')).toBeNull();
  expect(location.href).not.toContain('one-time-secret');
  expect(sessionStorage.length).toBe(0);
  view.unmount();
  render(<PortalApplications session={session} api={api} />);
  expect(screen.queryByText('one-time-secret')).toBeNull();
});

test.each(['network', 'malformed', 'server'])('未知创建结果%s跨重挂载保护，空列表刷新不能自动解锁，必须明确承认再创建', async kind => {
  const fetchMock = vi.fn(async (url: string) => {
    if (url !== '/portal-api/applications') return page([]);
    if (kind === 'network') throw new TypeError('Failed to fetch');
    return kind === 'malformed' ? ok({ application: { appKey } }) : Response.json({ code: 50300001, resultMsg: '默认范围尚未就绪' }, { status: 503 });
  });
  vi.stubGlobal('fetch', fetchMock);
  const view = render(<PortalApplications session={session} api={api} />);
  await create();
  await screen.findByRole('heading', { name: '上次生成结果需要核对' });
  expect((screen.getByRole('button', { name: '生成新 AK' }) as HTMLButtonElement).disabled).toBe(true);
  expect(sessionStorage.length).toBe(1);
  expect(sessionStorage.key(0)).toContain(session.tenantId);
  expect(sessionStorage.getItem(sessionStorage.key(0)!)).toMatch(/^\d+$/);
  view.unmount();
  render(<PortalApplications session={session} api={api} />);
  await screen.findByText('暂无本租户凭据关联。首次接入可生成新 AK，团队已有凭据可直接绑定。');
  const acknowledge = screen.getByRole('checkbox') as HTMLInputElement;
  expect(acknowledge.disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '刷新核对列表' }));
  await waitFor(() => expect(acknowledge.disabled).toBe(false));
  expect((screen.getByRole('button', { name: '生成新 AK' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(acknowledge);
  fireEvent.click(screen.getByRole('button', { name: '确认后允许生成另一套凭据' }));
  expect((screen.getByRole('button', { name: '生成新 AK' }) as HTMLButtonElement).disabled).toBe(false);
  expect(fetchMock.mock.calls.filter(([url]) => url === '/portal-api/applications')).toHaveLength(1);
  expect(sessionStorage.length).toBe(0);
});

test('确定拒绝允许改正重试；绑定无效凭据保留AK清Secret，重绑复用同一接口', async () => {
  const expire = vi.fn();
  const calls: [string, RequestInit | undefined][] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push([url, init]);
    if (url.endsWith('/creation-availability')) return ok({available:true,defaultScopeCount:1});
    if (url === '/portal-api/applications/grant-1') return ok({...application,status:'REVOKED'});
    if (url.endsWith('/bindings')) return Response.json({ code: 40100002, resultMsg: 'AK或Secret无效' }, { status: 401 });
    if (url.endsWith('/applications')) return Response.json({ code: 40000001, resultMsg: '备注无效' }, { status: 400 });
    return page([{ ...application, status: 'REVOKED' }]);
  }));
  render(<PortalApplications session={session} api={createPortalApi('csrf', expire)} />);
  await screen.findByText('仓储接入');
  await create();
  await screen.findByText('备注无效');
  expect(sessionStorage.length).toBe(0);
  expect((screen.getByRole('button', { name: '生成并绑定本租户' }) as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  await openCard('仓储接入');
  fireEvent.click(await screen.findByRole('button', { name: '重新绑定' }));
  expect((screen.getByLabelText('绑定用 AppKey') as HTMLInputElement).value).toBe(appKey);
  const secret = screen.getByLabelText('绑定用 AppSecret') as HTMLInputElement;
  fireEvent.change(secret, { target: { value: 'bad-proof' } });
  fireEvent.click(screen.getByRole('button', { name: '校验并绑定本租户' }));
  await screen.findByText('AK或Secret无效');
  expect(secret.value).toBe('');
  expect((screen.getByLabelText('绑定用 AppKey') as HTMLInputElement).value).toBe(appKey);
  expect(expire).not.toHaveBeenCalled();
  expect(JSON.parse(String(calls.find(([url]) => url.endsWith('/bindings'))?.[1]?.body))).toEqual({ appKey, appSecret: 'bad-proof' });
});

test('关联与解绑按当前租户提示影响，取消无写请求，确认后调用关系ID', async () => {
  const fetchMock = vi.fn(async (url: string) => url === '/portal-api/applications/grant-1' ? ok(application) : page());
  vi.stubGlobal('fetch', fetchMock);
  render(<PortalApplications session={session} api={api} />);
  await openCard('仓储接入');
  fireEvent.click(await screen.findByRole('button', {name:'解绑本租户'}));
  expect(within(screen.getByRole('dialog', { name: '解除本租户关联' })).getByText(/此租户关系及其人员授权派生的已有 Token 将失效/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(fetchMock.mock.calls.some(([url]) => url.endsWith('/revoke'))).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '解绑本租户' }));
  fireEvent.click(screen.getByRole('button', { name: '确认解绑本租户' }));
  await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url === '/portal-api/bindings/grant-1/revoke')).toBe(true));
});

test('离开中止创建但保留未知标记，迟到成功不污染新租户或交付Secret', async () => {
  let finish: ((value: Response) => void) | undefined;
  let signal: AbortSignal | undefined;
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    if (url === '/portal-api/applications') { signal = init?.signal as AbortSignal; return new Promise<Response>(resolve => { finish = resolve; }); }
    return Promise.resolve(page());
  }));
  const view = render(<PortalApplications session={session} api={api} />);
  await create();
  view.unmount();
  expect(signal?.aborted).toBe(true);
  render(<PortalApplications session={{ ...session, tenantId: 'another-tenant' }} api={api} />);
  await act(async () => finish!(ok({ application: { appKey }, appSecret: 'late-secret' })));
  expect(screen.queryByText('late-secret')).toBeNull();
  expect(screen.queryByRole('heading', { name: '上次生成结果需要核对' })).toBeNull();
  expect(sessionStorage.length).toBe(1);
});


test('抽屉页签切换保留Token输入，关闭抽屉清除；过长AK不静默截断', async () => {
  const fullKey = 'a'.repeat(33);
  history.replaceState(null, '', `/portal/?section=settings&credentialKey=${fullKey}&credentialPage=999999`);
  const fetchMock = vi.fn(async (url: string) => url === '/portal-api/applications/grant-1' ? ok(application) : page());
  vi.stubGlobal('fetch', fetchMock);
  render(<PortalApplications session={session} api={api} />);
  await screen.findByText('仓储接入');
  expect(fetchMock.mock.calls[0][0]).toContain(`appKey=${fullKey}`);
  expect(fetchMock.mock.calls[0][0]).toContain('page=5001');
  await openCard('仓储接入');
  fireEvent.click(await screen.findByRole('tab',{name:'Token 与调用'}));
  await screen.findByRole('heading',{name:'准备调用身份'});
  fireEvent.click(within(screen.getByRole('radiogroup', { name: '调试凭据方式' })).getByRole('radio', { name: '使用已有 Token（推荐）' }));
  fireEvent.change(screen.getByLabelText('业务 Token'), {target:{value:'private-token'}});
  fireEvent.click(screen.getByRole('tab',{name:'调用员工'}));
  fireEvent.click(screen.getByRole('tab',{name:'Token 与调用'}));
  expect(screen.getByDisplayValue('private-token')).toBeTruthy();
  expect(location.search).toContain('credential=grant-1');
  expect(location.search).not.toContain('private-token');
  fireEvent.click(screen.getByRole('button',{name:'关闭'}));
  expect(screen.queryByDisplayValue('private-token')).toBeNull();
  expect(location.search).toContain('credentialPage=999999');
});


test('无法持久化提交状态时拒绝发送创建且不留假未知记录，绑定仍可用', async () => {
  const fetchMock = vi.fn(async (url: string) => url === '/portal-api/applications/grant-1' ? ok(application) : page());
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(Object.getPrototypeOf(sessionStorage), 'setItem').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError'); });
  const view = render(<PortalApplications session={session} api={api} />);
  await screen.findByText('仓储接入');
  await create();
  await screen.findByText('无法保存提交状态，尚未发送生成请求；请允许会话存储后重试。');
  expect(fetchMock.mock.calls.some(([url]) => url === '/portal-api/applications')).toBe(false);
  expect(sessionStorage.length).toBe(0);
  view.unmount();
  render(<PortalApplications session={session} api={api} />);
  await screen.findByText('仓储接入');
  expect(screen.queryByRole('heading', { name: '上次生成结果需要核对' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '绑定现有 AK' }));
  fireEvent.change(screen.getByLabelText('绑定用 AppKey'), { target: { value: appKey } });
  fireEvent.change(screen.getByLabelText('绑定用 AppSecret'), { target: { value: 'existing-secret' } });
  fireEvent.click(screen.getByRole('button', { name: '校验并绑定本租户' }));
  await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url === '/portal-api/bindings')).toBe(true));
});

test('已登记人员只查询本租户，姓名和工号分开过滤且不将空目录解释为人员不存在', async () => {
  const fetchMock = vi.fn(async (url: string) => url.startsWith('/portal-api/employee-profiles')
    ? ok({ items: [], total: 0, page: 1, pageSize: 20 }) : page());
  vi.stubGlobal('fetch', fetchMock);
  render(<PortalApplications session={session} api={api} />);
  fireEvent.click(screen.getByRole('button', { name: '已登记人员' }));
  await screen.findByText('未找到已登记人员，这不代表账号目录中不存在此人。');
  const dialog = screen.getByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText('姓名（包含）'), { target: { value: '示' } });
  fireEvent.change(within(dialog).getByLabelText('工号（精确）'), { target: { value: 'E1001' } });
  fireEvent.click(within(dialog).getByRole('button', { name: '查询人员' }));
  await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url.includes('name=%E7%A4%BA') && url.includes('employeeNo=E1001'))).toBe(true));
  expect(fetchMock.mock.calls.filter(([url]) => url.startsWith('/portal-api/employee-profiles')).every(([url]) => !url.includes('tenantId'))).toBe(true);
  expect(within(dialog).queryByRole('button', { name: '选择并核验' })).toBeNull();
});

test('点击卡片任意位置在抽屉打开概览，详情含状态、租户与备注入口；深链直接打开同一抽屉', async () => {
  const fetchMock = vi.fn(async (url: string) => url === '/portal-api/applications/grant-1' ? ok({ ...application, note: '', globalName: '仓储凭据' }) : page());
  vi.stubGlobal('fetch', fetchMock);
  const view = render(<PortalApplications session={{ ...session, tenantName: '华东租户' }} api={api} />);
  const card = (await screen.findByRole('button', { name: '查看 仓储接入 详情' })).closest('article')!;
  fireEvent.click(within(card).getByText('详情与操作'));
  expect(await screen.findByRole('tab', { name: '概览', selected: true })).toBeTruthy();
  expect(location.search).toContain('credential=grant-1');
  expect(location.search).toContain('accessTab=overview');
  const overview = await screen.findByRole('region', { name: '凭据概览' });
  expect(within(overview).getByText('华东租户')).toBeTruthy();
  expect(within(overview).getByText('启用')).toBeTruthy();
  expect(within(overview).getByRole('button', { name: '编辑备注' })).toBeTruthy();
  expect(within(overview).getByRole('button', { name: '解绑本租户' })).toBeTruthy();
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/portal-api/applications/grant-1', expect.anything()));
  fireEvent.click(within(overview).getByRole('button', { name: /配置调用员工/ }));
  expect(await screen.findByRole('tab', { name: '调用员工', selected: true })).toBeTruthy();
  expect(location.search).toContain('accessTab=employees');
  view.unmount();
  render(<PortalApplications session={session} api={api} />);
  expect(await screen.findByRole('tab', { name: '调用员工', selected: true })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '关闭' }));
  expect(screen.queryByRole('tab', { name: '概览' })).toBeNull();
  expect(location.search).toBe('?section=settings');
});

test('凭据列表显示已授权权限组、停用状态，展开其余权限不打开抽屉且详情可查看完整范围', async () => {
  const scoped = { ...application, scopes: [
    { code: 'orders.read', name: '订单查询', enabled: true },
    { code: 'orders.write', name: '订单维护', enabled: false },
    { code: 'inventory', name: '库存查询', enabled: true },
    { code: 'finance', name: '财务查询', enabled: true },
  ] };
  const fetchMock = vi.fn(async (url: string) => url === '/portal-api/applications/grant-1' ? ok(scoped) : page([scoped]));
  vi.stubGlobal('fetch', fetchMock);
  render(<PortalApplications session={session} api={api} />);
  const row = await screen.findByRole('listitem');
  expect(within(row).getByText('订单查询')).toBeTruthy();
  expect(within(row).getByText('orders.read')).toBeTruthy();
  expect(within(row).getByText('停用')).toBeTruthy();
  const more = within(row).getByText('另 1 个权限组');
  expect(more.closest('details')).toHaveProperty('open', false);
  fireEvent.click(more);
  expect(more.closest('details')).toHaveProperty('open', true);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(location.search).not.toContain('credential=');
  const trigger = within(row).getByRole('button', { name: '查看 仓储接入 详情' });
  trigger.focus(); fireEvent.click(trigger);
  const section = await screen.findByRole('region', { name: '凭据已授权权限组' });
  expect(within(section).getByText('财务查询')).toBeTruthy();
  expect(within(section).getByText('订单维护')).toBeTruthy();
  expect(fetchMock.mock.calls.some(([url]) => url.includes('/scopes'))).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '关闭' }));
  await waitFor(() => expect(document.activeElement).toBe(trigger));
  expect(fetchMock.mock.calls.filter(([url]) => url.startsWith('/portal-api/applications?'))).toHaveLength(1);
});
