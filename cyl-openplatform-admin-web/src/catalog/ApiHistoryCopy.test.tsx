import { workspaceSnapshot } from '../testing/workspace';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { parseJson, stringifyJson } from '@cyl/open-platform-web-shared/json';
import { AdminNavigationProvider } from '../navigation/AdminNavigation';
import { createAdminApi } from '../access/api';
import CatalogPanel, { type ApiDefinition } from './CatalogPanel';

const definition: ApiDefinition = {
  id: 'api1',
  service: 'orders',
  version: 'v1',
  method: 'query',
  name: '查询订单',
  category: '订单',
  owner: '原负责人',
  protocol: 'HTTP',
  draftRevision: parseJson('9007199254740993'),
  liveDraftRevision: 1,
  scopeCodes: [],
  requestSchema: { type: 'OBJECT', properties: {} },
  responseSchema: { type: 'OBJECT', properties: {} },
  binding: {
    protocol: 'HTTP',
    timeoutMillis: 3000,
    http: { url: 'http://orders.internal/query', method: 'POST' },
  },
  mappings: [],
  errorDefinitions: [],
};
const metadata = (revision: string, historyStart = false) => ({
  apiId: 'api1',
  revision: parseJson(revision),
  source: historyStart ? 'HISTORY_BASELINE' : 'UPDATE_API_DRAFT',
  summary: historyStart ? '历史起点' : '编辑保存',
  operatorTenantId: historyStart ? null : 'tenant1',
  operatorEmployeeNo: historyStart ? null : '001',
  recordedAt: '2026-09-20T08:00:00Z',
  historyStart,
  contentDigest: 'abc',
  digestVersion: 'v1',
});
const page = (items: unknown[], total = items.length) => ({ items, total, page: 1, pageSize: 20 });
const ok = (data: unknown) => new Response(stringifyJson({ code: 200, data }));
const currentOwner = {
  id: 'EMP_00000000000000000000000000000001',
  displayName: '当前维护人', employeeNo: 'E1001', employeeId: 'person', tenantId: '101',
};
// 用例挂载完整 API 工作区（编辑器、字段表、检查面板），整轮并行时单例常接近 5 秒。
vi.setConfig({ testTimeout: 15000 });
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/#/catalog');
});

function mountCopy(
  handler?: (path: string, init?: RequestInit) => Response | Promise<Response> | undefined,
) {
  const calls = vi.fn(async (path: string, init?: RequestInit) => {
    const custom = await handler?.(path, init);
    if (custom) return custom;
    if (path.endsWith('/api-copies/preview')) {
      const body = parseJson<{ sourceKind: string }>(String(init?.body));
      return ok({
        sourceApiId: 'api1',
        sourceKind: body.sourceKind,
        sourceRevision: definition.draftRevision,
        sourceReleaseId: body.sourceKind === 'EFFECTIVE' ? 'release1' : null,
        snapshot: { ...definition, owner: currentOwner.id },
        warnings: ['已清除敏感凭据，请重新核对内部绑定'],
      });
    }
    if (path.includes('/apis/owners/')) return ok(currentOwner);
    if (path.includes('/categories?')) return ok(page(['订单']));
    if (path.includes('/scopes?')) return ok(page([]));
    if (path.includes('/apis?')) return ok(page([definition]));
    if (path.endsWith('/apis/copied/workspace'))
      return ok(workspaceSnapshot({ ...definition, id: 'copied', version: 'v2', owner: currentOwner.id }));
    throw new Error(path);
  });
  vi.stubGlobal('fetch', calls);
  window.history.replaceState({}, '', '/#/catalog?query=订单&pageNo=2&category=订单');
  render(<CatalogPanel api={createAdminApi('proof', vi.fn())} permissions={['MANAGE_APIS']} />, {
    wrapper: AdminNavigationProvider,
  });
  return calls;
}
async function enterCopy() {
  fireEvent.click(await screen.findByRole('button', { name: /.+更多操作$/ }));
  fireEvent.click(await screen.findByRole('menuitem', { name: '复制为新 API' }));
  await screen.findByText(/负责人默认为当前维护人/);
  expect(
    (screen.getByRole('button', { name: '确认并进入新建工作区' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  fireEvent.change(screen.getByLabelText('新外部版本'), { target: { value: 'v2' } });
  fireEvent.click(screen.getByRole('button', { name: '确认并进入新建工作区' }));
  await screen.findByRole('button', { name: '保存并创建 API' });
}

test('复制版本字段兼容浏览器 v 模式，允许点、下划线和连字符', async () => {
  mountCopy();
  fireEvent.click(await screen.findByRole('button', { name: /.+更多操作$/ }));
  fireEvent.click(await screen.findByRole('menuitem', { name: '复制为新 API' }));
  await screen.findByText(/负责人默认为当前维护人/);
  const input = screen.getByLabelText('新外部版本') as HTMLInputElement;
  const pattern = new RegExp(`^(?:${input.pattern})$`, 'v');
  for (const value of ['v1', 'v2.0_rc-1', '1', 'v'.repeat(32)]) expect(pattern.test(value)).toBe(true);
  for (const value of ['-v1', 'v1/2', 'v 1', 'v'.repeat(33)]) expect(pattern.test(value)).toBe(false);
});

test('复制取消不写入；确认仅预填并保留筛选，保存才创建且身份、负责人和范围明确', async () => {
  const calls = mountCopy((path, init) =>
    path.endsWith('/api-copies')
      ? ok({
          ...definition,
          ...parseJson<{ definition: object }>(String(init?.body)).definition,
          id: 'copied',
          draftRevision: 1,
        })
      : undefined,
  );
  fireEvent.click(await screen.findByRole('button', { name: /.+更多操作$/ }));
  fireEvent.click(await screen.findByRole('menuitem', { name: '复制为新 API' }));
  await screen.findByText(/负责人默认为当前维护人/);
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(calls.mock.calls.some(([path]) => path.endsWith('/api-copies'))).toBe(false);
  await enterCopy();
  await waitFor(() => expect((screen.getByLabelText('负责人') as HTMLInputElement).value).toBe('当前维护人 · 工号 E1001'));
  expect((screen.getByLabelText('外部版本') as HTMLInputElement).value).toBe('v2');
  expect(window.location.hash).toContain('pageNo=2');
  expect(calls.mock.calls.some(([path]) => path.endsWith('/api-copies'))).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '保存并创建 API' }));
  await waitFor(() =>
    expect(calls.mock.calls.some(([path]) => path.endsWith('/api-copies'))).toBe(true),
  );
  const body = String(calls.mock.calls.find(([path]) => path.endsWith('/api-copies'))![1]?.body);
  expect(body).toContain('"sourceRevision":9007199254740993');
  const request = parseJson<{ creationKey: string; definition: Record<string, unknown> }>(body);
  expect(request.creationKey).toBeTruthy();
  expect(request.definition).toMatchObject({
    service: 'orders',
    version: 'v2',
    owner: currentOwner.id,
    lifecycle: { status: 'ACTIVE' },
  });
  expect(request.definition).not.toHaveProperty('id');
  expect(request.definition).not.toHaveProperty('liveDraftRevision');
  expect(request.definition).not.toHaveProperty('expectedRevision');
  await waitFor(() => expect(window.location.hash).toContain('/apis/copied/'));
}, 10000);

test('复制超时先查原结果，404才开放原key原body重试，结果查询失败不盲目重发', async () => {
  // 普通 HTTP 页面保留 getRandomValues，但不提供 randomUUID。
  vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) });
  let writes = 0,
    reads = 0;
  const calls = mountCopy((path, init) => {
    if (path.endsWith('/api-copies')) {
      writes++;
      if (writes === 1) throw new TypeError('timeout');
      return ok({
        ...definition,
        ...parseJson<{ definition: object }>(String(init?.body)).definition,
        id: 'copied',
        draftRevision: 1,
      });
    }
    if (path.includes('/api-copies/requests/')) {
      reads++;
      if (reads === 1) throw new TypeError('offline');
      return new Response(stringifyJson({ code: 40400001, resultMsg: '未找到' }), { status: 404 });
    }
  });
  await enterCopy();
  fireEvent.change(screen.getByLabelText('接口名称'), { target: { value: '必须保留的名称' } });
  fireEvent.click(screen.getByRole('button', { name: '保存并创建 API' }));
  fireEvent.click(await screen.findByRole('button', { name: '查询原创建结果' }));
  await screen.findByText(/创建结果仍待核对/);
  expect(writes).toBe(1);
  expect(screen.queryByRole('button', { name: '使用原请求重试创建' })).toBeNull();
  expect((screen.getByLabelText('接口名称') as HTMLInputElement).value).toBe('必须保留的名称');
  fireEvent.click(screen.getByRole('button', { name: '查询原创建结果' }));
  fireEvent.click(await screen.findByRole('button', { name: '使用原请求重试创建' }));
  await waitFor(() => expect(writes).toBe(2));
  const bodies = calls.mock.calls
    .filter(([path]) => path.endsWith('/api-copies'))
    .map(([, init]) => init?.body);
  expect(bodies[1]).toBe(bodies[0]);
}, 15000);

test('查询找到原创建结果直接进入原API，不再次发送创建', async () => {
  let writes = 0;
  mountCopy((path) => {
    if (path.endsWith('/api-copies')) {
      writes++;
      throw new TypeError('timeout');
    }
    if (path.includes('/api-copies/requests/'))
      return ok({ ...definition, id: 'copied', version: 'v2', draftRevision: 1 });
  });
  await enterCopy();
  fireEvent.click(screen.getByRole('button', { name: '保存并创建 API' }));
  fireEvent.click(await screen.findByRole('button', { name: '查询原创建结果' }));
  await waitFor(() => expect(window.location.hash).toContain('/apis/copied/'));
  expect(writes).toBe(1);
}, 15000);

test('来源变化409保留输入，重新选择通过未保存确认且取消不丢草稿', async () => {
  mountCopy((path) =>
    path.endsWith('/api-copies')
      ? new Response(
          stringifyJson({ code: 40900001, resultMsg: '来源草稿已变化，请重新选择来源' }),
          { status: 409 },
        )
      : undefined,
  );
  await enterCopy();
  fireEvent.change(screen.getByLabelText('接口名称'), { target: { value: '冲突仍保留' } });
  fireEvent.click(screen.getByRole('button', { name: '保存并创建 API' }));
  await screen.findByText(/来源草稿已变化/);
  expect((screen.getByLabelText('接口名称') as HTMLInputElement).value).toBe('冲突仍保留');
  fireEvent.click(screen.getByRole('button', { name: '返回列表重新选择复制来源' }));
  expect(await screen.findByRole('dialog', { name: '离开前处理未保存更改' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect((screen.getByLabelText('接口名称') as HTMLInputElement).value).toBe('冲突仍保留');
}, 15000);

test('选择生效快照固定发布记录，来源切换后重新加载预览但不创建', async () => {
  const calls = mountCopy();
  fireEvent.click(await screen.findByRole('button', { name: /.+更多操作$/ }));
  fireEvent.click(await screen.findByRole('menuitem', { name: '复制为新 API' }));
  await screen.findByText(/负责人默认为当前维护人/);
  fireEvent.click(screen.getByRole('radio', { name: '当前生效快照' }));
  await screen.findByText(/发布记录 release1/);
  fireEvent.change(screen.getByLabelText('新外部版本'), { target: { value: 'v3' } });
  fireEvent.click(screen.getByRole('button', { name: '确认并进入新建工作区' }));
  expect(await screen.findByText(/从固定生效快照/)).toBeTruthy();
  expect(calls.mock.calls.filter(([path]) => path.endsWith('/api-copies/preview'))).toHaveLength(2);
  expect(calls.mock.calls.some(([path]) => path.endsWith('/api-copies'))).toBe(false);
});

test.each([502, 503, 504, 50000001])(
  '复制返回%s仍保留原创建键，重试5xx后查询原结果不会双建',
  async (code) => {
    let reads = 0;
    const calls = mountCopy((path) => {
      if (path.endsWith('/api-copies'))
        return new Response(
          stringifyJson({
            ...(code > 999 ? { code } : {}),
            resultMsg: '服务暂不可用',
          }),
          { status: code > 999 ? 500 : code },
        );
      if (path.includes('/api-copies/requests/')) {
        reads++;
        return reads === 1
          ? new Response(stringifyJson({ code: 40400001, resultMsg: '未找到' }), { status: 404 })
          : ok({ ...definition, id: 'copied', version: 'v2', draftRevision: 1 });
      }
    });
    await enterCopy();
    fireEvent.change(screen.getByLabelText('接口名称'), { target: { value: '代理失败仍保留' } });
    fireEvent.click(screen.getByRole('button', { name: '保存并创建 API' }));
    fireEvent.click(await screen.findByRole('button', { name: '查询原创建结果' }));
    fireEvent.click(await screen.findByRole('button', { name: '使用原请求重试创建' }));
    await screen.findByText(/创建结果仍待核对/);
    expect(screen.queryByRole('button', { name: '使用原请求重试创建' })).toBeNull();
    expect((screen.getByLabelText('接口名称') as HTMLInputElement).value).toBe('代理失败仍保留');
    const bodies = calls.mock.calls
      .filter(([path]) => path.endsWith('/api-copies'))
      .map(([, init]) => String(init?.body));
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toBe(bodies[0]);
    const { creationKey } = parseJson<{ creationKey: string }>(bodies[0]);
    fireEvent.click(screen.getByRole('button', { name: '查询原创建结果' }));
    await waitFor(() => expect(window.location.hash).toContain('/apis/copied/'));
    expect(
      calls.mock.calls.filter(([path]) => path.endsWith(`/api-copies/requests/${creationKey}`)),
    ).toHaveLength(2);
    expect(calls.mock.calls.filter(([path]) => path.endsWith('/api-copies'))).toHaveLength(2);
  },
  15000,
);

test('复制时调用标识可改，改回来源标识时阻止创建并保留输入', async () => {
  const calls = mountCopy();
  await enterCopy();
  fireEvent.change(screen.getByLabelText('外部版本'), { target: { value: 'v1' } });
  fireEvent.change(screen.getByLabelText('接口名称'), { target: { value: '改回原标识' } });
  fireEvent.click(screen.getByRole('button', { name: '保存并创建 API' }));
  expect(await screen.findByText('复制新 API 至少更换服务标识、外部版本或操作标识中的一项。')).toBeTruthy();
  expect((screen.getByLabelText('接口名称') as HTMLInputElement).value).toBe('改回原标识');
  expect(calls.mock.calls.some(([path]) => path.endsWith('/api-copies'))).toBe(false);
});

test('复制工作区的整份 JSON 经服务端解析后拆回分区，尚未创建时可一并修改调用标识', async () => {
  mountCopy((path, init) =>
    path.includes('/apis/validate-json') ? ok(parseJson(String(init?.body))) : undefined,
  );
  await enterCopy();
  fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
  fireEvent.click(await screen.findByText('以 JSON 编辑整份配置'));
  const editor = (await screen.findByLabelText('整份配置 JSON')) as HTMLTextAreaElement;
  const whole = parseJson<Record<string, unknown>>(editor.value);
  expect(whole).not.toHaveProperty('expectedRevision');
  fireEvent.change(editor, { target: { value: stringifyJson({ ...whole, method: 'lookup', name: 'JSON 改名' }, 2) } });
  fireEvent.click(screen.getByRole('button', { name: '校验并应用到页面' }));
  await waitFor(() => expect((screen.getByLabelText('操作标识') as HTMLInputElement).value).toBe('lookup'));
  expect((screen.getByLabelText('接口名称') as HTMLInputElement).value).toBe('JSON 改名');
});

test('权限组在弹窗中选择：停用的不可新增，确认后随创建提交，取消不改选择', async () => {
  const calls = mountCopy((path, init) => {
    if (path.includes('/scopes?'))
      return ok(page([
        { id: 's1', code: 'orders.read', name: '订单查询', enabled: true },
        { id: 's2', code: 'orders.old', name: '旧订单权限', enabled: false },
      ]));
    if (path.endsWith('/api-copies'))
      return ok({ ...definition, ...parseJson<{ definition: object }>(String(init?.body)).definition, id: 'copied', draftRevision: 1 });
  });
  await enterCopy();
  fireEvent.click(screen.getByRole('button', { name: '选择权限组…' }));
  // antd 在测试环境给弹窗固定 aria-labelledby，按唯一打开的对话框与标题文字定位。
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText('选择调用权限组')).toBeTruthy();
  expect(within(dialog).getByRole('checkbox', { name: /旧订单权限/ })).toHaveProperty('disabled', true);
  fireEvent.click(within(dialog).getByRole('checkbox', { name: /订单查询/ }));
  fireEvent.click(within(dialog).getByRole('button', { name: /取\s?消/ }));
  expect(screen.getByText('尚未选择')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '选择权限组…' }));
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('checkbox', { name: /订单查询/ }));
  fireEvent.click(screen.getByRole('button', { name: '确认选择' }));
  await waitFor(() => expect(screen.queryByText('尚未选择')).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: '保存并创建 API' }));
  await waitFor(() => expect(calls.mock.calls.some(([path]) => path.endsWith('/api-copies'))).toBe(true));
  const body = parseJson<{ definition: { scopeCodes: string[] } }>(String(calls.mock.calls.find(([path]) => path.endsWith('/api-copies'))![1]?.body));
  expect(body.definition.scopeCodes).toEqual(['orders.read']);
});

test('复制写入等待期间不能重新选择来源或再次提交，结果未知后查询到原结果直接进入', async () => {
  let reject!: (reason: Error) => void;
  const pending = new Promise<Response>((_, fail) => { reject = fail; });
  const calls = mountCopy((path) => {
    if (path.endsWith('/api-copies')) return pending;
    if (path.includes('/api-copies/requests/')) return ok({ ...definition, id: 'copied', version: 'v2', draftRevision: 1 });
  });
  await enterCopy();
  fireEvent.click(screen.getByRole('button', { name: '保存并创建 API' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '返回列表重新选择复制来源' })).toHaveProperty('disabled', true));
  fireEvent.click(screen.getByRole('button', { name: /保存并创建 API/ }));
  reject(new TypeError('响应中断'));
  fireEvent.click(await screen.findByRole('button', { name: '查询原创建结果' }));
  await waitFor(() => expect(window.location.hash).toContain('/apis/copied/'));
  expect(calls.mock.calls.filter(([path]) => path.endsWith('/api-copies'))).toHaveLength(1);
});

function mountVersions(handler: (path: string, init?: RequestInit) => unknown) {
  const calls = vi.fn(async (path: string, init?: RequestInit) => {
    const custom = handler(path, init);
    if (custom instanceof Response) return custom;
    if (custom !== undefined) return ok(custom);
    if (path.includes('/releases?')) return ok(page([]));
    if (path.includes('/environment-releases')) return ok(path.endsWith('/targets') ? [] : page([]));
    if (path.includes('/categories?')) return ok(page(['订单']));
    if (path.includes('/scopes?')) return ok(page([]));
    throw new Error(path);
  });
  vi.stubGlobal('fetch', calls);
  window.history.replaceState({}, '', '/#/apis/api1/versions');
  render(<CatalogPanel api={createAdminApi('proof', vi.fn())} permissions={['MANAGE_APIS']} />, { wrapper: AdminNavigationProvider });
  return calls;
}

test('无变化保存不重读时间线，产生新修订后重新读取', async () => {
  let revision = 1;
  const calls = mountVersions((path, init) => {
    if (path.includes('/revisions?')) return page(Array.from({ length: revision }, (_, index) => metadata(String(index + 1))));
    if (path.endsWith('/apis/api1/workspace')) return workspaceSnapshot({ ...definition, draftRevision: revision });
    if (path.endsWith('/apis/api1')) {
      if (init?.method === 'PUT') {
        const changed = parseJson<{ name: string }>(String(init.body)).name !== definition.name;
        if (changed) revision++;
        return { ...definition, name: parseJson<{ name: string }>(String(init.body)).name, draftRevision: revision, changed };
      }
      return { ...definition, draftRevision: revision };
    }
  });
  const reads = () => calls.mock.calls.filter(([path]) => path.includes('/revisions?')).length;
  await screen.findByLabelText('选择草稿 r1', {}, { timeout: 5000 });
  expect(reads()).toBe(1);
  fireEvent.click(screen.getByRole('tab', { name: '配置' }));
  fireEvent.click(screen.getByRole('button', { name: /保存为修订/ }));
  await screen.findByText('内容未变化，仍为 r1');
  fireEvent.click(screen.getByRole('tab', { name: '版本与生命周期' }));
  await screen.findByLabelText('选择草稿 r1');
  const afterUnchanged = reads();
  fireEvent.click(screen.getByRole('tab', { name: '配置' }));
  fireEvent.change(screen.getByLabelText('接口名称'), { target: { value: '真实修改' } });
  fireEvent.click(screen.getByRole('button', { name: /保存为修订/ }));
  await waitFor(() => expect(revision).toBe(2));
  fireEvent.click(screen.getByRole('tab', { name: '版本与生命周期' }));
  await screen.findByLabelText('选择草稿 r2');
  expect(reads()).toBeGreaterThan(afterUnchanged);
});

test('一键比较固定历史与当前已保存草稿，读取两份固定快照', async () => {
  const current = { ...definition, draftRevision: 2, name: '当前草稿内容' };
  const calls = mountVersions((path) => {
    if (path.includes('/revisions?')) return page([metadata('2'), metadata('1')]);
    if (path.endsWith('/revisions/1')) return { ...metadata('1'), snapshot: { ...definition, draftRevision: 1 } };
    if (path.endsWith('/revisions/2')) return { ...metadata('2'), snapshot: current };
    if (path.endsWith('/apis/api1/workspace')) return workspaceSnapshot(current);
    if (path.endsWith('/apis/api1')) return current;
  });
  const buttons = await screen.findAllByRole('button', { name: '与当前草稿比较' }, { timeout: 5000 });
  // 当前草稿行不提供与自身比较。
  expect(buttons).toHaveLength(1);
  fireEvent.click(buttons[0]);
  await screen.findByText('草稿 r1 → 草稿 r2');
  expect(screen.getAllByText('当前草稿内容').length).toBeGreaterThan(0);
  expect(calls.mock.calls.filter(([path]) => /\/revisions\/\d+$/.test(path)).map(([path]) => path)).toEqual(['/admin-api/apis/api1/revisions/1', '/admin-api/apis/api1/revisions/2']);
});

test('缺少历史快照时显示差异不可用，不显示无差异', async () => {
  mountVersions((path) => {
    if (path.includes('/revisions?')) return page([metadata('2'), metadata('1')]);
    if (path.endsWith('/revisions/1')) return { ...metadata('1'), snapshot: null };
    if (path.endsWith('/revisions/2')) return { ...metadata('2'), snapshot: { ...definition, draftRevision: 2 } };
    if (path.endsWith('/apis/api1/workspace')) return workspaceSnapshot({ ...definition, draftRevision: 2 });
    if (path.endsWith('/apis/api1')) return { ...definition, draftRevision: 2 };
  });
  fireEvent.click(await screen.findByLabelText('选择草稿 r1', {}, { timeout: 5000 }));
  fireEvent.click(screen.getByLabelText('选择草稿 r2'));
  fireEvent.click(screen.getByRole('button', { name: '比较所选' }));
  expect(await screen.findByText(/差异暂不可用/)).toBeTruthy();
  expect(screen.queryByText('两个版本内容无差异')).toBeNull();
});

test('按固定修订读取导入来源，显示资料类型与摘要，不预加载来源原文', async () => {
  const revision = { ...metadata('2'), source: 'IMPORT_UPDATE_API_DRAFT', summary: '导入更新草稿' };
  const calls = mountVersions((path) => {
    if (path.includes('/provenance/')) return { apiId: 'api1', revision: 2, sourceKind: 'OPENAPI', sourceLabel: 'OpenAPI 3.0 JSON 接口文档', sourceDigest: 'a'.repeat(64) };
    if (path.includes('/revisions?')) return page([revision]);
    if (path.endsWith('/apis/api1/workspace')) return workspaceSnapshot({ ...definition, draftRevision: 2 });
    if (path.endsWith('/apis/api1')) return { ...definition, draftRevision: 2 };
  });
  fireEvent.click(await screen.findByRole('button', { name: '导入资料' }, { timeout: 5000 }));
  expect(await screen.findByText('OpenAPI 3.0 JSON 接口文档')).toBeTruthy();
  expect(screen.getByText('a'.repeat(64))).toBeTruthy();
  expect(calls.mock.calls.filter(([path]) => path.includes('/provenance/')).map(([path]) => path)).toEqual(['/admin-api/api-imports/provenance/api1?revision=2']);
});
