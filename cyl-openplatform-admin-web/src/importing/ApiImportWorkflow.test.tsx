import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,expect,test,vi} from 'vitest';
import {PlatformTheme} from '@cyl/open-platform-web-shared/ui/PlatformTheme';
import {AdminNavigationProvider} from '../navigation/AdminNavigation';
import type {AdminApi} from '../access/api';
import ApiOnboarding from './ApiOnboarding';
import ApiImport from './ApiImport';
const definition={service:'orders',version:'v1',method:'query',name:'订单候选',category:'订单',owner:'EMP_00000000000000000000000000000001',scopeCodes:[],requestSchema:{type:'OBJECT',properties:{}},responseSchema:{type:'STRING'},errorDefinitions:[],mappings:[],binding:{protocol:'HTTP',timeoutMillis:3000,http:{url:'https://example.test/order',method:'POST'}}};
const item=(index:number,method='query')=>({index,operation:{service:'orders',version:'v1',method},change:'CREATE',expectedRevision:0,changedFields:['name'],before:null,after:{...definition,method},errors:[]});
const page={items:[],total:0,page:1,pageSize:20};
const mount=(ui:React.ReactNode)=>render(<PlatformTheme><AdminNavigationProvider>{ui}</AdminNavigationProvider></PlatformTheme>);
// 候选编辑挂载完整配置页（分区、字段表、检查面板），整轮并行时单例接近 5 秒。
vi.setConfig({testTimeout:15000});
afterEach(()=>{cleanup();vi.restoreAllMocks();sessionStorage.clear();window.history.replaceState({},'','/#/catalog')});

test.each(['single', 'bundle'])('%s：明确显示字段并保留标识，移除来源修订只重预览当前项', async (shape) => {
 let latest: Record<string, unknown> = {};
 const original = { ...definition, expectedRevision: 2 };
 const api = vi.fn(async (path: string, options?: { bodyText?: string }) => {
  if (path === '/api-imports/preview') {
   const document = JSON.parse(options!.bodyText!);
   latest = document.apis?.[0] ?? document;
   const invalid = Object.prototype.hasOwnProperty.call(latest, 'expectedRevision');
   return { documentDigest: 'a'.repeat(64), items: [{ ...item(0), change: invalid ? 'ERROR' : 'CREATE', after: invalid ? null : latest,
    errors: invalid ? ['不支持导入字段 expectedRevision：请删除后重新预览'] : [] }] };
  }
  return page;
 });
 mount(<ApiImport api={api as AdminApi} initialDocument={JSON.stringify(shape === 'single' ? original : {format:'cyl-openplatform.catalog/v1',apis:[original]})} onReturn={vi.fn()} />);
 expect(await screen.findByText('orders/v1/query')).toBeTruthy();
 expect(screen.queryByText('操作标识无效')).toBeNull();
 expect(screen.getByLabelText('第 1 项 · 错误')).toHaveProperty('disabled', true);
 fireEvent.click(screen.getByRole('button', { name: '修正此项' }));
 expect(await screen.findByLabelText('本项配置 JSON')).toHaveProperty('value', expect.stringContaining('expectedRevision'));
 fireEvent.click(screen.getByRole('button', { name: '移除 expectedRevision 并重新预览' }));
 await screen.findByLabelText('第 1 项 · 新增');
 expect(latest).toEqual(definition);
 expect(api.mock.calls.filter(([path]) => path === '/api-imports/preview')).toHaveLength(2);
 expect(api.mock.calls.some(([path]) => path === '/api-imports/confirm' || path === '/apis')).toBe(false);
});

test('单来源直接进入候选配置页，只读校验先定位错误，确认后自动进入差异而不创建草稿',async()=>{
 window.history.replaceState({},'','/#/imports');let valid=false;
 const api=vi.fn(async(path:string)=>path==='/api-imports/sources/openapi'?{sourceDigest:'a'.repeat(64),items:[{key:'one',label:'POST /order',definition,warnings:['核对提供方返回'],blockers:[]}]}:path==='/apis/validate'?{valid,fieldIssues:valid?[]:[{path:'/owner',reason:'REQUIRED',message:'负责人不能为空'}],truncated:false}:path==='/api-imports/preview'?{documentDigest:'b'.repeat(64),items:[item(0)]}:page);
 mount(<ApiOnboarding api={api as AdminApi} onReturn={vi.fn()} onManual={vi.fn()} onOpen={vi.fn()}/>);
 fireEvent.change(screen.getByLabelText('来源文本'),{target:{value:'{"openapi":"3.0.3"}'}});fireEvent.click(screen.getByRole('button',{name:'解析来源，选择接口'}));
 await screen.findByLabelText('接口名称');
 // 候选与 API 配置页同一套分区：来源提醒逐条列出，目录跳转分区不触发离开确认。
 expect(within(screen.getByRole('list',{name:'来源转换提醒'})).getByText('核对提供方返回')).toBeTruthy();
 fireEvent.click(within(screen.getByRole('navigation',{name:'配置目录'})).getByRole('button',{name:'调用目标与映射'}));
 expect(window.location.hash).toContain('/apis/import');expect(screen.queryByRole('dialog',{name:'离开前处理未保存更改'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'确认候选'}));await screen.findAllByText('负责人不能为空');expect(window.location.hash).not.toContain('step=');
 expect(screen.getByRole('region',{name:'待修正'}).textContent).toContain('负责人不能为空');
 expect(api.mock.calls.some(([path])=>path==='/api-imports/preview')).toBe(false);
 valid=true;fireEvent.change(screen.getByLabelText('接口名称'),{target:{value:'重新核对的订单候选'}});fireEvent.click(screen.getByRole('button',{name:'确认候选'}));
 expect(await screen.findByLabelText('第 1 项 · 新增')).toHaveProperty('checked',true);
 const validated=api.mock.calls.filter(([path])=>path==='/apis/validate').at(-1)!;
 expect(String((validated as unknown as [string,{bodyText:string}])[1].bodyText)).not.toContain('expectedRevision');
 expect(api.mock.calls.some(([path])=>path==='/apis'||path==='/api-imports/confirm'||path==='/api-copies')).toBe(false);
});

test('非法单项JSON可修正，其他候选选择与高精度示例保留',async()=>{
 const number='0.123456789012345678901';
 const document=`{"format":"cyl-openplatform.catalog/v1","apis":[${JSON.stringify(definition).replace('"responseSchema":{"type":"STRING"}',`"responseSchema":{"type":"NUMBER","example":${number}}`)},null]}`;
 let previews=0;
 const api=vi.fn(async(path:string)=>path==='/api-imports/preview'?{documentDigest:'a'.repeat(64),items:[item(0),++previews===1?{...item(1),operation:null,change:'ERROR',after:null,errors:['第2项不是有效配置']}:item(1,'fixed')]}:page);
 mount(<ApiImport api={api as AdminApi} initialDocument={document} onReturn={vi.fn()}/>);
 fireEvent.click(await screen.findByLabelText('第 1 项 · 新增'));fireEvent.click(screen.getAllByRole('button',{name:'修正此项'})[1]);
 expect(screen.getByLabelText('本项配置 JSON')).toHaveProperty('value','null');
 fireEvent.change(screen.getByLabelText('本项配置 JSON'),{target:{value:JSON.stringify({...definition,method:'fixed'})}});
 const discard=vi.spyOn(window,'confirm').mockReturnValue(false);fireEvent.click(screen.getByRole('button',{name:/返回 API 目录/}));expect(discard).toHaveBeenCalled();expect(screen.getByLabelText('本项配置 JSON')).toHaveProperty('value',expect.stringContaining('fixed'));
 fireEvent.click(screen.getByRole('button',{name:'应用并重新预览'}));
 expect(await screen.findByLabelText('第 2 项 · 新增')).toHaveProperty('checked',false);expect(screen.getByLabelText('第 1 项 · 新增')).toHaveProperty('checked',true);
 expect(screen.getByLabelText('接口配置 JSON')).toHaveProperty('value',expect.stringContaining(number));
 expect(api.mock.calls.some(([path])=>path==='/api-imports/confirm')).toBe(false);
});

test('差异页修正可进入表单的候选：同一配置页校验，确认后重新核对本批并保留其他选择',async()=>{
 let previews=0;
 const api=vi.fn(async(path:string)=>path==='/api-imports/preview'?{documentDigest:'a'.repeat(64),items:[item(0),{...item(1,previews++?'renamed':'second'),errors:previews>1?[]:['名称需要核对']}]}:path==='/apis/validate'?{valid:true,fieldIssues:[],truncated:false}:page);
 mount(<ApiImport api={api as AdminApi} initialDocument={JSON.stringify({format:'cyl-openplatform.catalog/v1',apis:[definition,{...definition,method:'second'}]})} onReturn={vi.fn()}/>);
 fireEvent.click(await screen.findByLabelText('第 1 项 · 新增'));
 fireEvent.click(screen.getAllByRole('button',{name:'修正此项'})[1]);
 expect(await screen.findByLabelText('接口名称')).toHaveProperty('value','订单候选');
 expect(screen.getByText('名称需要核对')).toBeTruthy();
 fireEvent.change(screen.getByLabelText('操作标识'),{target:{value:'renamed'}});
 fireEvent.click(screen.getByRole('button',{name:'确认候选'}));
 expect(await screen.findByLabelText('第 2 项 · 新增')).toHaveProperty('checked',false);
 expect(screen.getByLabelText('第 1 项 · 新增')).toHaveProperty('checked',true);
 expect(screen.getByLabelText('接口配置 JSON')).toHaveProperty('value',expect.stringContaining('"method":"renamed"'));
 expect(api.mock.calls.some(([path])=>path==='/api-imports/confirm'||path==='/apis')).toBe(false);
});

test('同页确认防重复写入，结果直接打开实际API',async()=>{
 const open=vi.fn();const api=vi.fn(async(path:string)=>path==='/api-imports/preview'?{documentDigest:'a'.repeat(64),items:[item(0)]}:path==='/api-imports/confirm'?{committed:true,items:[{index:0,change:'CREATE',apiId:'created',revision:1,errors:[]}]}:page);
 mount(<ApiImport api={api as AdminApi} initialDocument={JSON.stringify({format:'cyl-openplatform.catalog/v1',apis:[definition]})} onReturn={vi.fn()} onOpen={open} preparedBatch/>);
 const confirm=await screen.findByRole('button',{name:'确认写入草稿'});await waitFor(()=>expect(confirm).toHaveProperty('disabled',false));fireEvent.click(confirm);fireEvent.click(confirm);
 fireEvent.click(await screen.findByRole('button',{name:'打开 API 继续测试与发布'}));expect(open).toHaveBeenCalledWith('created');expect(api.mock.calls.filter(([path])=>path==='/api-imports/confirm')).toHaveLength(1);
});

test('候选校验未返回时不能离开编辑器，避免迟到结果覆盖下一项',async()=>{
 window.history.replaceState({},'','/#/imports');
 let finish!:(value:unknown)=>void;
 const pending=new Promise(resolve=>{finish=resolve});
 const api=vi.fn(async(path:string)=>path==='/api-imports/sources/openapi'?{sourceDigest:'a'.repeat(64),items:[{key:'one',label:'POST /order',definition,warnings:[],blockers:[]}]}:path==='/apis/validate'?pending:path==='/api-imports/preview'?{documentDigest:'b'.repeat(64),items:[item(0)]}:page);
 mount(<ApiOnboarding api={api as AdminApi} onReturn={vi.fn()} onManual={vi.fn()} onOpen={vi.fn()}/>);
 fireEvent.change(screen.getByLabelText('来源文本'),{target:{value:'{"openapi":"3.0.3"}'}});fireEvent.click(screen.getByRole('button',{name:'解析来源，选择接口'}));
 await screen.findByLabelText('接口名称');fireEvent.click(screen.getByRole('button',{name:'确认候选'}));
 await waitFor(()=>expect(screen.getByRole('button',{name:'返回候选列表'})).toHaveProperty('disabled',true));
 fireEvent.click(screen.getByRole('button',{name:'返回候选列表'}));expect(screen.getByLabelText('接口名称')).toHaveProperty('value','订单候选');
 finish({valid:true,fieldIssues:[],truncated:false});expect(await screen.findByLabelText('第 1 项 · 新增')).toHaveProperty('checked',true);
});

test('平台差异页修正后返回来源携带完整修改，不触发卸载后的离开询问',async()=>{
 window.history.replaceState({},'','/#/imports');
 let previews=0;
 const api=vi.fn(async(path:string)=>path==='/api-imports/preview'?{documentDigest:'a'.repeat(64),items:[++previews===1?{...item(0),operation:null,change:'ERROR',after:null,errors:['第1项不是有效配置']}:item(0,'fixed')]}:page);
 mount(<ApiOnboarding api={api as AdminApi} onReturn={vi.fn()} onManual={vi.fn()} onOpen={vi.fn()}/>);
 fireEvent.click(screen.getByRole('radio',{name:'平台导出的接口配置 JSON'}));
 fireEvent.change(screen.getByLabelText('来源文本'),{target:{value:JSON.stringify({format:'cyl-openplatform.catalog/v1',apis:[null]})}});
 fireEvent.click(screen.getByRole('button',{name:'解析来源，选择接口'}));
 fireEvent.click(await screen.findByRole('button',{name:'修正此项'}));
 fireEvent.change(screen.getByLabelText('本项配置 JSON'),{target:{value:JSON.stringify({...definition,method:'fixed'})}});fireEvent.click(screen.getByRole('button',{name:'应用并重新预览'}));
 await screen.findByLabelText('第 1 项 · 新增');fireEvent.click(screen.getByRole('button',{name:'返回来源资料'}));
 expect(screen.getByLabelText('来源文本')).toHaveProperty('value',expect.stringContaining('"method":"fixed"'));expect(screen.queryByRole('dialog',{name:'离开前处理未保存更改'})).toBeNull();
});

test('HTTP候选在请求服务端前一次呈现已知必填缺项，并在检查面板与字段旁定位',async()=>{
 window.history.replaceState({},'','/#/imports');const api=vi.fn(async(_path:string)=>page);
 mount(<ApiOnboarding api={api as AdminApi} onReturn={vi.fn()} onManual={vi.fn()} onOpen={vi.fn()}/>);
 fireEvent.click(screen.getByRole('radio',{name:'HTTP 请求 · cURL / 原始 HTTP'}));fireEvent.change(screen.getByLabelText('来源文本'),{target:{value:"curl https://example.test/order -d '{}'"}});fireEvent.click(screen.getByRole('button',{name:'解析来源，选择接口'}));
 fireEvent.click(await screen.findByRole('button',{name:'确认候选'}));
 const blocking=await screen.findByRole('region',{name:'待修正'});
 expect(within(blocking).getByRole('heading',{name:'6 项待修正'})).toBeTruthy();
 expect(within(blocking).getByText('请填写服务标识')).toBeTruthy();expect(within(blocking).getByText('请补充真实响应结构')).toBeTruthy();
 // 字段旁同时提示，服务标识可直接在候选配置页补齐。
 expect(screen.getAllByText('请填写服务标识').length).toBeGreaterThan(1);
 expect(screen.getByLabelText('服务标识')).toHaveProperty('value','');
 expect(api.mock.calls.some(([path])=>path==='/apis/validate')).toBe(false);
});
