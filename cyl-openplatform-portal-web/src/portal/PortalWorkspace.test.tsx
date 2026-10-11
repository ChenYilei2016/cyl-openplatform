import { act, cleanup, fireEvent, render as renderRaw, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { ApiClient } from '@cyl/open-platform-web-shared/http';
import { PlatformTheme } from '@cyl/open-platform-web-shared/ui/PlatformTheme';
import PortalApplications from './PortalApplications';
import { PortalMutationError, type PortalApplication, type PortalSession } from './api';
const app: PortalApplication = {scopes:[],id:'TGR_test',applicationId:'APP_test',appKey:'a'.repeat(32),name:'受控接入',globalName:'全局名称',note:'受控接入',applicationStatus:'ENABLED',status:'ACTIVE',authorizationVersion:0,noteRevision:0};
const session: PortalSession = {tenantId:'tenant87',employeeNo:'E1001',userId:'user',displayName:'员工'};
const page = {items:[app],total:1,page:1,pageSize:20};
const api=vi.fn<ApiClient>();
const render=(node:ReactElement)=>renderRaw(node,{wrapper:({children})=><PlatformTheme variant="portal">{children}</PlatformTheme>});
beforeEach(()=>{vi.spyOn(window,'scrollTo').mockImplementation(()=>{});history.replaceState(null,'','/portal/?section=settings');sessionStorage.clear();api.mockReset().mockImplementation(async path => (path === '/creation-availability' ? {available:true,defaultScopeCount:1,reason:''} : path === '/applications/TGR_test' ? app : path.includes('/users?') ? {...page,items:[]} : page) as never);});
afterEach(()=>{cleanup();vi.restoreAllMocks();});
async function bind(){fireEvent.click(screen.getByRole('button',{name:'绑定现有 AK'}));fireEvent.change(screen.getByLabelText('绑定用 AppKey'),{target:{value:app.appKey}});fireEvent.change(screen.getByLabelText('绑定用 AppSecret'),{target:{value:'secret87'}});fireEvent.click(screen.getByRole('button',{name:'校验并绑定本租户'}));}

test('创建前读取实际权限，不就绪阻止提交；刷新后允许创建并直接携带Secret进入工作区',async()=>{
 let ready=false;
 api.mockImplementation(async(path,options)=>{
  if(path==='/creation-availability')return {available:ready,defaultScopeCount:ready?1:0,reason:'尚无有效默认权限'} as never;
  if(path==='/applications'&&options?.method==='POST')return {application:{appKey:app.appKey},appSecret:'secret87'} as never;
  if(path==='/applications/TGR_test')return app as never;
  return page as never;
 });
 render(<PortalApplications session={session} api={api as ApiClient}/>);
 fireEvent.click(screen.getByRole('button',{name:'生成新 AK'}));
 await screen.findByText('尚无有效默认权限');
 expect((screen.getByRole('button',{name:'生成并绑定本租户'}) as HTMLButtonElement).disabled).toBe(true);
 fireEvent.click(screen.getByRole('button',{name:'取消'}));ready=true;
 fireEvent.click(screen.getByRole('button',{name:'生成新 AK'}));
 await screen.findByText('已就绪：创建时自动分配 1 个默认权限组。');
 fireEvent.click(screen.getByRole('button',{name:'生成并绑定本租户'}));
 await screen.findByText('secret87');
 const proceed=screen.getByRole('button',{name:'我已保存，继续接入'}) as HTMLButtonElement;
 expect(proceed.disabled).toBe(true);
 fireEvent.click(screen.getByRole('checkbox',{name:/我已安全保存本次 Secret/}));fireEvent.click(proceed);
 await screen.findByRole('heading',{name:'准备调用身份'});
 expect(screen.getByRole('tab',{name:'Token 与调用',selected:true})).toBeTruthy();
 expect(location.search).toContain('credential=TGR_test');
 expect((screen.getByLabelText('AppSecret') as HTMLInputElement).value).toBe('secret87');
 expect(location.href).not.toContain('secret87');expect(sessionStorage.length).toBe(0);
});

test('绑定结果未知不重复POST，核对失败仍阻断，读到有效关系后直接进入原对象',async()=>{
 let reads=0;
 api.mockImplementation(async(path,options)=>{
  if(path==='/bindings'&&options?.method==='POST')throw new PortalMutationError('连接中断','UNKNOWN');
  if(path.includes('pageSize=1&appKey=')){if(++reads===1)throw new Error('核对失败');return page as never;}
  return (path==='/applications/TGR_test'?app:page) as never;
 });
 render(<PortalApplications session={session} api={api as ApiClient}/>);await bind();
 await screen.findByRole('button',{name:'核对绑定结果'});
 expect((screen.getByRole('button',{name:'校验并绑定本租户'})as HTMLButtonElement).disabled).toBe(true);
 fireEvent.click(screen.getByRole('button',{name:'核对绑定结果'}));await screen.findByText('核对失败');
 expect((screen.getByRole('button',{name:'校验并绑定本租户'})as HTMLButtonElement).disabled).toBe(true);
 fireEvent.click(screen.getByRole('button',{name:'核对绑定结果'}));await screen.findByRole('heading',{name:'准备调用身份'});
 expect(api.mock.calls.filter(([path,options])=>path==='/bindings'&&options?.method==='POST')).toHaveLength(1);
});

test('绑定成功自动定位，浏览器同凭据页签后退保留输入，直接深链重新读取本租户投影',async()=>{
 api.mockImplementation(async(path,options)=>(path==='/bindings'&&options?.method==='POST'?{id:app.id}:path==='/applications/TGR_test'?app:page)as never);
 const view=render(<PortalApplications session={session} api={api as ApiClient}/>);await bind();
 await screen.findByRole('heading',{name:'准备调用身份'});
 const first=location.href;
 fireEvent.change(screen.getByLabelText('AppSecret'),{target:{value:'in-progress'}});
 fireEvent.click(screen.getByRole('tab',{name:'调用员工'}));
 await act(async()=>{history.replaceState(null,'',first);window.dispatchEvent(new PopStateEvent('popstate'));});
 expect(screen.getByRole('heading',{name:'准备调用身份'})).toBeTruthy();
 expect((screen.getByLabelText('AppSecret') as HTMLInputElement).value).toBe('in-progress');
 view.unmount();render(<PortalApplications session={session} api={api as ApiClient}/>);
 await screen.findByRole('heading',{name:'准备调用身份'});
 await waitFor(()=>expect(api).toHaveBeenCalledWith('/applications/TGR_test',expect.objectContaining({signal:expect.any(AbortSignal)})));
 expect((screen.getByLabelText('AppSecret') as HTMLInputElement).value).toBe('');
});

test('抽屉概览编辑备注，调用员工页签直接接续人员Token',async()=>{
 api.mockImplementation(async(path)=>(path==='/applications/TGR_test'?app:path.includes('/users?')?{...page,items:[{id:'USR_test',tenantGrantId:app.id,tenantId:session.tenantId,userId:'user',employeeId:'employee',employeeNo:'E1001',displayName:'受托员工',enabled:true,status:'ACTIVE',authorizationVersion:0}]}:page)as never);
 render(<PortalApplications session={session} api={api as ApiClient}/>);
 fireEvent.click(await screen.findByRole('button',{name:'查看 受控接入 详情'}));
 fireEvent.click(await screen.findByRole('button',{name:'编辑备注'}));
 expect(screen.getByRole('dialog',{name:'编辑本租户备注'})).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'取消'}));
 expect(screen.queryByRole('dialog',{name:'编辑本租户备注'})).toBeNull();
 fireEvent.click(screen.getByRole('tab',{name:'调用员工'}));
 fireEvent.click(await screen.findByRole('button',{name:'获取人员 Token'}));
 await screen.findByRole('heading',{name:'准备调用身份'});
 expect(location.search).toContain('employee=E1001');
 expect((screen.getByLabelText('已获委托的员工号（必填）') as HTMLInputElement).value).toBe('E1001');
});
