import {StrictMode} from 'react';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,test,vi} from 'vitest';
import {AdminNavigationProvider} from '../navigation/AdminNavigation';
import {PlatformTheme} from '@cyl/open-platform-web-shared/ui/PlatformTheme';
import {ApiError,type ApiClient} from '@cyl/open-platform-web-shared/http';
import {parseJson} from '@cyl/open-platform-web-shared/json';
import SdkAssetsPanel from './SdkAssetsPanel';
const asset={id:'SDK_00000000000000000000000000000088',kind:'PLATFORM',apiId:null,releaseId:null,service:null,version:null,method:null,name:'开放平台 Java SDK',sdkVersion:'88.1',language:'JAVA',gatewayProtocol:'HTTP_JSON_BEARER_V1',runtime:'Java 8+',releaseNotes:'Bearer 与人员Token',status:'DRAFT',revision:1,sha256:null as string|null,sizeBytes:null as number|null,createdAt:'',publishedAt:null};
const archive={manifest:{sdkVersion:asset.sdkVersion,language:asset.language,gatewayProtocol:asset.gatewayProtocol,runtime:asset.runtime},sha256:'a'.repeat(64),sizeBytes:4};
const uploaded={...asset,revision:2,sha256:archive.sha256,sizeBytes:4};
const page=(items:unknown[]=[])=>({items,total:items.length,page:1,pageSize:20});
const ok=(data:unknown)=>Response.json({code:200,data});
function mount(api:ApiClient,route='/#/sdk',permissions=['MANAGE_APIS','PUBLISH_APIS']){history.replaceState({},'',route);return render(<PlatformTheme><AdminNavigationProvider><SdkAssetsPanel api={api} permissions={permissions} csrfToken="proof" onUnauthorized={vi.fn()}/></AdminNavigationProvider></PlatformTheme>)}
async function chooseFile(){fireEvent.change(await screen.findByLabelText('SDK ZIP 文件'),{target:{files:[new File(['ZIP!'],'client.zip',{type:'application/zip'})]}});await screen.findByText(/所选文件已通过格式校验/);}
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();history.replaceState({},'','/#/sdk')});
test('先校验清单自动填声明，登记及上传完成仍须明确发布，撤下保持CAS',async()=>{
 let current={...asset};const api=vi.fn(async(path:string,options?:{method?:string})=>{if(path.startsWith('/sdk-assets?'))return page();if(options?.method==='POST'&&path==='/sdk-assets')return current;if(path.endsWith('/publish'))current={...uploaded,status:'PUBLISHED',revision:3};if(path.endsWith('/withdraw'))current={...current,status:'WITHDRAWN',revision:4};return current;});
 const fetcher=vi.fn(async(path:string)=>ok(path.endsWith('/inspect')?archive:uploaded));vi.stubGlobal('fetch',fetcher);mount(api as ApiClient);
 fireEvent.click(screen.getByRole('button',{name:/登记平台 SDK/}));await chooseFile();
 expect(api.mock.calls.filter(([,o])=>o?.method==='POST')).toHaveLength(0);expect(screen.getByText('Java 8+')).toBeTruthy();
 fireEvent.change(screen.getByLabelText('SDK 名称'),{target:{value:asset.name}});fireEvent.click(screen.getByRole('button',{name:'登记并保存 ZIP'}));
 await screen.findByText(/ZIP 已校验并保存，尚未发布/);expect(location.hash).toContain(asset.id);expect(api.mock.calls.some(([path])=>path.endsWith('/publish'))).toBe(false);
 fireEvent.click(screen.getByRole('button',{name:'发布 SDK'}));fireEvent.click(screen.getByRole('button',{name:'确认发布 SDK'}));await screen.findByText('SDK 已发布。');expect(screen.queryByLabelText('SDK ZIP 文件')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'撤下 SDK'}));fireEvent.click(screen.getByRole('button',{name:'确认撤下 SDK'}));await screen.findByText('SDK 已撤下。');expect(screen.queryByRole('button',{name:'撤下 SDK'})).toBeNull();
 expect(fetcher.mock.calls.filter(([path])=>path.includes('/content?'))).toHaveLength(1);
});
test('修订冲突保留说明，核对后仍须显式保存，高精度修订原样提交',async()=>{
 let current={...uploaded,revision:parseJson('9007199254740993')};let conflict=true;
 const api=vi.fn(async(path:string,options?:{method?:string;body?:any})=>{if(path.startsWith('/sdk-assets?'))return page([current]);if(options?.method==='PUT'){if(conflict){conflict=false;current={...current,revision:parseJson('9007199254740994')};throw new ApiError('版本冲突',40900001,'r',undefined,409);}current={...current,...options.body,revision:parseJson('9007199254740995')};}return current;});
 mount(api as ApiClient,'/#/sdk?sdkAsset='+asset.id);fireEvent.change(await screen.findByLabelText('SDK 名称'),{target:{value:'我的名称'}});fireEvent.click(screen.getByRole('button',{name:'保存 SDK 草稿'}));
 fireEvent.click(await screen.findByRole('button',{name:'核对最新结果，保留输入'}));await waitFor(()=>expect(screen.queryByRole('button',{name:'核对最新结果，保留输入'})).toBeNull());expect(screen.getByLabelText('SDK 名称')).toHaveProperty('value','我的名称');
 expect(screen.getByRole('button',{name:'发布 SDK'})).toHaveProperty('disabled',true);fireEvent.click(screen.getByRole('button',{name:'保存 SDK 草稿'}));await screen.findByText('草稿说明已保存。');
 const writes=api.mock.calls.filter(([,options])=>options?.method==='PUT');expect(JSON.stringify(writes[1][1]?.body)).toContain('9007199254740994');
});
test('上传回包丢失后根据真实摘要核对，保留文件且不盲目重传',async()=>{
 let current={...asset};const api=vi.fn(async(path:string)=>path.startsWith('/sdk-assets?')?page([current]):current);
 const fetcher=vi.fn(async(path:string)=>{if(path.endsWith('/inspect'))return ok(archive);current={...uploaded};throw new TypeError('响应中断');});vi.stubGlobal('fetch',fetcher);
 mount(api as ApiClient,'/#/sdk?sdkAsset='+asset.id);await chooseFile();fireEvent.click(screen.getByRole('button',{name:'保存所选 ZIP'}));
 fireEvent.click(await screen.findByRole('button',{name:'核对最新结果，保留输入'}));await screen.findByText(/已确认所选 ZIP 保存成功/);expect(fetcher.mock.calls.filter(([path])=>path.includes('/content?'))).toHaveLength(1);expect(screen.getByRole('button',{name:'发布 SDK'})).toHaveProperty('disabled',false);
});
test('未知登记通过原版本定位已有草稿，不自动重复登记或上传',async()=>{
 let exists=false;const api=vi.fn(async(path:string,options?:{method?:string})=>{if(options?.method==='POST'){exists=true;throw new TypeError('登记响应中断');}return path.startsWith('/sdk-assets?')?page(exists?[asset]:[]):asset;});
 const fetcher=vi.fn(async()=>ok(archive));vi.stubGlobal('fetch',fetcher);mount(api as ApiClient,'/#/sdk?sdkAsset=new');await chooseFile();fireEvent.change(screen.getByLabelText('SDK 名称'),{target:{value:asset.name}});fireEvent.click(screen.getByRole('button',{name:'登记并保存 ZIP'}));
 fireEvent.click(await screen.findByRole('button',{name:'核对最新结果，保留输入'}));await screen.findByText(/已核对 SDK 88.1/);expect(location.hash).toContain(asset.id);expect(api.mock.calls.filter(([,o])=>o?.method==='POST')).toHaveLength(1);expect(fetcher).toHaveBeenCalledTimes(1);expect(screen.getByRole('button',{name:'保存所选 ZIP'})).toBeTruthy();
});
test('只请求当前资产类型，筛选和详情进入URL，清空查询仍保留类型',async()=>{
 const api=vi.fn(async(_path:string)=>page());mount(api as ApiClient);await screen.findByText('当前查询没有平台 SDK 版本。');expect(api.mock.calls.some(([path])=>path.includes('LEGACY_API'))).toBe(false);
 fireEvent.click(screen.getByText('接口绑定资产'));await screen.findByText('当前查询没有接口绑定资产。');
 fireEvent.click(screen.getByRole('button',{name:/更多筛选/}));fireEvent.change(await screen.findByLabelText('SDK 版本（精确）'),{target:{value:'88.1'}});
 expect(location.hash).not.toContain('88.1');fireEvent.click(screen.getByRole('button',{name:/^应\s?用$/}));
 await waitFor(()=>expect(location.hash).toContain('88.1'));await waitFor(()=>expect(api.mock.calls.some(([path])=>path.includes('kind=LEGACY_API')&&path.includes('sdkVersion=88.1'))).toBe(true));
 fireEvent.click(screen.getByRole('button',{name:'清除全部'}));await waitFor(()=>expect(location.hash).not.toContain('88.1'));expect(location.hash).toContain('LEGACY_API');
});
test('无管理权限时登记按钮禁用并说明原因',async()=>{
 const api=vi.fn(async(_path:string)=>page());mount(api as ApiClient,'/#/sdk',['PUBLISH_APIS']);
 const register=await screen.findByRole('button',{name:/登记平台 SDK/});expect(register).toHaveProperty('disabled',true);
 fireEvent.mouseEnter(register.parentElement!);expect(await screen.findByText('需要“API 管理”权限')).toBeTruthy();
});
test('详情读取失败不可误登记新资产；ZIP声明不符在上传前显示',async()=>{
 let fail=true;const api=vi.fn(async(path:string)=>{if(path.startsWith('/sdk-assets?'))return page();if(fail)throw new Error('暂不可读取');return asset;});vi.stubGlobal('fetch',vi.fn(async()=>ok({...archive,manifest:{...archive.manifest,sdkVersion:'different'}})));
 mount(api as ApiClient,'/#/sdk?sdkAsset='+asset.id);await screen.findByText('暂不可读取');expect(screen.queryByRole('button',{name:'登记并保存 ZIP'})).toBeNull();fail=false;fireEvent.click(screen.getByRole('button',{name:'重新读取 SDK'}));await chooseFile();expect(screen.getByLabelText('SDK 名称')).toHaveProperty('value',asset.name);expect(screen.getByLabelText('版本发布说明')).toHaveProperty('value',asset.releaseNotes);expect(screen.getByText(/所选 ZIP 与登记的版本不一致/)).toBeTruthy();expect(screen.getByRole('button',{name:'保存所选 ZIP'})).toHaveProperty('disabled',true);
});

test('无未保存输入的发布进行中，后退和离页仍受保护',async()=>{
 let finish!:(value:unknown)=>void;const pending=new Promise(resolve=>{finish=resolve});
 const api=vi.fn(async(path:string)=>path.endsWith('/publish')?pending:path.startsWith('/sdk-assets?')?page([uploaded]):uploaded);
 mount(api as ApiClient);fireEvent.click(await screen.findByRole('button',{name:asset.name}));await screen.findByLabelText('SDK 名称');
 fireEvent.click(screen.getByRole('button',{name:'发布 SDK'}));fireEvent.click(screen.getByRole('button',{name:'确认发布 SDK'}));
 await waitFor(()=>expect(screen.getByText(/^关\s?闭$/).closest('button')).toHaveProperty('disabled',true));
 const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);expect(event.defaultPrevented).toBe(true);
 const state=history.state;history.replaceState(state,'','/#/sdk');fireEvent(window,new PopStateEvent('popstate',{state}));await screen.findByRole('dialog',{name:'离开前处理未保存更改'});expect(screen.getByRole('button',{name:'放弃更改并离开'})).toHaveProperty('disabled',true);expect(location.hash).toContain(asset.id);
 finish({...uploaded,status:'PUBLISHED',revision:3});await screen.findByText('SDK 已发布。');
});

test('放弃校验中的文件并跨历史切换SDK，晚到检查不能覆盖新对象',async()=>{
 const second={...uploaded,id:'SDK_00000000000000000000000000000089',name:'另一个 SDK',releaseNotes:'另一个版本说明'};
 const api=vi.fn(async(path:string)=>path.startsWith('/sdk-assets?')?page([uploaded,second]):path.endsWith(second.id)?second:uploaded);
 let finish!:(value:Response)=>void;let signal:AbortSignal|undefined;
 vi.stubGlobal('fetch',vi.fn((_url:string,options:RequestInit)=>{signal=options.signal!;return new Promise<Response>(resolve=>{finish=resolve});}));
 mount(api as ApiClient,'/#/sdk?sdkAsset='+asset.id);fireEvent.change(await screen.findByLabelText('SDK ZIP 文件'),{target:{files:[new File(['ZIP!'],'old.zip')]}});await screen.findByText('正在校验 ZIP 与清单…');
 const state=history.state;history.replaceState(state,'','/#/sdk?sdkAsset='+second.id);fireEvent(window,new PopStateEvent('popstate',{state}));await screen.findByRole('dialog',{name:'离开前处理未保存更改'});fireEvent.click(screen.getByRole('button',{name:'放弃更改并离开'}));
 await waitFor(()=>expect(screen.getByLabelText('SDK 名称')).toHaveProperty('value',second.name));expect(signal?.aborted).toBe(true);
 finish(ok(archive));await new Promise(resolve=>setTimeout(resolve,20));expect(screen.queryByText(/所选文件已通过格式校验/)).toBeNull();expect(screen.getByLabelText('版本发布说明')).toHaveProperty('value',second.releaseNotes);
});

test('刷新恢复SDK类型、版本和状态筛选',async()=>{
 const api=vi.fn(async(_path:string)=>page());mount(api as ApiClient,'/#/sdk?filter.sdk.kind=LEGACY_API&filter.sdk.sdkVersion=88.1&filter.sdk.status=DRAFT');
 await screen.findByText('当前查询没有接口绑定资产。');expect(screen.getByRole('button',{name:'清除 SDK 版本：88.1'})).toBeTruthy();expect(screen.getByRole('button',{name:/清除 状态：草稿/})).toBeTruthy();expect(api.mock.calls[0][0]).toContain('kind=LEGACY_API');expect(api.mock.calls[0][0]).toContain('status=DRAFT');
});

test('StrictMode取消第一次读取后会重新读取详情，不停留在加载状态',async()=>{
 const api=vi.fn(async(path:string)=>path.startsWith('/sdk-assets?')?page([uploaded]):uploaded);
 history.replaceState({},'','/#/sdk?sdkAsset='+asset.id);
 render(<StrictMode><PlatformTheme><AdminNavigationProvider><SdkAssetsPanel api={api as ApiClient} permissions={['MANAGE_APIS']} csrfToken="proof" onUnauthorized={vi.fn()}/></AdminNavigationProvider></PlatformTheme></StrictMode>);
 expect(await screen.findByLabelText('SDK 名称')).toHaveProperty('value',asset.name);expect(screen.getByLabelText('版本发布说明')).toHaveProperty('value',asset.releaseNotes);
 expect(api.mock.calls.filter(([path])=>path==='/sdk-assets/'+asset.id).length).toBeGreaterThanOrEqual(2);
});
