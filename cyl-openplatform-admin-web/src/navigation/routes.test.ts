import { expect, test } from 'vitest';
import { activeEntryPath, canSee, pageEntries, pathFor, resolvePath, titleFor } from './routes';

const route = (page: string, apiId: string | null = null, step = 'outer', operationsView?: 'statistics' | 'alerts') => ({ page, apiId, step, operationsView });

test('每个页面键都有唯一的规范路径，且路径能解析回同一页面', () => {
  for (const page of new Set(['imports', 'transfers', ...pageEntries.map(entry => entry.page)])) {
    const path = pathFor(route(page));
    const resolved = resolvePath(path);
    expect(resolved.page).toBe(page);
    expect(resolved.legacy).toBe(false);
  }
});

test('API 工作区步骤编码在路径中，往返不丢失', () => {
  for (const step of ['outer', 'mcp', 'test', 'pub', 'history']) {
    const path = pathFor(route('catalog', 'api 1/x', step));
    expect(path.startsWith('/apis/api%201%2Fx/')).toBe(true);
    expect(resolvePath(path)).toEqual({ page: 'catalog', apiId: 'api 1/x', step, legacy: false });
  }
  // 111：对内配置 / 返回与文档并入配置页；旧分段解析为旧步骤以便滚动到分区，地址规范为 config。
  expect(pathFor(route('catalog', 'api1', 'inner'))).toBe('/apis/api1/config');
  expect(pathFor(route('catalog', 'api1', 'doc'))).toBe('/apis/api1/config');
  expect(resolvePath('/apis/api1/binding')).toEqual({ page: 'catalog', apiId: 'api1', step: 'inner', legacy: true });
  expect(resolvePath('/apis/api1/response')).toEqual({ page: 'catalog', apiId: 'api1', step: 'doc', legacy: true });
  expect(pathFor(route('catalog', 'new', 'outer'))).toBe('/apis/new');
  expect(resolvePath('/apis/new')).toEqual({ page: 'catalog', apiId: 'new', step: 'outer', legacy: false });
  expect(resolvePath('/apis/new/config')).toMatchObject({ page: 'catalog', apiId: 'new', legacy: true });
  expect(resolvePath('/apis/api1')).toMatchObject({ page: 'catalog', apiId: 'api1', step: 'outer', legacy: true });
});

test('调用分析与告警是两个入口，共用同一工作区', () => {
  expect(pathFor(route('operations', null, 'outer', 'alerts'))).toBe('/alerts');
  expect(pathFor(route('operations', null, 'outer', 'statistics'))).toBe('/analytics');
  expect(resolvePath('/alerts')).toMatchObject({ page: 'operations', operationsView: 'alerts' });
});

test('旧地址仍能定位到原页面，并标记为需要替换', () => {
  for (const [path, page] of [['catalog', 'catalog'], ['applications', 'applications'], ['imports', 'imports'], ['transfers', 'transfers'], ['publications', 'publications'], ['governance', 'governance'], ['operations', 'operations'], ['calls', 'calls'], ['administrators', 'administrators'], ['documents', 'documents'], ['home', 'home']])
    expect(resolvePath(path)).toEqual({ page, legacy: true });
  // 112b：维护与退役并入 API 工作区“版本与生命周期”。
  expect(resolvePath('lifecycle')).toEqual({ page: 'catalog', step: 'history', legacy: true });
  expect(resolvePath('/apis/lifecycle')).toEqual({ page: 'catalog', step: 'history', legacy: true });
  expect(resolvePath('')).toEqual({ page: 'home', legacy: true });
  expect(resolvePath('unknown-page')).toEqual({ page: 'home', legacy: true });
  // 113：Token 排障并入凭据抽屉 Token 页，旧地址替换为凭据列表。
  expect(resolvePath('tokens')).toEqual({ page: 'applications', applicationTab: 'tokens', legacy: true });
  expect(resolvePath('/credentials/tokens')).toEqual({ page: 'applications', applicationTab: 'tokens', legacy: true });
  // 与新路径同名的页面不需要替换。
  expect(resolvePath('scopes')).toEqual({ page: 'scopes', legacy: false });
});

test('菜单名与页面标题一致，子页面高亮所属入口', () => {
  for (const entry of pageEntries) expect(titleFor(route(entry.page, null, 'outer', entry.operationsView))).toBe(entry.title);
  expect(activeEntryPath({ page: 'imports' })).toBe('/apis');
  expect(activeEntryPath({ page: 'transfers' })).toBe('/reviews');
  expect(titleFor(route('catalog', 'new'))).toBe('新建 API');
});

test('菜单按权限显示，管理员入口对总管理员可见', () => {
  const admins = pageEntries.find((entry) => entry.page === 'administrators')!;
  expect(canSee(admins, { permissions: [], superAdministrator: true })).toBe(true);
  expect(canSee(admins, { permissions: ['MANAGE_APIS'], superAdministrator: false })).toBe(false);
  const visible = pageEntries.filter((entry) => canSee(entry, { permissions: ['VIEW_AUDIT'], superAdministrator: false })).map((entry) => entry.title);
  expect(visible).toEqual(['工作台', '调用分析', '调用日志', '告警', '管理员', '管理审计']);
});
