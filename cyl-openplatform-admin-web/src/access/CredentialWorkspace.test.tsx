import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import ApplicationsPanel from './ApplicationsPanel';
import { AdminNavigationProvider, useAdminNavigation } from '../navigation/AdminNavigation';
import { AdminApiError, type AdminApi, type Application } from './api';

const app: Application = { id: 'a1', name: '订单', appKey: 'a'.repeat(32), ownerTenantId: 't1', status: 'ENABLED', authorizationVersion: 1, scopeCodes: ['orders'] };
const grant = { id: 'g1', applicationId: 'a1', tenantId: 't1', status: 'ACTIVE', authorizationVersion: 0, note: '本租户用途', noteRevision: 1 };
const tokenRecord = 'TOK_' + '1'.repeat(32);
const page = (items: unknown[], total = items.length) => ({ items, total, page: 1, pageSize: 20 });
function Workspace({ api }: { api: AdminApi }) {
  const nav = useAdminNavigation();
  return <ApplicationsPanel api={api} applicationId={nav.route.applicationId} tab={nav.route.applicationTab}
    onSelect={(applicationId, applicationTab) => nav.navigate({ ...nav.route, applicationId, applicationTab })}
    onBack={() => nav.navigate({ ...nav.route, applicationId: null, applicationTab: undefined })} />;
}
function client(override?: (path: string, options?: Parameters<AdminApi>[1]) => unknown) {
  return vi.fn(async (path: string, options?: Parameters<AdminApi>[1]) => {
    const changed = override?.(path, options); if (changed !== undefined) return changed;
    if (path === '/applications/a1') return app;
    if (path === '/applications/a2') return { ...app, id: 'a2', name: '另一个凭据', appKey: 'b'.repeat(32) };
    if (path.endsWith('/tenant-grants/g1')) return grant;
    if (path.includes('/tenant-grants?')) return page([grant], 45);
    if (path.includes('/users?')) return page([{ id: 'u1', employeeNo: 'E001', displayName: '张三', userId: 'person1', status: 'ACTIVE' }], 65);
    if (path.startsWith('/scopes?')) return page([{ id: 's1', code: 'orders', name: '订单权限', enabled: true }]);
    if (path.startsWith('/applications?')) return page([app, { ...app, id: 'a2', name: '另一个凭据', appKey: 'b'.repeat(32) }]);
    return page([]);
  });
}
function mount(api: AdminApi, hash: string) {
  history.replaceState({}, '', `/#/applications${hash}`);
  return render(<AdminNavigationProvider><Workspace api={api} /></AdminNavigationProvider>);
}
const closeDrawer = () => fireEvent.click(screen.getByRole('button', { name: /^(Close|关闭)$/ }));
// 用例挂载完整凭据抽屉（授权、Token、签名密钥页签），整轮并行时单例常超过 5 秒。
vi.setConfig({ testTimeout: 15000 });
afterEach(() => { cleanup(); history.replaceState({}, '', '/'); vi.restoreAllMocks(); });

test('深链恢复抽屉页签与两层筛选页码，关闭再换凭据清空下级上下文，一级列表查询仍保留', async () => {
  const api = client();
  mount(api as AdminApi, '?application=a1&tab=grants&tenantGrant=g1&filter.credentials.search=订单&filter.credentials.page=2&filter.tenantRelations.tenantId=t1&filter.tenantRelations.page=2&filter.userDelegations.employeeNo=E001&filter.userDelegations.page=3');
  await screen.findByRole('heading', { name: '租户 t1 · 人员委托' });
  expect(screen.getByRole('tab', { name: '授权租户与人员' }).getAttribute('aria-selected')).toBe('true');
  expect(api.mock.calls.some(([p]) => p === '/applications?page=2&pageSize=20&search=%E8%AE%A2%E5%8D%95')).toBe(true);
  expect(api.mock.calls.some(([p]) => p.includes('/tenant-grants?page=2&pageSize=20&tenantId=t1'))).toBe(true);
  await waitFor(() => expect(api.mock.calls.some(([p]) => p === '/applications/a1/tenant-grants/g1/users?page=3&pageSize=20&employeeNo=E001')).toBe(true));
  expect(screen.getByLabelText('已有委托工号（精确）')).toHaveProperty('value', 'E001');
  closeDrawer();
  expect(location.hash).not.toContain('tenantGrant'); expect(location.hash).not.toContain('tenantRelations');
  expect(location.hash).toContain('filter.credentials.page=2');
  fireEvent.click(await screen.findByRole('button', { name: `查看凭据 ${'b'.repeat(32)}` }));
  await screen.findByRole('heading', { name: '接入凭据' });
  expect(api.mock.calls.some(([p]) => p === '/applications/a2/tenant-grants/g1')).toBe(false);
});

test('抽屉页签可深链：地址 tab 选中对应页签，切换写回地址，概览不写 tab', async () => {
  const api = client(path => path.endsWith('/signing-key') ? { configured: true, key: null } : undefined);
  mount(api as AdminApi, '?application=a1&tab=signature');
  await screen.findByRole('heading', { name: '接入凭据' });
  expect(screen.getByRole('tab', { name: '签名密钥' }).getAttribute('aria-selected')).toBe('true');
  fireEvent.click(screen.getByRole('tab', { name: '操作记录' }));
  expect(location.hash).toContain('tab=audit');
  await waitFor(() => expect(api.mock.calls.some(([p]) => p.startsWith('/applications/a1/audit?'))).toBe(true));
  fireEvent.click(screen.getByRole('tab', { name: '概览' }));
  expect(location.hash).toContain('application=a1');
  expect(location.hash).not.toContain('tab=');
  await waitFor(() => expect(api.mock.calls.some(([p]) => p === '/applications/a1/tokens?page=1&pageSize=1&status=ACTIVE')).toBe(true));
  expect(within(screen.getByRole('region', { name: '凭据概览' })).getByText('有效 Token')).toBeTruthy();
});

test('主搜索框按名称或 AK 提交 search；Token 记录 ID 走单独输入框的 tokenId；完整 Token 不进入请求和地址', async () => {
  const api = client();
  mount(api as AdminApi, '');
  const search = await screen.findByLabelText('搜索凭据');
  for (const text of ['订单', 'b'.repeat(32)]) {
    fireEvent.change(search, { target: { value: text } });
    await waitFor(() => expect(api.mock.calls.some(([p]) => p === `/applications?page=1&pageSize=20&search=${encodeURIComponent(text)}`)).toBe(true));
    expect(new URLSearchParams(location.hash.split('?')[1]).get('filter.credentials.search')).toBe(text);
  }
  fireEvent.change(search, { target: { value: '' } });
  const tokenInput = screen.getByLabelText('Token 记录 ID');
  fireEvent.change(tokenInput, { target: { value: 'TOK_1' } });
  fireEvent.keyDown(tokenInput, { key: 'Enter', code: 'Enter', keyCode: 13 });
  fireEvent.keyUp(tokenInput, { key: 'Enter', code: 'Enter', keyCode: 13 });
  expect(api.mock.calls.some(([p]) => p.includes('tokenId=TOK_1&') || p.endsWith('tokenId=TOK_1'))).toBe(false);
  fireEvent.change(tokenInput, { target: { value: tokenRecord } });
  fireEvent.keyDown(tokenInput, { key: 'Enter', code: 'Enter', keyCode: 13 });
  fireEvent.keyUp(tokenInput, { key: 'Enter', code: 'Enter', keyCode: 13 });
  await waitFor(() => expect(api.mock.calls.some(([p]) => p.startsWith('/applications?') && p.includes(`tokenId=${tokenRecord}`))).toBe(true));
  expect(new URLSearchParams(location.hash.split('?')[1]).get('filter.credentials.tokenId')).toBe(tokenRecord);
  const raw = 'A'.repeat(20) + '-_' + 'b'.repeat(21);
  const before = api.mock.calls.length;
  fireEvent.change(search, { target: { value: raw } });
  fireEvent.keyDown(search, { key: 'Enter', code: 'Enter' });
  await new Promise(resolve => setTimeout(resolve, 400));
  expect(api.mock.calls.slice(before).some(([p]) => p.includes(encodeURIComponent(raw)) || p.includes(raw))).toBe(false);
  expect(location.hash).not.toContain(raw);
  expect(screen.getByText(/请在右侧“Token 记录 ID”中输入/)).toBeTruthy();
});

test('按 Token 记录 ID 定位命中后打开所属凭据的 Token 页签并定位该记录', async () => {
  const token = { tokenId: tokenRecord, applicationId: 'a1', appKey: app.appKey, tenantId: 't1', tenantName: '一号租户', scopeCodes: ['orders'], expiresAt: '2030-01-01T00:00:00Z', status: 'ACTIVE' };
  const api = client(path => {
    if (path.startsWith('/applications?') && path.includes('tokenId=TOK_')) return page([{ ...app, matchedTokenId: tokenRecord }]);
    if (path.includes('/tokens?')) return page(path.includes(`tokenId=${tokenRecord}`) ? [token] : []);
  });
  mount(api as AdminApi, `?filter.credentials.tokenId=${tokenRecord}`);
  await waitFor(() => expect(location.hash).toContain('application=a1'));
  expect(location.hash).toContain('tab=tokens');
  expect(screen.getByRole('tab', { name: 'Token' }).getAttribute('aria-selected')).toBe('true');
  await waitFor(() => expect(api.mock.calls.some(([p]) => p === `/applications/a1/tokens?page=1&pageSize=20&tokenId=${tokenRecord}`)).toBe(true));
  expect(screen.getByLabelText('Token 记录 ID（精确）')).toHaveProperty('value', tokenRecord);
  await screen.findByText('Token 详情与排障');
  expect((await screen.findAllByText('一号租户')).length).toBeGreaterThan(0);
  // 关闭凭据抽屉后不因同一搜索再次自动打开。
  fireEvent.click(within(screen.getByRole('dialog', { name: 'Token 详情与排障' })).getByRole('button', { name: /^(Close|关闭)$/ }));
  await waitFor(() => expect(screen.queryByText('Token 详情与排障')).toBeNull());
  closeDrawer();
  expect(location.hash).not.toContain('application=');
  await new Promise(resolve => setTimeout(resolve, 50));
  expect(location.hash).not.toContain('application=');
});

test('深链失败可重试，关闭人员面板后保持关系查询', async () => {
  let attempts = 0;
  const api = client(path => path.endsWith('/tenant-grants/g1') && ++attempts === 1 ? Promise.reject(new Error('关系读取失败')) : undefined);
  mount(api as AdminApi, '?application=a1&tab=grants&tenantGrant=g1&filter.tenantRelations.page=2');
  await screen.findByText('关系读取失败');
  fireEvent.click(screen.getByRole('button', { name: '重新加载' }));
  await screen.findByRole('heading', { name: '租户 t1 · 人员委托' });
  fireEvent.click(screen.getByRole('button', { name: '返回租户关联' }));
  expect(location.hash).toContain('filter.tenantRelations.page=2');
  expect(location.hash).not.toContain('tenantGrant');
  expect(screen.queryByRole('heading', { name: '租户 t1 · 人员委托' })).toBeNull();
});

test('权限选择跨页签保留；关闭提示未保存，保存中关闭及重复提交被阻止', async () => {
  let finish: ((value: Application) => void) | undefined;
  const api = client((path, options) => options?.method === 'PUT' && path.endsWith('/scopes') ? new Promise<Application>(resolve => { finish = resolve; }) : undefined);
  mount(api as AdminApi, '?application=a1&tab=scopes');
  fireEvent.click(await screen.findByLabelText('订单权限（orders）'));
  fireEvent.click(screen.getByRole('tab', { name: '授权租户与人员' }));
  fireEvent.click(screen.getByRole('tab', { name: '权限组' }));
  expect(screen.getByLabelText('订单权限（orders）')).toHaveProperty('checked', false);
  closeDrawer();
  await screen.findByText('离开前处理未保存更改');
  fireEvent.click(within(screen.getByRole('dialog', { name: '离开前处理未保存更改' })).getByRole('button', { name: '取消' }));
  fireEvent.click(screen.getByRole('button', { name: '保存应用 Scope' }));
  closeDrawer();
  expect(screen.queryByText('离开前处理未保存更改')).toBeNull();
  expect(location.hash).toContain('application=a1');
  expect(screen.getByRole('tab', { name: '授权租户与人员' }).getAttribute('aria-disabled')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: '保存应用 Scope' }));
  expect(api.mock.calls.filter(([,opts]) => opts?.method === 'PUT')).toHaveLength(1);
  await act(async () => finish?.({ ...app, scopeCodes: [] }));
  await screen.findByText('凭据调用权限已保存。');
  closeDrawer();
  await waitFor(() => expect(location.hash).not.toContain('application='));
  expect(screen.queryByText('离开前处理未保存更改')).toBeNull();
});

test('租户备注行内保存冲突保留输入，读取新修订后重新保存',async()=>{
 let current={...grant};let writes=0;
 const api=client((path,options)=>{
  if(path.endsWith('/g1/note')){writes++;if(writes===1){current={...grant,note:'另一人修改',noteRevision:2};return Promise.reject(new AdminApiError('备注已变化',409))}expect(options?.body).toEqual({note:'本地用途',expectedRevision:2});current={...current,note:'本地用途',noteRevision:3};return current}
  if(path.endsWith('/tenant-grants/g1'))return current;
  if(path.includes('/tenant-grants?'))return page([current]);
 });
 mount(api as AdminApi,'?application=a1&tab=grants');
 fireEvent.click(await screen.findByRole('button',{name:'编辑备注 t1'}));fireEvent.change(screen.getByLabelText('本租户备注 t1'),{target:{value:'本地用途'}});fireEvent.click(screen.getByRole('button',{name:'保存备注'}));
 await screen.findByRole('button',{name:'读取最新备注并保留输入'});expect(screen.getByLabelText('本租户备注 t1')).toHaveProperty('value','本地用途');expect(screen.getByRole('button',{name:'保存备注'})).toHaveProperty('disabled',true);
 fireEvent.click(screen.getByRole('button',{name:'读取最新备注并保留输入'}));await waitFor(()=>expect(screen.getByRole('button',{name:'保存备注'})).toHaveProperty('disabled',false));expect(screen.getByLabelText('本租户备注 t1')).toHaveProperty('value','本地用途');fireEvent.click(screen.getByRole('button',{name:'保存备注'}));await screen.findByText('本租户备注已保存，授权保持不变。');expect(writes).toBe(2);
});

test('凭据详情以AK识别，不再展示或编辑公共名称', async () => {
 const api=client();
 mount(api as AdminApi,'?application=a1');
 await screen.findByRole('heading',{name:'接入凭据'});
 await screen.findAllByText(app.appKey);
 expect(screen.queryByText(app.name,{exact:true})).toBeNull();
 expect(screen.queryByRole('button',{name:'编辑全局名称'})).toBeNull();
});

test('人员选择返回关系时提醒未完成操作，取消离开与页签切换都保留输入',async()=>{
 const api=client();
 mount(api as AdminApi,'?application=a1&tab=grants&tenantGrant=g1');
 fireEvent.change(await screen.findByLabelText('委托员工号'),{target:{value:'UNSAVED-EMPLOYEE'}});
 fireEvent.click(screen.getByRole('tab',{name:'权限组'}));fireEvent.click(screen.getByRole('tab',{name:'授权租户与人员'}));
 expect(screen.getByLabelText('委托员工号')).toHaveProperty('value','UNSAVED-EMPLOYEE');
 fireEvent.click(screen.getByRole('button',{name:'返回租户关联'}));await screen.findByText('离开前处理未保存更改');
 expect(location.hash).toContain('tenantGrant=g1');
 expect(screen.queryByRole('button',{name:'保存并离开'})).toBeNull();
 expect(screen.getByLabelText('委托员工号')).toHaveProperty('value','UNSAVED-EMPLOYEE');
});

test('人员写入等待期间不能关闭租户关系或整个凭据',async()=>{
 let finish!:(value:unknown)=>void;const pending=new Promise(resolve=>{finish=resolve});
 const api=client((path,options)=>path.endsWith('/employee-lookup')?{tenantId:'t1',employeeNo:'E001',employeeId:'e1',userId:'u1',displayName:'张三',enabled:true}:path.includes('/users?')?page([]):path==='/tenant-grants/g1/users'&&options?.method==='POST'?pending:undefined);
 mount(api as AdminApi,'?application=a1&tab=grants&tenantGrant=g1');fireEvent.change(await screen.findByLabelText('委托员工号'),{target:{value:'E001'}});fireEvent.click(screen.getByRole('button',{name:'核验员工'}));
 fireEvent.click(await screen.findByRole('button',{name:'确认建立委托'}));
 await waitFor(()=>expect(screen.getByRole('button',{name:'返回租户关联'})).toHaveProperty('disabled',true));
 closeDrawer();expect(location.hash).toContain('application=a1');expect(screen.queryByText('离开前处理未保存更改')).toBeNull();
 await act(async()=>finish({}));await screen.findByText('张三（E001）的委托已建立。');expect(screen.getByRole('button',{name:'返回租户关联'})).toHaveProperty('disabled',false);
});

test('权限跨分页选择、绑定表单跨页签保留，关闭不会直接卸载未提交输入',async()=>{
 const api=client(path=>path.startsWith('/scopes?')?page(path.includes('page=2')?[{id:'s2',code:'products',name:'商品权限',enabled:true}]:[{id:'s1',code:'orders',name:'订单权限',enabled:true}],21):undefined);
 mount(api as AdminApi,'?application=a1&tab=scopes');await screen.findByLabelText('订单权限（orders）');fireEvent.click(within(screen.getByRole('region',{name:'应用Scope选择'})).getByTitle(/下一页|Next Page/));fireEvent.click(await screen.findByLabelText('商品权限（products）'));expect(screen.getByRole('button',{name:'移除权限 orders'})).toBeTruthy();expect(screen.getByRole('button',{name:'移除权限 products'})).toBeTruthy();
 fireEvent.click(screen.getByRole('tab',{name:'授权租户与人员'}));fireEvent.click(screen.getByRole('button',{name:'绑定租户'}));fireEvent.change(screen.getByLabelText('目标租户 ID'),{target:{value:'other-tenant'}});fireEvent.click(screen.getByRole('tab',{name:'权限组'}));fireEvent.click(screen.getByRole('tab',{name:'授权租户与人员'}));expect(screen.getByLabelText('目标租户 ID')).toHaveProperty('value','other-tenant');closeDrawer();await screen.findByText('离开前处理未保存更改');expect(screen.getByLabelText('目标租户 ID')).toHaveProperty('value','other-tenant');
});

test('历史关联均撤销时概览提示缺少有效调用租户，绑定后刷新摘要解除缺项',async()=>{
 let active=false;
 const api=client((path,options)=>{
  if(path==='/applications/a1')return {...app,activeTenantGrantCount:active?1:0};
  if(path==='/tenant-grants'&&options?.method==='POST'){active=true;return grant}
  if(path.includes('/tenant-grants?'))return page([{...grant,status:active?'ACTIVE':'REVOKED'}]);
 });
 mount(api as AdminApi,'?application=a1');fireEvent.click(await screen.findByRole('button',{name:'无有效调用租户 · 去绑定'}));expect(location.hash).toContain('tab=grants');fireEvent.click(screen.getByRole('button',{name:'绑定租户'}));fireEvent.change(screen.getByLabelText('目标租户 ID'),{target:{value:'t1'}});fireEvent.change(screen.getByLabelText('应用 AppSecret'),{target:{value:'fake-secret'}});fireEvent.click(screen.getByRole('button',{name:'校验并绑定'}));await screen.findByText('租户已绑定。');await waitFor(()=>expect(screen.queryByRole('button',{name:'无有效调用租户 · 去绑定'})).toBeNull());
});

test('签名一次交付和Token筛选输入跨页签保留，离开前清楚提示秘密丢失',async()=>{
 const signing={keyId:'key-82',applicationId:'a1',revision:1,status:'ACTIVE',createdAt:'2026-09-27T00:00:00Z',changedAt:'2026-09-27T00:00:00Z'};
 let generated=false;
 const api=client((path,options)=>{
  if(path.endsWith('/signing-key')){if(options?.method==='POST'){generated=true;return {key:signing,signingSecret:'only-82-memory'}}return {configured:true,key:generated?signing:null};}
  if(path.includes('/tokens?'))return page([]);
 });
 mount(api as AdminApi,'?application=a1&tab=tokens');
 fireEvent.change(await screen.findByLabelText('员工号（精确）'),{target:{value:'E1001'}});
 fireEvent.click(screen.getByRole('tab',{name:'签名密钥'}));
 fireEvent.click(await screen.findByRole('button',{name:'生成签名密钥'}));
 fireEvent.click(await screen.findByRole('button',{name:'确认生成'}));
 await screen.findByText('only-82-memory');
 fireEvent.click(screen.getByRole('tab',{name:'Token'}));
 expect(screen.getByLabelText('员工号（精确）')).toHaveProperty('value','E1001');
 fireEvent.click(screen.getByRole('tab',{name:'签名密钥'}));
 expect(screen.getByText('only-82-memory')).toBeTruthy();
 closeDrawer();
 await screen.findByText(/SigningSecret仅本次显示，离开此凭据将丢失本次交付/);
 expect(screen.queryByRole('button',{name:'保存后继续'})).toBeNull();
});

test('解绑租户先说明只影响该租户及其人员授权，确认后才撤销并刷新凭据摘要',async()=>{
 const api=client((path,options)=>path==='/tenant-grants/g1'&&options?.method==='DELETE'?null:undefined);
 mount(api as AdminApi,'?application=a1&tab=grants');
 fireEvent.click(await screen.findByRole('button',{name:'解绑 t1'}));
 const confirm=await screen.findByRole('tooltip');
 expect(within(confirm).getByText(/该租户人员授权同时停止生效，其他租户不受影响/)).toBeTruthy();
 expect(api.mock.calls.some(([,options])=>options?.method==='DELETE')).toBe(false);
 const reads=api.mock.calls.filter(([path])=>path==='/applications/a1').length;
 fireEvent.click(within(confirm).getByRole('button',{name:'确认解绑'}));
 await screen.findByText('租户关联已撤销。');
 expect(api.mock.calls.filter(([path,options])=>path==='/tenant-grants/g1'&&options?.method==='DELETE')).toHaveLength(1);
 expect(api.mock.calls.filter(([path])=>path==='/applications/a1').length).toBeGreaterThan(reads);
});

test('凭据关联规则按当前页批量查询，点击按完整AK定位规则并清除旧API条件', async () => {
  const api = client(path => path.startsWith('/governance-rules/association-counts?') ? { a1: 2 } : undefined);
  mount(api as AdminApi, '?filter.governanceRules.apiId=old-api&filter.governanceRules.mode=OBSERVE');
  const link = await screen.findByRole('button', { name: '查看 2 条关联规则' });
  const requests = api.mock.calls.filter(([path]) => path.startsWith('/governance-rules/association-counts?'));
  expect(requests).toHaveLength(1);
  const request = new URL(requests[0][0], 'https://test');
  expect(request.searchParams.get('targetType')).toBe('APPLICATION');
  expect(request.searchParams.getAll('targetId')).toEqual(['a1', 'a2']);
  fireEvent.click(link);
  const params = new URLSearchParams(location.hash.split('?')[1]);
  expect(location.hash).toContain('/traffic-rules');
  expect(params.get('filter.governanceRules.appKey')).toBe(app.appKey);
  expect(params.has('filter.governanceRules.apiId')).toBe(false);
  expect(params.has('filter.governanceRules.mode')).toBe(false);
});
