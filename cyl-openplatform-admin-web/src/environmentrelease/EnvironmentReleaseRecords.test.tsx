import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { createAdminApi } from '../access/api';
import { AdminNavigationProvider } from '../navigation/AdminNavigation';
import EnvironmentReleaseRecords from './EnvironmentReleaseRecords';
import { transferProgress } from './transferProgress';
import type { Receipt, Target, TransferSummary } from './types';

const ok = (data: unknown) => Response.json({ code: 200, data });
const target: Target = { id: 'prod', name: '生产', nodeIds: ['a', 'b'] };
const receipt: Receipt = { environmentId: 'prod', nodeId: 'a', sourceEnvironment: 'test', transferId: 'transfer-1', apiId: 'api1', releaseId: 'target-r1', draftRevision: 1, status: 'APPLIED', auditRequired: false, liveReleaseId: 'target-r1', enabled: true, stateVersion: 2, observedAt: '2026-09-14T08:00:00Z' };
const summary: TransferSummary = { id: 'transfer-1', sourceEnvironment: 'test', sourceReleaseId: 'source-r1', targetId: 'prod', service: 'orders', version: 'v1', method: 'query', deliveryState: 'ACCEPTED', receipt, error: null, observations: [{ nodeId: 'a', receipt, error: null, observedAt: receipt.observedAt }, { nodeId: 'b', receipt: { ...receipt, nodeId: 'b' }, error: null, observedAt: receipt.observedAt }], createdAt: receipt.observedAt, updatedAt: receipt.observedAt };
const detail = { ...summary, request: { sourceEnvironment: 'test', sourceReleaseId: 'source-r1', targetEnvironment: 'prod' }, version: 1 };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
/** antd 下拉：按可访问名称打开，再点选可见选项。 */
async function choose(label: string, option: string) {
  fireEvent.mouseDown(await screen.findByRole('combobox', { name: label }));
  const options = await screen.findAllByText(option, { selector: '.ant-select-item-option-content' });
  fireEvent.click(options[options.length - 1]);
}

test('全局列表一次分页投影分列事实，不逐行远程查询；只读详情与返回保持条件页码', async () => {
  window.history.replaceState({}, '', '/#/transfers?filter.transfers.query=prod&filter.transfers.page=2');
  const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => url.endsWith('/targets') ? ok([target]) : url.endsWith('/transfer-1') ? ok(detail) : ok({ items: [summary], total: 21 }));
  vi.stubGlobal('fetch', fetchMock);
  render(<AdminNavigationProvider><EnvironmentReleaseRecords api={createAdminApi('csrf', vi.fn())} permissions={['REVIEW_APIS']} pendingTransfers={new Map()} /></AdminNavigationProvider>);
  await screen.findByText('全部节点配置与开关一致');
  expect(fetchMock.mock.calls.some(([url]) => url.includes('/environment-releases?page=2&pageSize=20&query=prod'))).toBe(true);
  expect(screen.getByRole('textbox', { name: '搜索 API service 或目标环境' })).toHaveProperty('value', 'prod');
  for (const name of ['发送 / 接收', '目标审核', '目标配置', '目标开关', '节点观测']) expect(screen.getByRole('columnheader', { name: new RegExp(name) })).toBeTruthy();
  expect(screen.getByText('无需审核')).toBeTruthy();
  expect(screen.queryByText('目标审核通过')).toBeNull();
  expect(fetchMock.mock.calls.some(([url]) => url.endsWith('/transfer-1'))).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '查看进度' }));
  await screen.findByRole('region', { name: '传输详情' });
  expect(screen.queryByRole('button', { name: '刷新目标状态' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /^(Close|关闭)$/ }));
  expect(window.location.hash).toContain('filter.transfers.page=2');
  expect(window.location.hash).toContain('filter.transfers.query=prod');
  expect(window.location.hash).not.toContain('transfer=');
  expect(fetchMock.mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true);
});

test.each(['缺节点', '重复观测', '修订不一致', '来源环境未知'])('%s不能声称全部节点已生效', reason => {
  const value = { ...summary, observations: summary.observations.map(item => ({ ...item })) };
  if (reason === '缺节点') value.observations.pop();
  if (reason === '重复观测') value.observations.push(value.observations[0]);
  if (reason === '修订不一致') value.observations[1].receipt = { ...receipt, nodeId: 'b', draftRevision: 2 };
  if (reason === '来源环境未知') value.sourceEnvironment = null;
  expect(transferProgress(value, target).ready).toBe(false);
  expect(transferProgress(value, target).complete).toBe(false);
  expect(transferProgress(summary, { ...target, nodeIds: [] }).ready).toBe(false);
});

test('全部节点加载且停用时只报告配置一致，不能报告可调用', () => {
  const value = { ...summary, receipt: { ...receipt, enabled: false }, observations: summary.observations.map(item => ({ ...item, receipt: { ...item.receipt!, enabled: false } })) };
  const progress = transferProgress(value, target);
  expect(progress.complete).toBe(true); expect(progress.ready).toBe(false);
  expect(progress.observation).toBe('全部节点已加载 · 当前停用');
});

test('全局未知申请先查原ID，网络失败后再次查询才可原文重试', async () => {
  window.history.replaceState({}, '', '/#/transfers');
  const body = '{"transferId":"transfer-1","releaseId":"source-r1","targetId":"prod","expectedRevision":9007199254740993,"previewDigest":"digest","comment":"原文"}';
  const pendingTransfers = new Map([['api:api1', body]]);
  let writes = 0;
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/targets')) return ok([target]);
    if (url.endsWith('/transfer-1')) return Response.json({ code: 404, resultMsg: '暂未记录' }, { status: 404 });
    if (init?.method === 'POST') { if (++writes === 1) throw new TypeError('lost'); return ok(detail); }
    return ok({ items: [], total: 0 });
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<AdminNavigationProvider><EnvironmentReleaseRecords api={createAdminApi('csrf', vi.fn())} permissions={['PUBLISH_APIS']} pendingTransfers={pendingTransfers} /></AdminNavigationProvider>);
  fireEvent.click(await screen.findByRole('button', { name: '查询原传输' }));
  fireEvent.click(await screen.findByRole('button', { name: '用原编号和正文重试' }));
  await screen.findByText(/未收到操作结果/);
  expect(screen.queryByRole('button', { name: '用原编号和正文重试' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '重新加载' }));
  fireEvent.click(await screen.findByRole('button', { name: '用原编号和正文重试' }));
  await waitFor(() => expect(pendingTransfers.size).toBe(0));
  const posts = fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST');
  expect(posts).toHaveLength(2); expect(posts[0][1]?.body).toBe(body); expect(posts[1][1]?.body).toBe(body);
});

test('发送工作区预览进行中同步离页保护，不能确认放弃在途操作', async()=>{
  window.history.replaceState({},'', '/#/transfers?transfer=new&release=r1');
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>{
    if(url.endsWith('/targets'))return ok([target]);
    if(url.endsWith('/preview'))return new Promise<Response>(()=>{});
    if(url.endsWith('/publications/r1'))return ok({id:'r1',apiId:'api1',name:'固定订单',draftRevision:3,snapshot:{id:'api1',name:'固定订单',service:'orders',version:'v1',method:'query',draftRevision:3,scopeCodes:[],binding:{protocol:'HTTP'}}});
    return ok({items:[],total:0});
  }));
  render(<AdminNavigationProvider><EnvironmentReleaseRecords api={createAdminApi('csrf',vi.fn())} permissions={['PUBLISH_APIS']} pendingTransfers={new Map()}/></AdminNavigationProvider>);
  await screen.findByText('固定订单',{selector:'strong'});
  await choose('目标环境','生产（prod）');
  fireEvent.click(screen.getByRole('button',{name:'预览目标差异'}));
  fireEvent.click(screen.getByRole('button',{name:'返回发布记录'}));
  const leave=await screen.findByRole('button',{name:'放弃更改并离开'});
  await waitFor(()=>expect(leave.matches(':disabled')).toBe(true));
  expect(window.location.hash).toContain('transfer=new');
});

test('发送成功返回记录时自动重读列表，保持原筛选和页码',async()=>{
 window.history.replaceState({},'', '/#/transfers?transfer=new&release=r1&filter.transfers.query=orders&filter.transfers.page=2');
 const snapshot={id:'api1',name:'固定订单',service:'orders',version:'v1',method:'query',draftRevision:3,category:'订单',owner:'owner',binding:{protocol:'HTTP'},scopeCodes:[],mappings:[],errorDefinitions:[],requestSchema:{type:'OBJECT',properties:{}},responseSchema:{type:'OBJECT',properties:{}}};
 const fetchMock=vi.fn(async(url:string,init?:RequestInit)=>{
   if(url.endsWith('/targets'))return ok([target]);
   if(url.endsWith('/publications/r1'))return ok({id:'r1',apiId:'api1',name:'固定订单',draftRevision:3,snapshot});
   if(url.endsWith('/preview'))return ok({environmentId:'prod',nodeId:'a',definition:snapshot,before:null,change:'CREATE',expectedRevision:0,changedFields:[],previewDigest:'digest',auditRequired:true});
   if(init?.method==='POST')return ok(detail);
   return ok({items:[],total:0});
 });
 vi.stubGlobal('fetch',fetchMock);
 render(<AdminNavigationProvider><EnvironmentReleaseRecords api={createAdminApi('csrf',vi.fn())} permissions={['PUBLISH_APIS']} pendingTransfers={new Map()}/></AdminNavigationProvider>);
 await screen.findByText('固定订单',{selector:'strong'});
 await choose('目标环境','生产（prod）');
 fireEvent.click(screen.getByRole('button',{name:'预览目标差异'}));
 fireEvent.click(await screen.findByRole('button',{name:'核对跨环境发送'}));
 fireEvent.click(screen.getByRole('button',{name:'确认跨环境发送'}));
 await screen.findByText('已取得目标回执');
 const count=()=>fetchMock.mock.calls.filter(([url])=>url.includes('/environment-releases?')).length;
 const before=count();
 const callsBefore=fetchMock.mock.calls.length;
 fireEvent.click(screen.getByRole('button',{name:'返回发布记录'}));
 await waitFor(()=>expect(count()).toBeGreaterThan(before));
 expect(window.location.hash).toContain('filter.transfers.query=orders');
 expect(window.location.hash).toContain('filter.transfers.page=2');
 expect(fetchMock.mock.calls.slice(callsBefore).some(([url])=>url.includes('/environment-releases?page=2&pageSize=20&query=orders'))).toBe(true);
});

test('当前记录入口只读详情不发送，刷新后才根据真实节点确认生效',async()=>{
 window.history.replaceState({},'', '/#/transfers?transfer=transfer-1');
 const fetchMock=vi.fn(async(url:string,init?:RequestInit)=>url.endsWith('/targets')?ok([target]):url.includes('/environment-releases?')?ok({items:[summary],total:1}):ok(init?.method==='POST'?detail:{...detail,observations:[]}));
 vi.stubGlobal('fetch',fetchMock);
 render(<AdminNavigationProvider><EnvironmentReleaseRecords api={createAdminApi('csrf',vi.fn())} permissions={['PUBLISH_APIS']} pendingTransfers={new Map()}/></AdminNavigationProvider>);
 await screen.findByRole('region',{name:'传输详情'});
 expect(screen.getByText('尚未确认全部目标节点当前生效')).toBeTruthy();
 expect(fetchMock.mock.calls.some(([,init])=>init?.method==='POST')).toBe(false);
 fireEvent.click(screen.getByRole('button',{name:'刷新目标状态'}));
 await screen.findByText('全部目标节点当前已生效');
 expect(fetchMock.mock.calls.filter(([,init])=>init?.method==='POST')).toHaveLength(1);
});

test('记录刷新中节点不可达或已停用，不以APPLIED宣称全部生效',async()=>{
 window.history.replaceState({},'', '/#/transfers?transfer=transfer-1');let refresh=0;
 vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>{
  if(url.endsWith('/targets'))return ok([target]);
  if(url.includes('/environment-releases?'))return ok({items:[summary],total:1});
  if(init?.method==='POST')return ok({...detail,observations:[summary.observations[0],++refresh===1?{nodeId:'b',receipt:null,error:'连接超时',observedAt:receipt.observedAt}:{nodeId:'b',receipt:{...receipt,nodeId:'b',enabled:false},error:null,observedAt:receipt.observedAt}]});
  return ok({...detail,observations:[]});
 }));
 render(<AdminNavigationProvider><EnvironmentReleaseRecords api={createAdminApi('csrf',vi.fn())} permissions={['PUBLISH_APIS']} pendingTransfers={new Map()}/></AdminNavigationProvider>);
 fireEvent.click(await screen.findByRole('button',{name:'刷新目标状态'}));await screen.findByText('连接超时');
 expect(screen.queryByText('全部目标节点当前已生效')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'刷新目标状态'}));await screen.findByText('API 已停用');
 expect(screen.queryByText('全部目标节点当前已生效')).toBeNull();
});
