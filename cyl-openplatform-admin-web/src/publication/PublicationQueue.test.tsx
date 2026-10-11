import { PlatformTheme } from '@cyl/open-platform-web-shared/ui/PlatformTheme';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { createAdminApi } from '../access/api';
import { AdminNavigationProvider } from '../navigation/AdminNavigation';
import PublicationPanel from './PublicationPanel';

const ok = (data: unknown) => Response.json({ code: 200, data });
const definition = { id: 'api1', name: '订单查询', service: 'orders', version: 'v1', method: 'query', protocol: 'HTTP', draftRevision: 2, owner: '研发', category: '订单', scopeCodes: [], requestSchema: { type: 'OBJECT', properties: {} }, responseSchema: { type: 'OBJECT', properties: {} }, description: '新版文档', errorDefinitions: [], binding: { protocol: 'HTTP' }, mappings: [] };
const release = { id: 'release-2', apiId: 'api1', name: '订单查询', service: 'orders', version: 'v1', method: 'query', draftRevision: 2, auditRequired: true, status: 'APPLIED', submittedByEmployeeNo: 'E1', submittedByTenantId: 't1', submittedAt: '2026-09-14T08:00:00Z', comment: '更新文档', reviewComment: '通过', snapshot: definition, baselineKnown: true, baseline: { ...definition, draftRevision: 1, description: '旧版文档' } };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

test('审核通过使用真实组合筛选，打开固定差异与返回保留URL条件和页码', async () => {
  window.history.replaceState({}, '', '/#/publications?query=orders&pageNo=2&releaseResult=APPROVED');
  const fetchMock = vi.fn(async (url: string) => {
    if (url.endsWith('/incoming/release-2')) return ok(null);
    if (url.endsWith('/publications/release-2')) return ok(release);
    if (url.endsWith('/state')) return ok({ apiId: 'api1', enabled: false, liveReleaseId: 'release-2', pendingReleaseId: null, stateVersion: 3 });
    return ok({ items: [release], total: 21, page: 2, pageSize: 20 });
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<PlatformTheme><AdminNavigationProvider><PublicationPanel api={createAdminApi('csrf', vi.fn())} permissions={['REVIEW_APIS']} pendingSubmissions={new Map()} /></AdminNavigationProvider></PlatformTheme>);
  const open = await screen.findByRole('button', { name: '查看固定快照与差异' });
  expect(document.querySelector('time')?.textContent).toBe(new Date(release.submittedAt).toLocaleString('zh-CN', { hour12: false }));
  fireEvent.click(open);
  expect(await screen.findByRole('region', { name: '基本信息变更' })).toHaveProperty('textContent', expect.stringContaining('接口说明'));
  expect(screen.getByText('旧版文档')).toBeTruthy();
  expect(screen.getByText('新版文档')).toBeTruthy();
  const drawer = screen.getByRole('dialog');
  expect(drawer.querySelector('time')?.getAttribute('datetime')).toBe(release.submittedAt);
  expect(within(drawer).getByText(new Date(release.submittedAt).toLocaleString('zh-CN', { hour12: false }))).toBeTruthy();
  expect(within(drawer).getByText('工号 E1')).toBeTruthy();
  expect(screen.getByText('旧版文档', { selector: '.diff-scalar' })).toBeTruthy();
  expect(window.location.hash).toContain('release=release-2');
  expect(window.location.hash).toContain('releaseResult=APPROVED');
  expect(fetchMock.mock.calls.some(([url]) => url.includes('page=2&pageSize=20&query=orders&status=APPLIED&auditRequired=true'))).toBe(true);
  expect(fetchMock.mock.calls.some(([url]) => url === '/admin-api/apis/api1')).toBe(false);
  fireEvent.click(within(screen.getByRole('group', { name: '审核操作' })).getByRole('button', { name: '关闭' }));
  await waitFor(() => expect(window.location.hash).not.toContain('release='));
  expect(window.location.hash).toContain('pageNo=2');
  expect(within(screen.getByRole('table')).getByText('审核通过')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '清除全部' }));
  await waitFor(() => expect(window.location.hash).not.toContain('pageNo='));
  expect(window.location.hash).not.toContain('releaseResult');
});

test('免审结果独立筛选且可点击释义；历史未知基线不冒充首次发布', async () => {
  window.history.replaceState({}, '', '/#/publications');
  const fetchMock = vi.fn(async (url: string) => url.includes('/incoming/') ? ok(null) : url.endsWith('/publications/release-2') ? ok({ ...release, baseline: null, baselineKnown: false }) : url.endsWith('/state') ? ok({ enabled: true, liveReleaseId: 'release-2' }) : ok({ items: [release], total: 1 }));
  vi.stubGlobal('fetch', fetchMock);
  render(<PlatformTheme><AdminNavigationProvider><PublicationPanel api={createAdminApi('csrf', vi.fn())} permissions={['MANAGE_APIS']} pendingSubmissions={new Map()} /></AdminNavigationProvider></PlatformTheme>);
  await screen.findByRole('button', { name: '查看固定快照与差异' });
  const help = screen.getByRole('button', { name: '审核结果说明' }); help.focus();
  expect(document.activeElement).toBe(help); fireEvent.click(help);
  expect(await screen.findByRole('tooltip')).toHaveProperty('textContent',expect.stringContaining('免审生效'));
  fireEvent.click(help);
  fireEvent.mouseDown(screen.getByRole('combobox',{name:'结果'}));
  fireEvent.click(await screen.findByText('免审生效',{selector:'.ant-select-item-option-content'}));
  await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url.includes('status=APPLIED&auditRequired=false'))).toBe(true));
  fireEvent.click(await screen.findByRole('button', { name: '查看固定快照与差异' }));
  await screen.findByText(/这条历史记录未保存提交时基线/);
  expect(screen.queryByText('首次发布，无基线')).toBeNull();
  expect(screen.queryByRole('button', { name: '通过审核' })).toBeNull();
});

test('发布角色深链读取完整候选，刷新保留备注并直接提交当前修订一次',async()=>{
  window.history.replaceState({},'', '/#/publications?api=api1&query=orders&releaseResult=ALL&pageNo=2');
  let candidate=definition;let pending=false;const notes=new Map<string,string>();
  const request=vi.fn(async(url:string,init?:RequestInit)=>{
    if(url.endsWith('/candidate'))return ok(candidate);
    if(url.endsWith('/config'))return ok({auditEnabled:true});
    if(url.endsWith('/state'))return ok({apiId:'api1',enabled:false,liveReleaseId:'old',pendingReleaseId:pending?'new-release':null,stateVersion:3});
    if(url.endsWith('/effective'))return ok({apiId:'api1',releaseId:'old',snapshot:{...definition,draftRevision:1,description:'旧版文档'}});
    if(url.endsWith('/submissions')&&init?.method==='POST'){pending=true;return ok({...release,id:'new-release',status:'PENDING',draftRevision:3,snapshot:candidate});}
    if(url.endsWith('/new-release'))return ok({...release,id:'new-release',status:'PENDING',draftRevision:3,snapshot:candidate});
    return ok({items:[],total:0,page:1,pageSize:20});
  });vi.stubGlobal('fetch',request);
  const mount=()=>render(<PlatformTheme><AdminNavigationProvider><PublicationPanel api={createAdminApi('csrf',vi.fn())} permissions={['PUBLISH_APIS']} publicationNotes={notes} pendingSubmissions={new Map()}/></AdminNavigationProvider></PlatformTheme>);
  const firstView=mount();
  await screen.findByText('新版文档');fireEvent.change(screen.getByLabelText('发布备注'),{target:{value:'保留审核备注'}});
  expect(notes.get('publish:api1')).toBe('保留审核备注');
  firstView.unmount();mount();
  expect(await screen.findByLabelText('发布备注')).toHaveProperty('value','保留审核备注');
  candidate={...definition,draftRevision:3,description:'更新后的候选'};
  const refresh=screen.getByRole('button',{name:'刷新发布状态'});await waitFor(()=>expect(refresh).toHaveProperty('disabled',false));fireEvent.click(refresh);
  await screen.findByText('更新后的候选');expect(screen.getByLabelText('发布备注')).toHaveProperty('value','保留审核备注');
  const submit=screen.getByRole('button',{name:'提交审核'});
  await waitFor(()=>expect(submit).toHaveProperty('disabled',false));fireEvent.click(submit);fireEvent.click(submit);
  await screen.findByText(/提交结果：待审核/);expect(notes.size).toBe(0);
  const writes=request.mock.calls.filter(([url,init])=>url.endsWith('/submissions')&&init?.method==='POST');
  expect(writes).toHaveLength(1);expect(JSON.parse(String(writes[0][1]?.body))).toMatchObject({expectedDraftRevision:3,expectedStateVersion:3,comment:'保留审核备注'});
  expect(request.mock.calls.some(([url])=>url==='/admin-api/apis/api1')).toBe(false);
});

test('未提交审核意见返回队列后保留，成功审核后清除',async()=>{
  window.history.replaceState({},'', '/#/publications?release=release-2&query=orders');
  const notes=new Map<string,string>();let status='PENDING';
  vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>{
    if(url.endsWith('/approve')&&init?.method==='POST'){status='APPLIED';return ok({...release,status});}
    if(url.includes('/incoming/'))return ok(null);
    if(url.endsWith('/publications/release-2'))return ok({...release,status,baselineStateVersion:1});
    if(url.endsWith('/state'))return ok({apiId:'api1',enabled:true,stateVersion:1,pendingReleaseId:status==='PENDING'?'release-2':null});
    return ok({items:[{...release,status}],total:1,page:1,pageSize:20});
  }));
  render(<PlatformTheme><AdminNavigationProvider><PublicationPanel api={createAdminApi('csrf',vi.fn())} permissions={['REVIEW_APIS']} pendingSubmissions={new Map()} publicationNotes={notes}/></AdminNavigationProvider></PlatformTheme>);
  fireEvent.change(await screen.findByLabelText('审核意见'),{target:{value:'已核对返回结构'}});
  fireEvent.click(within(screen.getByRole('group',{name:'审核操作'})).getByRole('button',{name:'关闭'}));
  await waitFor(()=>expect(window.location.hash).not.toContain('release='));
  fireEvent.click(await screen.findByRole('button',{name:'查看固定快照与差异'}));
  expect(await screen.findByLabelText('审核意见')).toHaveProperty('value','已核对返回结构');
  const approve=screen.getByRole('button',{name:'通过审核'});
  await waitFor(()=>expect(approve).toHaveProperty('disabled',false));fireEvent.click(approve);
  await waitFor(()=>expect(notes.size).toBe(0));
});

test('审核发出后离开，成功响应仍清除该次意见',async()=>{
  window.history.replaceState({},'', '/#/publications?release=release-2');
  const notes=new Map<string,string>();let finish:(value:Response)=>void=()=>{};
  const request=vi.fn(async(url:string,init?:RequestInit)=>{
    if(url.endsWith('/approve')&&init?.method==='POST')return new Promise<Response>(resolve=>{finish=resolve});
    if(url.includes('/incoming/'))return ok(null);
    if(url.endsWith('/publications/release-2'))return ok({...release,status:'PENDING',baselineStateVersion:1});
    if(url.endsWith('/state'))return ok({apiId:'api1',enabled:true,stateVersion:1,pendingReleaseId:'release-2'});
    return ok({items:[],total:0});
  });vi.stubGlobal('fetch',request);
  const view=render(<PlatformTheme><AdminNavigationProvider><PublicationPanel api={createAdminApi('csrf',vi.fn())} permissions={['REVIEW_APIS']} pendingSubmissions={new Map()} publicationNotes={notes}/></AdminNavigationProvider></PlatformTheme>);
  fireEvent.change(await screen.findByLabelText('审核意见'),{target:{value:'已核对'}});
  const approve=screen.getByRole('button',{name:'通过审核'});await waitFor(()=>expect(approve).toHaveProperty('disabled',false));fireEvent.click(approve);
  await waitFor(()=>expect(request.mock.calls.some(([url])=>url.endsWith('/approve'))).toBe(true));
  view.unmount();finish(ok(release));await waitFor(()=>expect(notes.size).toBe(0));
});
