import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { AdminApi } from '../access/api';
import { publicationDisplay } from './publicationDisplay';
import { parseJson, stringifyJson } from '@cyl/open-platform-web-shared/json';
import type { ApiDefinition } from '../catalog/CatalogPanel';
import PublicationDiff, { publicationChanges } from './PublicationDiff';
afterEach(cleanup);

test('差异包含负责人及字段增删且保留精确数值，不把修订号当作内容变化', () => {
  const before = parseJson<ApiDefinition>('{"draftRevision":1,"owner":"甲","requestSchema":{"type":"OBJECT","properties":{"old":{"type":"STRING"},"amount":{"example":0.123456789012345678901}}}}');
  const after = parseJson<ApiDefinition>('{"draftRevision":3,"owner":"乙","requestSchema":{"type":"OBJECT","properties":{"new":{"type":"INTEGER"},"amount":{"example":0.123456789012345678902}}}}');
  const changes = publicationChanges(before, after);
  expect(changes.map(change => change.path)).toEqual(['owner', 'requestSchema.properties.old', 'requestSchema.properties.amount.example', 'requestSchema.properties.new']);
  expect(changes.find(change => change.path.endsWith('.old'))?.after).toBeUndefined();
  expect(changes.find(change => change.path.endsWith('.new'))?.before).toBeUndefined();
  expect(stringifyJson(changes.find(change => change.path.endsWith('.example'))?.after)).toBe('0.123456789012345678902');
  expect(publicationChanges(before, { ...before, draftRevision: 99, hasUnpublishedChanges: false })).toEqual([]);
});

test('数值按精确十进制内容比较，忽略小数位表示但不舍入大整数', () => {
  const before = parseJson<ApiDefinition>('{"requestSchema":{"example":[1,1e1000,-0,12.30,9007199254740993,0.123456789012345678901]}}');
  const same = parseJson<ApiDefinition>('{"requestSchema":{"example":[1.0,10e999,0,123e-1,9007199254740993.0,0.1234567890123456789010]}}');
  expect(publicationChanges(before, same)).toEqual([]);
  const different = parseJson<ApiDefinition>('{"requestSchema":{"example":["1",1e999,null,12.31,9007199254740992,0.123456789012345678902]}}');
  expect(publicationChanges(before, different).map(change => change.path)).toEqual([
    'requestSchema.example.0', 'requestSchema.example.1', 'requestSchema.example.2',
    'requestSchema.example.3', 'requestSchema.example.4', 'requestSchema.example.5',
  ]);
});

test('权限组按集合比较，仅重排不产生发布差异，真实增删作为一个授权变化展示', () => {
  const before = { scopeCodes: ['order.read', 'customer.read'] } as ApiDefinition;
  expect(publicationChanges(before, { ...before, scopeCodes: ['customer.read', 'order.read'] })).toEqual([]);
  const changes = publicationChanges(before, { ...before, scopeCodes: ['order.read', 'report.read'] });
  expect(changes).toHaveLength(1);
  expect(changes[0].path).toBe('scopeCodes');
  expect(changes[0].before).toEqual(['customer.read', 'order.read']);
  expect(changes[0].after).toEqual(['order.read', 'report.read']);
});

test('保留字段展示顺序变化，忽略普通示例JSON的键顺序但不混淆未设置与null', () => {
  const before = parseJson<ApiDefinition>(' {"requestSchema":{"type":"OBJECT","properties":{"a":{"type":"STRING"},"b":{"type":"STRING"}},"example":{"x":1,"y":2}}}');
  const after = parseJson<ApiDefinition>(' {"requestSchema":{"type":"OBJECT","properties":{"b":{"type":"STRING"},"a":{"type":"STRING"}},"example":{"y":2,"x":1},"defaultValue":null}}');
  expect(publicationChanges(before, after).map(c => c.path)).toEqual(['requestSchema.properties.$order', 'requestSchema.defaultValue']);
});


test('发布和审核共用权限组增删说明，一次批量解析当前名称并保留历史未知代码', async () => {
  const api = vi.fn(async () => ({ 'order.read': { name: '订单查询', enabled: true }, 'old.scope': { name: '旧范围', enabled: false } })) as unknown as AdminApi;
  const before = { scopeCodes: ['old.scope', 'deleted.scope'] } as ApiDefinition;
  const after = { scopeCodes: ['order.read'] } as ApiDefinition;
  const view = render(<PublicationDiff api={api} before={before} after={after} beforeLabel="提交时生效基线" afterLabel="固定候选" />);
  expect(await screen.findByText('订单查询')).toBeTruthy();
  const group = screen.getByRole('region', { name: '调用权限变更' });
  expect(within(group).getByText('旧范围')).toBeTruthy();
  expect(within(group).getByText('（当前已停用）')).toBeTruthy();
  expect(within(group).getByText('deleted.scope')).toBeTruthy();
  expect(within(group).getByText(/新增组可能/)).toBeTruthy();
  expect(api).toHaveBeenCalledTimes(1);
  expect(api).toHaveBeenCalledWith('/publications/scope-labels', expect.objectContaining({ method: 'POST', body: { codes: ['deleted.scope', 'old.scope', 'order.read'] } }));
  view.rerender(<PublicationDiff api={api} before={{ ...before, scopeCodes: ['deleted.scope', 'old.scope'] }} after={after} beforeLabel="提交时生效基线" afterLabel="固定候选" />);
  expect(api).toHaveBeenCalledTimes(1);
});

test('覆盖全部可发布字段；不遗漏结构默认值、绑定、映射、错误说明与生命周期', () => {
  const before = parseJson<ApiDefinition>(' {"service":"orders","version":"v1","method":"query","name":"查询","category":"订单","owner":"甲","description":"旧说明","protocol":"HTTP","scopeCodes":["read"],"requestSchema":{"type":"OBJECT","example":{"limit":0}},"responseSchema":{"type":"OBJECT","properties":{"amount":{"type":"NUMBER","defaultValue":0}}},"binding":{"protocol":"HTTP","http":{"url":"https://old.invalid","method":"POST"}},"mappings":[{"target":"arg0","source":"FIXED","value":false}],"errorDefinitions":[{"code":"OLD","message":"旧错误"}],"lifecycle":{"status":"ACTIVE"}}');
  const after = parseJson<ApiDefinition>(' {"service":"new","version":"v2","method":"get","name":"新查询","category":"新订单","owner":"乙","description":"","protocol":"DUBBO","scopeCodes":[],"requestSchema":{"type":"OBJECT","example":{"limit":1}},"responseSchema":{"type":"OBJECT","properties":{"amount":{"type":"NUMBER","defaultValue":0.123456789012345678901}}},"binding":{"protocol":"DUBBO","dubbo":{"connectionId":"conn","connectionRevision":2}},"mappings":[{"target":"arg0","source":"CONTEXT","path":"tenantId"}],"errorDefinitions":[{"code":"NEW","message":"新错误"}],"lifecycle":{"status":"DEPRECATED"}}');
  expect(new Set(publicationChanges(before, after).map(c => c.path.split('.')[0]))).toEqual(new Set(['service','version','method','name','category','owner','description','protocol','scopeCodes','requestSchema','responseSchema','binding','mappings','errorDefinitions','lifecycle']));
  render(<PublicationDiff before={before} after={after} beforeLabel="原配置" afterLabel="新配置" />);
  expect(screen.getByRole('region', { name: '响应与示例变更' }).textContent).toContain('0.123456789012345678901');
  expect(screen.getByText('空字符串')).toBeTruthy();
});

test('首发与名称查询失败明确展示；敏感值在差异和管理快照中都隐藏', async () => {
  const after = parseJson<ApiDefinition>(' {"scopeCodes":["missing"],"binding":{"http":{"url":"https://provider.invalid/query?token=secret-query"}},"responseSchema":{"type":"OBJECT","properties":{"password":{"type":"STRING","example":"secret-example"}},"example":{"accessToken":"secret-token"}},"mappings":[{"target":"arg0.password","source":"FIXED","value":"secret-fixed"}]}');
  const api = vi.fn(async () => { throw new Error('网络失败'); }) as unknown as AdminApi;
  render(<PublicationDiff api={api} before={null} after={after} beforeLabel="生效" afterLabel="候选" />);
  expect(await screen.findByText(/权限组名称暂不可用/)).toBeTruthy();
  expect(screen.getByText(/以下为本次新增配置/)).toBeTruthy();
  expect(screen.getByText('missing')).toBeTruthy();
  for (const secret of ['secret-query','secret-example','secret-token','secret-fixed']) {
    expect(document.body.textContent).not.toContain(secret);
    expect(stringifyJson(publicationDisplay(after))).not.toContain(secret);
  }
  fireEvent.click(screen.getByRole('button', { name: '重试名称查询' }));
  expect(api).toHaveBeenCalledTimes(2);
});


test('新增字段同时重排已有字段仍报告顺序，普通properties示例不能绕过敏感键脱敏', () => {
  const before = parseJson<ApiDefinition>('{"requestSchema":{"type":"OBJECT","properties":{"a":{"type":"STRING"},"b":{"type":"STRING"}}}}');
  const after = parseJson<ApiDefinition>('{"requestSchema":{"type":"OBJECT","properties":{"b":{"type":"STRING"},"a":{"type":"STRING"},"c":{"type":"STRING"}}},"responseSchema":{"type":"OBJECT","properties":{"password":{"type":"STRING","example":"hidden-example"}},"example":{"properties":{"token":"hidden-token","password":{"properties":{"nested":"hidden-nested"}}},"type":"OBJECT"}}}');
  expect(publicationChanges(before, after).map(change => change.path)).toContain('requestSchema.properties.$order');
  const safe = publicationDisplay(after);
  expect(safe.responseSchema.properties?.password.type).toBe('STRING');
  expect(stringifyJson(safe)).not.toMatch(/hidden-token|hidden-nested|hidden-example/);
  expect(stringifyJson(publicationDisplay(after.responseSchema, 'schema'))).not.toMatch(/hidden-token|hidden-nested|hidden-example/);
  render(<PublicationDiff before={before} after={after} beforeLabel="基线" afterLabel="候选" />);
  expect(document.body.textContent).not.toMatch(/hidden-token|hidden-nested|hidden-example/);
});

test('人员要求缺失与false等价，开启时用业务语言展示影响', () => {
  const before = { scopeCodes: [] } as unknown as ApiDefinition;
  expect(publicationChanges(before, { ...before, employeeRequired: false })).toEqual([]);
  expect(publicationChanges({ ...before, employeeRequired: null }, before)).toEqual([]);
  render(<PublicationDiff before={before} after={{ ...before, employeeRequired: true }} beforeLabel="原生效" afterLabel="候选" />);
  expect(screen.getByRole('heading', { name: '调用身份要求' })).toBeTruthy();
  expect(screen.getByText('开启：必须有完整有效人员委托')).toBeTruthy();
  expect(screen.getByText(/原租户级 Token/)).toBeTruthy();
});

test('新增或移除单个Schema字段结构化展示，敏感字段继承完整定义的脱敏上下文',()=>{
 const before={requestSchema:{type:'OBJECT',properties:{password:{type:'STRING',example:'old-secret'}}}} as unknown as ApiDefinition;
 const after={requestSchema:{type:'OBJECT',properties:{accessToken:{type:'STRING',example:'new-secret'},name:{type:'STRING',description:'展示姓名'}}}} as unknown as ApiDefinition;
 render(<PublicationDiff before={before} after={after} beforeLabel="基线" afterLabel="候选"/>);
 expect(screen.getByText('展示姓名')).toBeTruthy();expect(document.body.textContent).not.toMatch(/old-secret|new-secret/);expect(document.body.textContent).toContain('已隐藏');
});

test('负责人按稳定引用比较，最多解析两个人员并以当前姓名工号辅助核对',async()=>{
 const old='EMP_00000000000000000000000000000001',next='EMP_00000000000000000000000000000002';
 const api=vi.fn(async(path:string)=>({id:path.split('/').at(-1),displayName:path.endsWith(old)?'原负责人':'新负责人',employeeNo:'E1001'}));
 render(<PublicationDiff api={api as AdminApi} before={{owner:old} as ApiDefinition} after={{owner:next} as ApiDefinition} beforeLabel="原" afterLabel="新"/>);
 expect(await screen.findByText('新负责人 · 工号 E1001')).toBeTruthy();
 expect(await screen.findByText('原负责人 · 工号 E1001')).toBeTruthy();
 expect(api).toHaveBeenCalledTimes(2);
 expect(publicationChanges({owner:old} as ApiDefinition,{owner:next} as ApiDefinition)).toEqual([{path:'owner',before:old,after:next}]);
});
