import { lifecycleStatusNames, compatibilityNames } from '@cyl/open-platform-web-shared/lifecycle';
import { workspaceSnapshot } from '../testing/workspace';
import { AdminNavigationProvider } from '../navigation/AdminNavigation';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import CatalogPanel from './CatalogPanel';
import { createAdminApi } from '../access/api';

const ok = (data: unknown) => Response.json({ code: 200, data, requestId: 'r1' });
const definition = {
  id: 'api1',
  service: 'orders',
  version: 'v1',
  method: 'query',
  name: '查询订单',
  category: '订单',
  owner: 'EMP_00000000000000000000000000000001',
  protocol: 'HTTP',
  draftRevision: 1,
  scopeCodes: ['orders'],
  requestSchema: { type: 'OBJECT', properties: {} },
  responseSchema: { type: 'OBJECT', properties: {} },
  errorDefinitions: [],
  binding: {
    protocol: 'HTTP',
    timeoutMillis: 3000,
    http: { url: 'http://orders.internal/query', method: 'POST' },
  },
  mappings: [],
};
const page = (items: unknown[]) => ok({ items, total: items.length, page: 1, pageSize: 20 });
function defaults(url: string) {
  if(url.includes('/apis/owners/'))return ok({id:definition.owner,displayName:'研发',employeeNo:'E1001',employeeId:'person',tenantId:'101'});
  if (url.endsWith('/apis/api1/workspace')) return ok(workspaceSnapshot(definition));
  if (url.endsWith('/apis/api1')) return ok(definition);
  if (url.includes('/categories?')) return page(['订单']);
  if (url.includes('/environment-releases')) return url.endsWith('/targets') ? ok([]) : page([]);
  if (url.includes('/scopes?'))
    return page([{ id: 's1', code: 'orders', name: '订单权限', enabled: true }]);
  return page([definition]);
}
function mount(
  handler?: (url: string, init?: RequestInit) => Response | Promise<Response> | undefined,
  route = '/#/apis/api1/config',
) {
  const fetchMock = vi.fn(
    async (url: string, init?: RequestInit) => (await handler?.(url, init)) ?? defaults(url),
  );
  vi.stubGlobal('fetch', fetchMock);
  window.history.replaceState({}, '', route);
  render(
    <CatalogPanel
      api={createAdminApi('proof', vi.fn())}
      permissions={['MANAGE_APIS', 'PUBLISH_APIS']}
    />,
    { wrapper: AdminNavigationProvider },
  );
  return fetchMock;
}
const echoJson = (init?: RequestInit) =>
  new Response(`{"code":200,"data":${String(init?.body)}}`, { headers: { 'Content-Type': 'application/json' } });
const editorReady = () => screen.findByLabelText('接口名称', {}, { timeout: 5000 });
/** 通用配置与可选MCP分开，调试、发布和版本继续共用同一工作草稿。 */
const tabs: Record<string, string> = { 配置: '配置', 测试: '调试', 调试: '调试', 发布: '发布', 版本记录: '版本与生命周期', 版本与生命周期: '版本与生命周期' };
const step = (name: string) => fireEvent.click(screen.getByRole('tab', { name: new RegExp(`^${tabs[name]}`) }));
const saveButton = () => screen.getByRole('button', { name: /保存为修订/ });
const save = () => fireEvent.click(saveButton());
const puts = (calls: ReturnType<typeof mount>) => calls.mock.calls.filter(([, init]) => init?.method === 'PUT');
const back = () => fireEvent.click(screen.getByRole('link', { name: '返回 API 列表' }));
const more = async (item: string) => {
  fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: item }));
};
const openJson = async () => {
  await more('以 JSON 编辑整份配置');
  return (await screen.findByLabelText('整份配置 JSON')) as HTMLTextAreaElement;
};
const applyJson = () => fireEvent.click(screen.getByRole('button', { name: '校验并应用到页面' }));
// 用例挂载完整 API 工作区（编辑器、字段表、检查面板），整轮并行时单例常接近 5 秒。
vi.setConfig({ testTimeout: 15000 });
afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
  window.history.replaceState({}, '', '/#/apis');
  vi.unstubAllGlobals();
});

test('保存为修订携带原修订、接口说明和CSRF，冲突时提供三种处理且保留输入、不发布', async () => {
  const calls = mount((_url, init) =>
    init?.method === 'PUT'
      ? Response.json({ code: 40900001, resultMsg: '草稿已变化，请重新加载', requestId: 'r2' }, { status: 409 })
      : undefined,
  );
  fireEvent.change(await editorReady(), { target: { value: '查询订单新版' } });
  expect((screen.getByRole('checkbox', { name: '必须指定调用员工' }) as HTMLInputElement).checked).toBe(false);
  fireEvent.click(screen.getByRole('checkbox', { name: '必须指定调用员工' }));
  fireEvent.change(screen.getByLabelText('接口说明'), { target: { value: '根据订单号查询当前租户可访问的订单。' } });
  save();
  expect(await screen.findByText('草稿已被他人更新')).toBeTruthy();
  for (const name of ['查看对方修改', '以我的修改覆盖', '放弃我的修改'])
    expect(screen.getByRole('button', { name: new RegExp(name) })).toBeTruthy();
  expect((screen.getByLabelText('接口说明') as HTMLTextAreaElement).value).toContain('当前租户');
  const submitted = puts(calls)[0][1]!;
  expect(JSON.parse(String(submitted.body))).toMatchObject({
    expectedRevision: 1,
    name: '查询订单新版',
    employeeRequired: true,
    description: '根据订单号查询当前租户可访问的订单。',
  });
  expect(new Headers(submitted.headers).get('X-CSRF-Token')).toBe('proof');
  expect(calls.mock.calls.some(([url]) => url.includes('publish'))).toBe(false);
});

test('冲突后查看对方修订，再以我的修改覆盖：以对方修订为基线保存', async () => {
  let conflict = true;
  const calls = mount((url, init) => {
    if (init?.method === 'PUT') {
      if (conflict) return Response.json({ code: 40900001, resultMsg: '修订冲突' }, { status: 409 });
      return ok({ ...definition, ...JSON.parse(String(init.body)), draftRevision: 4 });
    }
    if (url.endsWith('/apis/api1')) return ok({ ...definition, name: '对方的名称', draftRevision: 3 });
  });
  fireEvent.change(await editorReady(), { target: { value: '我的编辑' } });
  save();
  await screen.findByText('草稿已被他人更新');
  fireEvent.click(screen.getByRole('button', { name: /查看对方修改/ }));
  expect(await screen.findByText(/在 基本信息 上不同/)).toBeTruthy();
  conflict = false;
  fireEvent.click(screen.getByRole('button', { name: /以我的修改覆盖/ }));
  await waitFor(() => expect(puts(calls)).toHaveLength(2));
  expect(JSON.parse(String(puts(calls)[1][1]!.body))).toMatchObject({ expectedRevision: 3, name: '我的编辑' });
  await waitFor(() => expect(screen.getAllByText(/r4/).length).toBeGreaterThan(0));
  expect(screen.getByLabelText('接口名称')).toHaveProperty('value', '我的编辑');
});

test('冲突后放弃我的修改采用服务器最新；页头重新加载必须确认，取消保留本地内容', async () => {
  let latest = definition;
  mount((url, init) => {
    if (init?.method === 'PUT') {
      latest = { ...definition, name: '服务器新名称', draftRevision: 2 };
      return Response.json({ code: 40900001, resultMsg: '草稿已变化' }, { status: 409 });
    }
    if (url.endsWith('/apis/api1/workspace')) return ok(workspaceSnapshot(latest));
  });
  fireEvent.change(await editorReady(), { target: { value: '我的本地编辑' } });
  await more('重新加载最新草稿');
  expect(await screen.findByText(/将丢弃 1 处未保存修改/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /取\s*消/ }));
  expect((screen.getByLabelText('接口名称') as HTMLInputElement).value).toBe('我的本地编辑');
  save();
  await screen.findByText('草稿已被他人更新');
  fireEvent.click(screen.getByRole('button', { name: /放弃我的修改/ }));
  await waitFor(() => expect((screen.getByLabelText('接口名称') as HTMLInputElement).value).toBe('服务器新名称'));
});

test('整份 JSON 由服务端严格解析：重复键被拒绝且页面不变；文档预览只读当前公开输入', async () => {
  const calls = mount((url, init) => {
    if (url.includes('/validate-json') && String(init?.body).includes('"duplicate":2'))
      return Response.json({ code: 40000001, resultMsg: '重复字段不合法' }, { status: 400 });
    if (url.includes('/validate-json')) return echoJson(init);
    if (url.endsWith('/preview')) return ok({});
  });
  await editorReady();
  const input = await openJson();
  expect(input.value).toContain('"service": "orders"');
  fireEvent.change(input, { target: { value: input.value.replace('"mappings": []', '"mappings": [{"source":"FIXED","target":"query","value":{"duplicate":1,"duplicate":2}}]') } });
  applyJson();
  expect(await screen.findByText('重复字段不合法')).toBeTruthy();
  expect(screen.getByLabelText('整份配置 JSON')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /取\s*消/ }));
  expect(screen.queryByLabelText('固定 JSON 值')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /预览草稿文档/ }));
  expect(await screen.findByText('草稿文档预览 · 未生效')).toBeTruthy();
  expect(screen.getByText(/当前输入预览（含未保存修改/)).toBeTruthy();
  expect(calls.mock.calls.some(([url]) => url.endsWith('/preview'))).toBe(false);
  expect(puts(calls)).toHaveLength(0);
});

test('整份 JSON 不能修改锁定的调用标识；其余字段拆回各分区并随保存提交', async () => {
  const calls = mount((url, init) => {
    if (url.includes('/validate-json')) return echoJson(init);
    if (init?.method === 'PUT') return ok({ ...definition, ...JSON.parse(String(init.body)), draftRevision: 2, changed: true });
  });
  await editorReady();
  let input = await openJson();
  fireEvent.change(input, { target: { value: input.value.replace('"service": "orders"', '"service": "other"') } });
  applyJson();
  expect(await screen.findByText('service 已锁定，不能在 JSON 中修改。')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /取\s*消/ }));
  input = await openJson();
  fireEvent.change(input, { target: { value: input.value.replace('"name": "查询订单"', '"name": "JSON 改名"').replace('"description": ""', '"description": "来自 JSON"') } });
  applyJson();
  await waitFor(() => expect(screen.getByLabelText('接口名称')).toHaveProperty('value', 'JSON 改名'));
  expect(screen.getByLabelText('接口说明')).toHaveProperty('value', '来自 JSON');
  save();
  await waitFor(() => expect(puts(calls)).toHaveLength(1));
  expect(JSON.parse(String(puts(calls)[0][1]!.body))).toMatchObject({ service: 'orders', name: 'JSON 改名', description: '来自 JSON' });
}, 15000);

test('保存期间禁用树表和权限组，成功返回使用新修订', async () => {
  let finish: ((response: Response) => void) | undefined;
  mount((_url, init) =>
    init?.method === 'PUT' ? new Promise<Response>((resolve) => { finish = resolve; }) : undefined,
  );
  await editorReady();
  save();
  await waitFor(() => expect(screen.getByLabelText('请求结构说明').matches(':disabled')).toBe(true));
  expect(screen.getByRole('button', { name: '选择权限组…' }).matches(':disabled')).toBe(true);
  expect(screen.getByLabelText('内部请求地址').matches(':disabled')).toBe(true);
  finish!(ok({ ...definition, draftRevision: 2, changed: true }));
  await waitFor(() => expect(screen.getByLabelText('请求结构说明').matches(':disabled')).toBe(false));
  expect(screen.getAllByText(/已保存为修订 r2/).length).toBeGreaterThan(0);
  expect(screen.getByRole('button', { name: /保存为修订 r3/ })).toBeTruthy();
});

test('无变化保存保留修订，可重复保存，返回列表无需确认', async () => {
  const calls = mount((_url, init) => (init?.method === 'PUT' ? ok({ ...definition, changed: false }) : undefined));
  await editorReady();
  save();
  expect(await screen.findByText('内容未变化，仍为 r1')).toBeTruthy();
  await waitFor(() => expect(saveButton().classList.contains('ant-btn-loading')).toBe(false), { timeout: 5000 });
  save();
  await waitFor(() => expect(puts(calls)).toHaveLength(2));
  for (const [, init] of puts(calls)) expect(JSON.parse(String(init?.body)).expectedRevision).toBe(1);
  back();
  await waitFor(() => expect(window.location.hash).toBe('#/apis'));
  expect(screen.queryByRole('alertdialog')).toBeNull();
});

test('高精度JSON经树表、整份 JSON 及保存往返不会舍入', async () => {
  const precise =
    '{"type":"OBJECT","properties":{"amount":{"type":"NUMBER","defaultValue":1234567890.1234567890123456789},"sequence":{"type":"INTEGER","example":9007199254740993}}}';
  const rawDefinition = JSON.stringify(definition).replace('"requestSchema":{"type":"OBJECT","properties":{}}', `"requestSchema":${precise}`);
  const calls = mount((url, init) =>
    url.includes('/validate-json')
      ? echoJson(init)
      : init?.method === 'PUT' || url.endsWith('/apis/api1/workspace')
        ? new Response(
            `{"code":200,"data":${url.endsWith('/workspace') ? JSON.stringify(workspaceSnapshot(definition)).replace(JSON.stringify(definition), rawDefinition) : rawDefinition}}`,
            { headers: { 'Content-Type': 'application/json' } },
          )
        : undefined,
  );
  await editorReady();
  const input = await openJson();
  expect(input.value).toContain('1234567890.1234567890123456789');
  expect(input.value).toContain('9007199254740993');
  fireEvent.change(input, { target: { value: input.value.replace('"mappings": []', '"mappings": [{"source":"FIXED","target":"amount","value":0.123456789012345678901}]') } });
  applyJson();
  await waitFor(() => expect(screen.queryByLabelText('整份配置 JSON')).toBeNull(), { timeout: 3000 }).catch((failure) => {
    throw new Error(`${failure.message}\n${document.body.textContent}`);
  });
  save();
  await waitFor(() => expect(puts(calls)).toHaveLength(1));
  const body = String(puts(calls)[0][1]!.body);
  for (const number of ['1234567890.1234567890123456789', '9007199254740993', '0.123456789012345678901']) expect(body).toContain(number);
});

test('维护声明随保存提交，独立于启停和发布', async () => {
  const calls = mount((_url, init) => (init?.method === 'PUT' ? ok({ ...definition, draftRevision: 2 }) : undefined));
  await editorReady();
  // 112b：维护声明在“版本与生命周期”页签编辑，仍随同一份草稿保存。
  step('版本与生命周期');
  fireEvent.click(await screen.findByRole('button', { name: '编辑维护声明' }));
  fireEvent.click(screen.getByText(lifecycleStatusNames.DEPRECATED));
  fireEvent.click(screen.getByText(/兼容性声明（可选）/));
  fireEvent.mouseDown(screen.getByLabelText('兼容性声明'));
  fireEvent.click(await screen.findByText(compatibilityNames.BREAKING, { selector: '.ant-select-item-option-content' }));
  for (const [label, value] of [
    ['兼容性说明', '替代版本调整响应结构'],
    ['废弃说明', '请迁移到 v2'],
    ['替代外部版本', 'v2'],
    ['计划退出日期', '2027-12-31'],
  ])
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: '保存维护声明' }));
  await waitFor(() => expect(puts(calls)).toHaveLength(1));
  expect(JSON.parse(String(puts(calls)[0][1]!.body)).lifecycle).toEqual({
    status: 'DEPRECATED',
    compatibility: 'BREAKING',
    compatibilityNotes: '替代版本调整响应结构',
    deprecationNotice: '请迁移到 v2',
    replacementVersion: 'v2',
    sunsetDate: '2027-12-31',
  });
});

test('页签切换保留同一内存模型，使用旧配置调试不会丢修改，返回取消不重载', async () => {
  const calls = mount();
  fireEvent.change(await editorReady(), { target: { value: '未保存名称' } });
  step('调试');
  fireEvent.click(screen.getByRole('button', { name: '使用已保存配置进入测试' }));
  expect(await screen.findByRole('region', { name: 'API 测试工作区' })).toBeTruthy();
  expect(calls.mock.calls.some(([url]) => url.endsWith('/debug'))).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'JSON' }));
  fireEvent.change(screen.getByLabelText('调试请求 JSON'), { target: { value: '{"businessNote":"仅内存","secret":"同API保留"}' } });
  step('配置');
  expect((screen.getByLabelText('接口名称') as HTMLInputElement).value).toBe('未保存名称');
  const count = calls.mock.calls.length;
  back();
  fireEvent.click(within(await screen.findByRole('dialog', { name: '离开前处理未保存更改' })).getByRole('button', { name: '取消' }));
  expect(calls.mock.calls).toHaveLength(count);
  expect(decodeURIComponent(window.location.hash)).not.toContain('未保存名称');
  step('调试');
  fireEvent.click(screen.getByRole('button', { name: '使用已保存配置进入测试' }));
  expect((screen.getByLabelText('调试请求 JSON') as HTMLTextAreaElement).value).toContain('仅内存');
  expect((screen.getByLabelText('调试请求 JSON') as HTMLTextAreaElement).value).toContain('同API保留');
});

test('仅发布旧配置后启停刷新不卸载草稿，未保存输入仍可返回编辑', async () => {
  let enabled = true;
  const state = () => ({ apiId: 'api1', stateVersion: 1, enabled, liveReleaseId: 'live1', pendingReleaseId: null });
  const calls = mount((url, init) => {
    if (init?.method === 'PUT' && url.endsWith('/status')) {
      enabled = false;
      return ok(state());
    }
    if (url.endsWith('/workspace')) return ok({ ...workspaceSnapshot(definition), publication: state(), liveDraftRevision: 1 });
    if (url.endsWith('/state')) return ok(state());
    if (url.endsWith('/effective')) return ok({ ...state(), releaseId: 'live1', appliedAt: '', snapshot: definition });
    if (url.includes('/audit?')) return page([]);
    if (url.includes('/revisions/1')) return ok({ revision: 1, snapshot: definition });
  });
  fireEvent.change(await editorReady(), { target: { value: '仍需保留的本地名称' } });
  step('发布');
  fireEvent.click(screen.getByRole('button', { name: '仅发布上次保存配置' }));
  await screen.findByText('已启用');
  fireEvent.click(await screen.findByRole('button', { name: '停用当前环境 API' }));
  fireEvent.change(await screen.findByLabelText('启停原因'), { target: { value: '暂停本次调用' } });
  fireEvent.click(screen.getByRole('button', { name: '确认停用' }));
  await screen.findByText(/当前环境 API 已停用/, {}, { timeout: 5000 });
  step('配置');
  expect((screen.getByLabelText('接口名称') as HTMLInputElement).value).toBe('仍需保留的本地名称');
  expect(calls.mock.calls.filter(([url]) => url.endsWith('/apis/api1/workspace'))).toHaveLength(2);
  expect(within(screen.getByLabelText('发布状态')).getByText(/已停用/)).toBeTruthy();
});

test('未确认响应候选跨页签保留且受离开保护，保存不会静默丢弃候选', async () => {
  const calls = mount((url, init) => (url.includes('/validate-json') ? echoJson(init) : undefined));
  await editorReady();
  fireEvent.click(screen.getByRole('button', { name: '编辑 / 脱敏公开示例…' }));
  fireEvent.change(await screen.findByLabelText('公开业务 data（JSON）'), { target: { value: '{"draftOnly":"keep"}' } });
  back();
  fireEvent.click(within(await screen.findByRole('dialog', { name: '离开前处理未保存更改' })).getByRole('button', { name: '取消' }));
  save();
  expect((await screen.findByRole('alert')).textContent).toContain('还有未确认的公开示例');
  expect(puts(calls)).toHaveLength(0);
  expect((screen.getByLabelText('公开业务 data（JSON）') as HTMLTextAreaElement).value).toContain('keep');
  expect(screen.getByRole('button', { name: /响应处理，有未保存修改/ })).toBeTruthy();
});

test('协议替换展示前后绑定和映射影响，取消保留真实地址', async () => {
  mount();
  await editorReady();
  fireEvent.mouseDown(screen.getByLabelText('服务协议'));
  fireEvent.click(await screen.findByText('DUBBO', { selector: '.ant-select-item-option-content' }));
  const dialog = await screen.findByRole('dialog');
  await waitFor(() => expect(dialog.textContent).toContain('现有 0 条参数映射'));
  expect(dialog.textContent).toContain('http://orders.internal/query');
  fireEvent.click(within(dialog).getByRole('button', { name: /取\s*消/ }));
  expect((screen.getByLabelText('内部请求地址') as HTMLInputElement).value).toBe('http://orders.internal/query');
});

test('已有Dubbo手工签名与整份JSON签名共用确认基线，取消不应用且保存不能绕过', async () => {
  const dubbo = {
    ...definition,
    protocol: 'DUBBO',
    requestSchema: { type: 'OBJECT', properties: { orderId: { type: 'STRING' } } },
    binding: {
      protocol: 'DUBBO',
      timeoutMillis: 3000,
      dubbo: { interfaceName: 'example.OrderService', method: 'query', version: '', group: '', parameterTypes: ['java.lang.String'], connectionId: 'conn1', connectionRevision: 1 },
    },
    mappings: [{ target: 'arg0', source: 'REQUEST', path: 'orderId' }],
  };
  let revision = 1;
  const calls = mount((url, init) => {
    if (url.includes('/validate-json')) return echoJson(init);
    if (init?.method === 'PUT') return ok({ ...dubbo, ...JSON.parse(String(init.body)), draftRevision: ++revision });
    if (url.endsWith('/apis/api1/workspace')) return ok(workspaceSnapshot(dubbo));
    if (url.includes('/dubbo-connections')) return page([]);
  });
  await editorReady();
  fireEvent.change(screen.getByLabelText('内部方法'), { target: { value: 'delete' } });
  save();
  expect((await screen.findByRole('alert')).textContent).toContain('手工签名尚未应用');
  expect(puts(calls)).toHaveLength(0);
  expect(within(screen.getByRole('complementary', { name: '检查' })).getByText('手工签名尚未应用')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '应用手工签名…' }));
  let dialog = await screen.findByRole('dialog');
  await waitFor(() => expect(dialog.textContent).toContain('现有 1 条参数映射'));
  expect(dialog.textContent).toContain('"query"');
  expect(dialog.textContent).toContain('"delete"');
  fireEvent.click(within(dialog).getByRole('button', { name: /取\s*消/ }));
  expect(screen.getByText(/当前已应用方法仍为 query/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '应用手工签名…' }));
  fireEvent.click(await screen.findByRole('button', { name: '确认替换并检查映射' }));
  await waitFor(() => expect(within(screen.getByRole('complementary', { name: '检查' })).queryByText('手工签名尚未应用')).toBeNull());
  save();
  await waitFor(() => expect(puts(calls)).toHaveLength(1));
  await waitFor(() => expect(screen.getAllByText(/已保存为修订 r2/).length).toBeGreaterThan(0));
  let input = await openJson();
  fireEvent.change(input, { target: { value: input.value.replace('"method": "delete"', '"method": "refund"') } });
  applyJson();
  dialog = (await screen.findByText('确认替换内部绑定')).closest('[role="dialog"]') as HTMLElement;
  expect(dialog.textContent).toContain('"refund"');
  fireEvent.keyDown(window, { key: 's', metaKey: true });
  expect(puts(calls)).toHaveLength(1);
  fireEvent.click(within(dialog).getByRole('button', { name: /取\s*消/ }));
  save();
  await waitFor(() => expect(puts(calls)).toHaveLength(2));
  expect(JSON.parse(String(puts(calls)[1][1]!.body)).binding.dubbo.method).toBe('delete');
  input = await openJson();
  fireEvent.change(input, { target: { value: input.value.replace('"method": "delete"', '"method": "refund"') } });
  applyJson();
  fireEvent.click(await screen.findByRole('button', { name: '确认替换并检查映射' }));
  save();
  await waitFor(() => expect(puts(calls)).toHaveLength(3));
  const submitted = JSON.parse(String(puts(calls)[2][1]!.body));
  expect(submitted.binding.dubbo.method).toBe('refund');
  expect(submitted.mappings).toEqual(dubbo.mappings);
}, 60000);

test('结构说明写入根节点说明并随保存提交', async () => {
  const calls = mount((_url, init) => (init?.method === 'PUT' ? ok({ ...definition, draftRevision: 2 }) : undefined));
  await editorReady();
  fireEvent.change(screen.getByLabelText('请求结构说明'), { target: { value: '传入订单号' } });
  save();
  await waitFor(() => expect(puts(calls)).toHaveLength(1));
  expect(JSON.parse(String(puts(calls)[0][1]!.body)).requestSchema.description).toBe('传入订单号');
});

test('分类展开与字段值设置取消不改草稿，返回列表无需未保存确认', async () => {
  mount((url) => (url.endsWith('/apis/api1/workspace') ? ok(workspaceSnapshot({ ...definition, requestSchema: { type: 'OBJECT', properties: { orderId: { type: 'STRING' } } } })) : undefined));
  await editorReady();
  fireEvent.focus(screen.getByLabelText('展示分类'));
  fireEvent.keyDown(screen.getByLabelText('展示分类'), { key: 'Escape' });
  fireEvent.click(screen.getByRole('button', { name: 'orderId 值设置' }));
  const values = screen.getByRole('region', { name: 'orderId · 值设置' });
  fireEvent.change(within(values).getByLabelText('默认值'), { target: { value: '{"notApplied":true}' } });
  fireEvent.click(within(values).getByRole('button', { name: /取\s*消/ }));
  expect(screen.queryByRole('region', { name: 'orderId · 值设置' })).toBeNull();
  back();
  await waitFor(() => expect(window.location.hash).toBe('#/apis'));
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('未应用的固定JSON值仍受离开保护，取消保持原文', async () => {
  mount((url) => (url.endsWith('/apis/api1/workspace') ? ok(workspaceSnapshot({ ...definition, mappings: [{ source: 'FIXED', target: 'amount', value: 1 }] })) : undefined));
  await editorReady();
  fireEvent.change(screen.getByLabelText('固定 JSON 值'), { target: { value: '0.1234567890123456789' } });
  await more('重新加载最新草稿');
  expect(await screen.findByText(/将丢弃 1 处未保存修改及未应用输入/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /取\s*消/ }));
  back();
  const dialog = await screen.findByRole('dialog', { name: '离开前处理未保存更改' });
  fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
  expect(screen.getByLabelText('固定 JSON 值')).toHaveProperty('value', '0.1234567890123456789');
  expect(window.location.hash).toContain('/apis/api1/');
});

test('已保存调用标识显示为文字加锁并说明原因，名称和内部地址仍可编辑', async () => {
  mount();
  await editorReady();
  for (const [name, value] of [['service', 'orders'], ['method', 'query'], ['外部版本', 'v1']]) {
    const field = screen.getByRole('group', { name });
    expect(field.textContent).toContain(value);
    expect(within(field).queryByRole('textbox')).toBeNull();
    expect(within(field).getByLabelText(/不可修改：.*请新建 API/)).toBeTruthy();
  }
  expect(screen.getByLabelText('接口名称')).toHaveProperty('readOnly', false);
  expect(within(screen.getByRole('region', { name: '调用地址' })).getByText('POST /api/oauth/orders/v1/query')).toBeTruthy();
  expect(screen.getByDisplayValue('http://orders.internal/query')).toHaveProperty('readOnly', false);
});

test('旧地址的返回与文档定位到响应处理；只改返回规则后离页保存采用最新规则', async () => {
  let saved: Record<string, unknown> | undefined;
  mount((url, init) => {
    if (url.endsWith('/apis/api1') && init?.method === 'PUT') {
      saved = JSON.parse(init.body as string);
      return ok({ ...definition, ...saved, draftRevision: 2 });
    }
  }, '/#/catalog?api=api1&step=doc');
  await editorReady();
  await waitFor(() => expect(window.location.hash).toBe('#/apis/api1/config'));
  await screen.findByRole('heading', { name: '先确定从返回中取什么' });
  fireEvent.click(screen.getByRole('radio', { name: /从 Response 提取/ }));
  back();
  fireEvent.click(await screen.findByRole('button', { name: '保存后继续' }));
  await waitFor(() => expect(saved?.responseAdapter).toEqual({ mode: 'ENVELOPE', successPath: 'errCode', successValues: ['0'], dataPath: 'data', messagePath: 'errMessage' }));
});

test('未保存内容只读校验，错误进入检查面板与目录计数并定位提供方字段，修改后旧结果立即失效', async () => {
  const calls = mount((url, init) =>
    url.endsWith('/validate') && init?.method === 'POST'
      ? ok({ valid: false, checkedDraftRevision: 1, truncated: false, fieldIssues: [{ path: '/binding/http/url', reason: 'INVALID_VALUE', message: 'HTTP地址不合法' }] })
      : undefined,
  );
  fireEvent.change(await editorReady(), { target: { value: '仅本地输入' } });
  expect(screen.getByText('暂无待修正')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '校 验' }));
  await screen.findByText('1 项待修正');
  expect(screen.getByRole('button', { name: '调用目标与映射，1处错误' })).toBeTruthy();
  await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('内部请求地址')));
  const check = calls.mock.calls.find(([url]) => url.endsWith('/validate'))!;
  expect(JSON.parse(String(check[1]?.body)).name).toBe('仅本地输入');
  expect(puts(calls)).toHaveLength(0);
  fireEvent.change(screen.getByLabelText('内部请求地址'), { target: { value: 'https://correct.example/api' } });
  expect(screen.queryByText('1 项待修正')).toBeNull();
  expect(screen.getByLabelText('接口名称')).toHaveProperty('value', '仅本地输入');
});

test('检查面板的待修正项点击后定位字段', async () => {
  mount((url, init) =>
    url.endsWith('/validate') && init?.method === 'POST'
      ? ok({ valid: false, checkedDraftRevision: 1, truncated: false, fieldIssues: [{ path: '/name', reason: 'REQUIRED', message: '名称必填' }] })
      : undefined,
  );
  await editorReady();
  fireEvent.click(screen.getByRole('button', { name: '校 验' }));
  const item = await within(screen.getByRole('complementary', { name: '检查' })).findByRole('button', { name: /名称必填/ });
  (document.activeElement as HTMLElement | null)?.blur();
  fireEvent.click(item);
  await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('接口名称')));
});

test('刷新工作区发布状态保留本地输入，落后的校验响应不能覆盖新内容', async () => {
  let latest = definition;
  let resolveValidation: (response: Response) => void = () => {};
  mount((url) => {
    if (url.endsWith('/workspace')) return ok(workspaceSnapshot(latest));
    if (url.endsWith('/validate')) return new Promise<Response>((resolve) => { resolveValidation = resolve; });
  });
  fireEvent.change(await editorReady(), { target: { value: '我的未保存名称' } });
  fireEvent.click(screen.getByRole('button', { name: '校 验' }));
  fireEvent.change(screen.getByLabelText('接口名称'), { target: { value: '再次修改' } });
  resolveValidation(ok({ valid: true, fieldIssues: [], truncated: false, checkedDraftRevision: 1 }));
  latest = { ...definition, draftRevision: 2, name: '其他人的更新' };
  fireEvent.click(screen.getByRole('button', { name: '刷新状态' }));
  await screen.findByText('服务器草稿 r2 · 本地输入保留');
  expect(screen.getByLabelText('接口名称')).toHaveProperty('value', '再次修改');
  expect(screen.queryByText('校验通过')).toBeNull();
});

test('状态刷新失败后重试仍保留未保存输入，不走整页重新加载', async () => {
  let reads = 0;
  mount((url) => {
    if (!url.endsWith('/workspace')) return undefined;
    reads++;
    return reads === 2 ? Response.json({ code: 50300001, resultMsg: '状态暂不可用' }, { status: 503 }) : ok(workspaceSnapshot(definition));
  });
  fireEvent.change(await editorReady(), { target: { value: '重试也不能丢失' } });
  fireEvent.click(screen.getByRole('button', { name: '刷新状态' }));
  await screen.findByText(/状态暂不可用/);
  fireEvent.click(screen.getByRole('button', { name: '重新加载' }));
  await waitFor(() => expect(reads).toBe(3));
  expect(screen.getByLabelText('接口名称')).toHaveProperty('value', '重试也不能丢失');
});

test('固定JSON未应用时校验、整份JSON与离页保存都阻断，且旧通过结果立即失效', async () => {
  const calls = mount((url) =>
    url.endsWith('/workspace')
      ? ok(workspaceSnapshot({ ...definition, mappings: [{ source: 'FIXED', target: 'amount', value: 1 }] }))
      : url.endsWith('/validate')
        ? ok({ valid: true, fieldIssues: [], truncated: false, checkedDraftRevision: 1 })
        : undefined,
  );
  await editorReady();
  fireEvent.click(screen.getByRole('button', { name: '校 验' }));
  await screen.findByText('校验通过');
  fireEvent.change(screen.getByLabelText('固定 JSON 值'), { target: { value: '{"new":2}' } });
  expect(screen.queryByText('校验通过')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '校 验' }));
  await waitFor(() => expect(screen.getAllByRole('alert').some((item) => item.textContent?.includes('请校验并应用固定值'))).toBe(true));
  save();
  await more('以 JSON 编辑整份配置');
  expect(screen.queryByLabelText('整份配置 JSON')).toBeNull();
  expect(calls.mock.calls.filter(([url]) => url.endsWith('/validate'))).toHaveLength(1);
  expect(puts(calls)).toHaveLength(0);
  back();
  fireEvent.click(await screen.findByRole('button', { name: '保存后继续' }));
  expect(puts(calls)).toHaveLength(0);
  expect(screen.getByLabelText('固定 JSON 值')).toHaveProperty('value', '{"new":2}');
  expect(window.location.hash).toContain('/apis/api1/');
});

test('结构示例错误打开对应行的值编辑，映射问题定位实际行字段', async () => {
  let issue = { path: '/requestSchema/properties/order/properties/id/example', reason: 'INVALID_VALUE', message: '示例类型不匹配' };
  mount((url) =>
    url.endsWith('/workspace')
      ? ok(workspaceSnapshot({
          ...definition,
          requestSchema: { type: 'OBJECT', properties: { order: { type: 'OBJECT', properties: { id: { type: 'STRING', example: 42 } } } } },
          mappings: [{ target: 'first', source: 'REQUEST', path: 'orderId' }, { target: 'second', source: 'REQUEST', path: '' }],
        }))
      : url.endsWith('/validate')
        ? ok({ valid: false, fieldIssues: [issue], truncated: false, checkedDraftRevision: 1 })
        : undefined,
  );
  await editorReady();
  fireEvent.click(screen.getAllByRole('button', { name: '折叠全部' })[0]);
  fireEvent.click(screen.getByRole('button', { name: '校 验' }));
  const values = await screen.findByRole('region', { name: 'order.id · 值设置' }, { timeout: 5000 });
  await waitFor(() => expect(document.activeElement).toBe(within(values).getByLabelText('示例')));
  fireEvent.click(within(values).getByRole('button', { name: /取\s*消/ }));
  issue = { path: '/mappings/1/path', reason: 'INVALID_VALUE', message: '请选择来源字段' };
  fireEvent.click(screen.getByRole('button', { name: '校 验' }));
  await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('映射2字段')));
});

test('删除前面的映射保留后行未应用固定JSON', async () => {
  mount((url) =>
    url.endsWith('/workspace')
      ? ok(workspaceSnapshot({ ...definition, mappings: [{ target: 'first', source: 'FIXED', value: 1 }, { target: 'second', source: 'FIXED', value: 1 }] }))
      : undefined,
  );
  await editorReady();
  fireEvent.change(screen.getAllByLabelText('固定 JSON 值')[1], { target: { value: '0.1234567890123456789' } });
  const first = screen.getByLabelText('映射1目标').closest('tr')!;
  fireEvent.click(within(first).getByRole('button', { name: '移除' }));
  expect(screen.getByLabelText('固定 JSON 值')).toHaveProperty('value', '0.1234567890123456789');
  expect(screen.getByText('尚未应用，先校验后才能保存草稿。')).toBeTruthy();
});

test('超大修订号刷新后不会因对象引用变化误报服务器草稿变化', async () => {
  const raw = JSON.stringify(workspaceSnapshot(definition)).replaceAll('"draftRevision":1', '"draftRevision":9007199254740993');
  let reads = 0;
  mount((url) => (url.endsWith('/workspace') ? (reads++, new Response(`{"code":200,"data":${raw}}`, { headers: { 'Content-Type': 'application/json' } })) : undefined));
  await editorReady();
  fireEvent.click(await screen.findByRole('button', { name: '刷新状态' }));
  await waitFor(() => expect(reads).toBe(2));
  await waitFor(() => expect(screen.getByRole('button', { name: '刷新状态' }).classList.contains('ant-btn-loading')).toBe(false), { timeout: 5000 });
  expect(screen.queryByText(/服务器草稿 r/)).toBeNull();
  expect(screen.getByRole('button', { name: /保存为修订 r9007199254740994/ })).toBeTruthy();
});

test('保存期间自定义来源选择器随表单禁用，不能改写已发送候选', async () => {
  const editable = { ...definition, requestSchema: { type: 'OBJECT', properties: { id: { type: 'STRING' } } }, mappings: [{ target: 'id', source: 'REQUEST', path: 'id' }] };
  let finish: (response: Response) => void = () => {};
  mount((url, init) =>
    init?.method === 'PUT' ? new Promise<Response>((resolve) => { finish = resolve; }) : url.endsWith('/workspace') ? ok(workspaceSnapshot(editable)) : undefined,
  );
  await editorReady();
  fireEvent.change(screen.getByLabelText('映射1目标'), { target: { value: 'orderId' } });
  save();
  await waitFor(() => expect(screen.getByRole('combobox', { name: '映射1字段' })).toHaveProperty('disabled', true));
  finish(ok({ ...editable, mappings: [{ target: 'orderId', source: 'REQUEST', path: 'id' }], draftRevision: 2 }));
  await waitFor(() => expect(screen.getByRole('combobox', { name: '映射1字段' })).toHaveProperty('disabled', false));
});

test('清空已有API名称仍显示已保存对象名称，不误报新建', async () => {
  mount();
  const input = await editorReady();
  fireEvent.change(input, { target: { value: '  ' } });
  expect(screen.getByRole('heading', { level: 1, name: '查询订单' })).toBeTruthy();
  expect(screen.queryByRole('heading', { name: '新建 API' })).toBeNull();
});

test('配置、可选MCP与操作页签有序呈现；已有API编辑受离开保护', async () => {
  mount();
  await editorReady();
  expect(screen.getAllByRole('tab').map((item) => item.textContent)).toEqual(['配置', 'MCP 配置（可选）', '调试', '发布', '版本与生命周期']);
  fireEvent.change(screen.getByLabelText('接口名称'), { target: { value: '自己的输入' } });
  expect(within(screen.getByLabelText('发布状态')).getByText('有未保存修改')).toBeTruthy();
  expect(screen.getByText('1 处改动未保存为修订')).toBeTruthy();
  back();
  expect(await screen.findByRole('heading', { name: '离开前处理未保存更改' })).toBeTruthy();
});

test('JSON生成尚未采用时浏览器导航受保护，取消离开保留样例', async () => {
  mount();
  await editorReady();
  fireEvent.click(screen.getAllByRole('button', { name: 'JSON 生成字段' })[0]);
  fireEvent.change(screen.getByLabelText('生成字段的 JSON 样例'), { target: { value: '{"name":"仍在编辑"}' } });
  window.location.hash = '#/catalog';
  window.dispatchEvent(new HashChangeEvent('hashchange'));
  expect(await screen.findByRole('heading', { name: '离开前处理未保存更改' })).toBeTruthy();
  expect(screen.getByText('字段编辑或JSON生成尚未应用，请完成或明确放弃后离开。')).toBeTruthy();
  expect(screen.queryByRole('button', { name: '保存并离开' })).toBeNull();
});

test('字段差异撤回清除目录标记，滚动目录本身不计修改', async () => {
  mount();
  const name = await editorReady();
  fireEvent.change(name, { target: { value: '临时改名' } });
  expect(screen.getByRole('button', { name: '基本信息，有未保存修改' })).toBeTruthy();
  fireEvent.change(name, { target: { value: definition.name } });
  expect(screen.getByRole('button', { name: '基本信息' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '调用目标与映射' }));
  fireEvent.click(screen.getByRole('button', { name: '基本信息' }));
  expect(screen.queryByRole('button', { name: /有未保存修改/ })).toBeNull();
});

test('表单切换 HTTP 方法使用旧映射保留规则：GET 阻断正文规则，切回恢复', async () => {
  mount((url) => (url.endsWith('/apis/api1/workspace') ? ok(workspaceSnapshot({ ...definition, mappings: [{ source: 'FIXED', target: 'amount', value: 1 }] })) : undefined));
  await editorReady();
  fireEvent.mouseDown(screen.getByLabelText('HTTP 方法'));
  fireEvent.click(await screen.findByText('GET', { selector: '.ant-select-item-option-content' }));
  await waitFor(() => expect(screen.getByRole('region', { name: 'BODY映射' }).querySelector('fieldset')?.disabled).toBe(true));
  expect(screen.getByRole('button', { name: /移除1条正文规则/ })).toBeTruthy();
  fireEvent.mouseDown(screen.getByLabelText('HTTP 方法'));
  fireEvent.click(await screen.findByText('POST', { selector: '.ant-select-item-option-content' }));
  await waitFor(() => expect(screen.getByRole('region', { name: 'BODY映射' }).querySelector('fieldset')?.disabled).toBe(false));
});

test('目标定位可在服务名与固定 URL 间切换，并保留双向目标输入', async () => {
  mount();
  await editorReady();
  fireEvent.click(screen.getByRole('radio', { name: '服务名发现' }));
  expect(screen.getByLabelText('内部服务名')).toHaveProperty('value', '');
  fireEvent.change(screen.getByLabelText('内部服务名'), { target: { value: 'orders' } });
  fireEvent.change(screen.getByLabelText('内部请求路径'), { target: { value: '/orders/{id}' } });
  fireEvent.click(screen.getByRole('radio', { name: '固定 URL' }));
  expect(screen.getByLabelText('内部请求地址')).toHaveProperty('value', definition.binding.http.url);
  fireEvent.click(screen.getByRole('radio', { name: '服务名发现' }));
  expect(screen.getByLabelText('内部服务名')).toHaveProperty('value', 'orders');
  expect(screen.getByLabelText('内部请求路径')).toHaveProperty('value', '/orders/{id}');
});

test('未保存修改按 5 秒节流暂存；重新打开提示恢复或丢弃，保存后清除', async () => {
  const handler = (_url: string, init?: RequestInit) => (init?.method === 'PUT' ? ok({ ...definition, ...JSON.parse(String(init.body)), draftRevision: 2 }) : undefined);
  mount(handler);
  fireEvent.change(await editorReady(), { target: { value: '误关前的输入' } });
  await waitFor(() => expect(window.sessionStorage.getItem('op-api-draft:api1:1')).toContain('误关前的输入'), { timeout: 6500 });
  expect(screen.getByText(/已暂存 \d\d:\d\d · 1 处改动未保存为修订/)).toBeTruthy();
  cleanup();
  const calls = mount(handler);
  expect(await screen.findByText(/暂存在本页的未保存修改/)).toBeTruthy();
  expect(screen.getByLabelText('接口名称')).toHaveProperty('value', '查询订单');
  fireEvent.click(screen.getByRole('button', { name: '恢复未保存修改' }));
  expect(screen.getByLabelText('接口名称')).toHaveProperty('value', '误关前的输入');
  save();
  await waitFor(() => expect(puts(calls).length).toBeGreaterThan(0));
  await waitFor(() => expect(window.sessionStorage.getItem('op-api-draft:api1:1')).toBeNull());
  cleanup();
  window.sessionStorage.setItem('op-api-draft:api1:1', '{"savedAt":1,"content":{"metadata":{"service":"orders","version":"v1","method":"query","name":"丢弃我","category":"订单","owner":"EMP_00000000000000000000000000000001","description":""},"sections":{"requestSchema":"{}","responseSchema":"{}","binding":"{}","mappings":"[]","errorDefinitions":"[]"},"lifecycle":null,"adapter":{"mode":"DIRECT","successPath":"code","successValues":"[200]","dataPath":"data","messagePath":""},"codes":[],"employeeRequired":false}}');
  mount();
  fireEvent.click(await screen.findByRole('button', { name: /丢\s*弃/ }));
  expect(window.sessionStorage.getItem('op-api-draft:api1:1')).toBeNull();
  expect(screen.getByLabelText('接口名称')).toHaveProperty('value', '查询订单');
}, 25000);

test('⌘S 保存为修订', async () => {
  const calls = mount((_url, init) => (init?.method === 'PUT' ? ok({ ...definition, draftRevision: 2 }) : undefined));
  fireEvent.change(await editorReady(), { target: { value: '快捷键保存' } });
  fireEvent.keyDown(window, { key: 's', metaKey: true });
  await waitFor(() => expect(puts(calls)).toHaveLength(1));
  expect(JSON.parse(String(puts(calls)[0][1]!.body)).name).toBe('快捷键保存');
});

test('检查面板给出建议完善与生效版差异，建议不阻止保存', async () => {
  const calls = mount((url, init) => {
    if (url.endsWith('/workspace')) return ok({ ...workspaceSnapshot(definition), liveDraftRevision: 1 });
    if (url.includes('/revisions/1')) return ok({ revision: 1, snapshot: { ...definition, name: '旧名称' } });
    if (init?.method === 'PUT') return ok({ ...definition, draftRevision: 2 });
  });
  await editorReady();
  const panel = screen.getByRole('complementary', { name: '检查' });
  expect(within(panel).getByText(/项建议完善/)).toBeTruthy();
  expect(within(panel).getByText(/接口说明为空/)).toBeTruthy();
  await waitFor(() => expect(panel.textContent).toContain('与生效 r1 相比，1 个分区有变化：基本信息'));
  save();
  await waitFor(() => expect(puts(calls)).toHaveLength(1));
});

test('整份 JSON 同时修改 HTTP 方法与映射时以 JSON 原文为准，不按旧映射重排', async () => {
  const calls = mount((url, init) => {
    if (url.includes('/validate-json')) return echoJson(init);
    if (init?.method === 'PUT') return ok({ ...definition, draftRevision: 2 });
  });
  await editorReady();
  const input = await openJson();
  fireEvent.change(input, {
    target: {
      value: input.value
        .replace('"method": "POST"', '"method": "GET"')
        .replace('"mappings": []', '"mappings": [{"target":"q","source":"FIXED","value":1,"location":"QUERY"}]'),
    },
  });
  applyJson();
  await waitFor(() => expect(screen.queryByLabelText('整份配置 JSON')).toBeNull());
  save();
  await waitFor(() => expect(puts(calls)).toHaveLength(1));
  const body = JSON.parse(String(puts(calls)[0][1]!.body));
  expect(body.binding.http.method).toBe('GET');
  expect(body.mappings).toEqual([{ target: 'q', source: 'FIXED', value: 1, location: 'QUERY' }]);
});


test('字段值和非法改名未应用时阻止保存、离开与结构生成', async () => {
  const fields = {...definition, requestSchema:{type:'OBJECT',properties:{count:{type:'INTEGER'}}}};
  const calls = mount((url, init) => url.endsWith('/apis/api1/workspace') ? ok(workspaceSnapshot(fields)) : url.endsWith('/apis/api1') ? ok(fields) : undefined);
  await editorReady();
  fireEvent.change(screen.getByLabelText('请求结构字段 count 名称'),{target:{value:'tenantId'}});
  fireEvent.blur(screen.getByLabelText('请求结构字段 count 名称'));
  save();
  await screen.findByText('有未保存修改');
  expect(puts(calls)).toHaveLength(0);
  fireEvent.keyDown(screen.getByLabelText('请求结构字段 count 名称'),{key:'Escape'});
  fireEvent.click(screen.getByRole('button',{name:'count 值设置'}));
  fireEvent.change(screen.getByLabelText('默认值'),{target:{value:'123'}});
  fireEvent.click(screen.getAllByRole('button',{name:'JSON 生成字段'})[0]);
  expect(screen.queryByRole('dialog',{name:'从请求 JSON 生成字段'})).toBeNull();
  expect(screen.getByLabelText('默认值')).toHaveProperty('value','123');
  expect(screen.getByText('请先应用或取消字段修改，再切换或折叠结构。')).toBeTruthy();
  save();
  expect(puts(calls)).toHaveLength(0);
  back();
  await screen.findByRole('button', {name:'放弃更改并离开'});
  expect(window.location.hash).toContain('/config');
}, 15000);

test('整份JSON结构校验失败保留原文，取消后迟到响应不得修改草稿', async () => {
  let finish:((response:Response)=>void)|undefined;
  let sent='';
  const calls=mount((url,init)=>{
    if(url.includes('kind=schema')) return Response.json({code:40000001,resultMsg:'字段节点不能为空'},{status:400});
    if(url.includes('/validate-json')) {
      sent=String(init?.body);
      if(sent.includes('broken')) return echoJson(init);
      return new Promise<Response>(resolve=>{finish=resolve});
    }
  });
  await editorReady();
  const input=await openJson();
  const invalid='{"requestSchema":{"type":"OBJECT","properties":{"broken":null}}}';
  fireEvent.change(input,{target:{value:invalid}}); applyJson();
  await screen.findByText(/字段节点不能为空/);
  expect(screen.getByLabelText('整份配置 JSON')).toHaveProperty('value',invalid);
  expect(screen.queryByText('工作区暂时无法显示')).toBeNull();
  fireEvent.change(input,{target:{value:JSON.stringify({...definition,name:'已取消内容'})}}); applyJson();
  await waitFor(()=>expect(finish).toBeTruthy());
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:/取\s*消/}));
  finish!(new Response(`{"code":200,"data":${sent}}`,{headers:{'Content-Type':'application/json'}}));
  await waitFor(()=>expect(screen.getByLabelText('接口名称')).toHaveProperty('value',definition.name));
  expect(puts(calls)).toHaveLength(0);
});

test('独立MCP页签保留共同草稿，校验错误自动定位MCP字段且保存完整配置', async () => {
  const source = { ...definition, operationKind: 'QUERY', mcpTool: { enabled: true, aiDescription: '原用途' } };
  let saved: Record<string, unknown> | undefined;
  mount((url, init) => {
    if (url.endsWith('/workspace')) return ok(workspaceSnapshot(source));
    if (url.endsWith('/validate')) return ok({ valid: false, checkedDraftRevision: 1, truncated: false,
      fieldIssues: [{ path: '/mcpTool/aiDescription', reason: 'INVALID_VALUE', message: '请补充工具用途' }] });
    if (url.endsWith('/apis/api1') && init?.method === 'PUT') {
      saved = JSON.parse(String(init.body));
      return ok({ ...source, ...saved, draftRevision: 2 });
    }
    if (url.endsWith('/apis/api1')) return ok(source);
    return undefined;
  });
  fireEvent.change(await editorReady(), { target: { value: '保留通用配置修改' } });
  fireEvent.click(screen.getByRole('tab', { name: 'MCP 配置（可选）' }));
  await waitFor(() => expect(window.location.hash).toBe('#/apis/api1/mcp'));
  fireEvent.change(screen.getByRole('textbox', { name: '面向 AI 的用途说明' }), { target: { value: '新的工具用途' } });
  fireEvent.click(screen.getByRole('tab', { name: /^配置/ }));
  expect(screen.getByRole('textbox', { name: '接口名称' })).toHaveProperty('value', '保留通用配置修改');
  expect(screen.getByRole('tab', { name: 'MCP 配置（可选），有未保存修改' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '校 验' }));
  await waitFor(() => expect(window.location.hash).toBe('#/apis/api1/mcp'));
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('textbox', { name: '面向 AI 的用途说明' })));
  fireEvent.change(screen.getByRole('textbox', { name: '面向 AI 的用途说明' }), { target: { value: '修正后的工具用途' } });
  fireEvent.click(screen.getByRole('button', { name: /保存为修订/ }));
  await waitFor(() => expect(saved).toMatchObject({ name: '保留通用配置修改', operationKind: 'QUERY', mcpTool: { enabled: true, aiDescription: '修正后的工具用途' } }));
});
