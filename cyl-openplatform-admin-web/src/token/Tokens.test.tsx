import { AdminNavigationProvider } from '../navigation/AdminNavigation';
import { cleanup, fireEvent, render as renderView, screen, within, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import TokensPanel from './TokensPanel';
import { createAdminApi } from '../access/api';
const render = (ui: React.ReactNode) => renderView(ui, { wrapper: AdminNavigationProvider });
afterEach(() => {
  cleanup();
  window.history.replaceState({}, '', '/');
  vi.unstubAllGlobals();
});
test('按应用分页查Token并显式确认撤销，携带CSRF且不展示原始凭据', async () => {
  let revoked = false;
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'DELETE') {
      revoked = true;
      return Response.json({ code: 200, data: null });
    }
    return Response.json({
      code: 200,
      data: {
        items: [
          {
            tokenId: 'tk1',
            applicationId: 'a1',
            appKey: 'ak1',
            tenantId: 't1',
            employeeNo: 'e1',
            status: revoked ? 'REVOKED' : 'ACTIVE',
            scopeCodes: ['orders'],
            expiresAt: '2026-10-01T00:00:00Z',
          },
        ],
        total: 21,
        page: 1,
        pageSize: 20,
      },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<TokensPanel api={createAdminApi('proof', vi.fn())} applicationId="a1" />);
  fireEvent.click(await screen.findByRole('button', { name: '撤销 Token' }));
  expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
  const confirm = await screen.findByRole('tooltip');
  expect(within(confirm).getByText(/tk1.*其他 Token、签名密钥和管理会话不受影响/)).toBeTruthy();
  fireEvent.click(within(confirm).getByRole('button', { name: '确认撤销' }));
  expect((await screen.findAllByText('已撤销')).length).toBeGreaterThan(0);
  expect(await screen.findByText('Token 已撤销，仅该调用凭证失效，管理登录会话不受影响。')).toBeTruthy();
  const call = fetchMock.mock.calls.find(([, init]) => init?.method === 'DELETE');
  expect(call?.[0]).toBe('/admin-api/tokens/tk1');
  expect(new Headers(call?.[1]?.headers).get('X-CSRF-Token')).toBe('proof');
  expect(screen.getByText('共 21 条')).toBeTruthy();
  fireEvent.click(screen.getByTitle(/下一页|Next Page/));
  await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes('page=2&pageSize=20'))).toBe(true));
  expect(screen.queryByText('accessToken')).toBeNull();
});

test('过期和授权失效不混淆租户与员工，不误清除管理会话',async()=>{
 const expired=vi.fn();
 const fetchMock=vi.fn(async()=>Response.json({code:40100003,resultMsg:'Token无效或已失效'},{status:401}));vi.stubGlobal('fetch',fetchMock);
 await expect(createAdminApi('proof',expired)('/debug',{method:'POST',bearerToken:'expired-example'})).rejects.toThrow('Token无效或已失效');
 expect(expired).not.toHaveBeenCalled();
 fetchMock.mockImplementation(async()=>Response.json({code:200,data:{items:[
  {tokenId:'application-expired',applicationId:'a1',appKey:'ak1',tenantId:'tenant-a',scopeCodes:[],expiresAt:'2020-01-01T00:00:00Z',status:'EXPIRED'},
  {tokenId:'employee-invalid',applicationId:'a1',appKey:'ak1',tenantId:'tenant-b',userId:'user',employeeId:'person',employeeNo:'E1001',scopeCodes:['orders'],expiresAt:'2030-01-01T00:00:00Z',status:'INVALIDATED'},
 ],total:2,page:1,pageSize:20}}));
 render(<TokensPanel api={createAdminApi('proof',expired)} applicationId="a1"/>);
 await screen.findByText('已过期');expect(screen.getByText('授权失效')).toBeTruthy();expect(screen.getByText('工号 E1001')).toBeTruthy();expect(screen.getByText(/员工代调用/)).toBeTruthy();expect(screen.getAllByLabelText('复制租户 ID').length).toBe(2);expect(screen.getByText('凭据自主调用')).toBeTruthy();
 expect(screen.getAllByRole('button',{name:'撤销 Token'}).every(b=>(b as HTMLButtonElement).disabled)).toBe(true);
});

test('撤销回包不确定时先核对真实记录，不自动重发DELETE',async()=>{
 let revoked=false,writes=0;
 vi.stubGlobal('fetch',vi.fn(async(_url:string,init?:RequestInit)=>{
  if(init?.method==='DELETE'){writes++;revoked=true;throw new Error('network lost');}
  return Response.json({code:200,data:{items:[{tokenId:'t-unknown',applicationId:'a1',appKey:'ak1',tenantId:'tenant-a',scopeCodes:[],expiresAt:'2030-01-01T00:00:00Z',status:revoked?'REVOKED':'ACTIVE'}],total:1,page:1,pageSize:20}});
 }));
 render(<TokensPanel api={createAdminApi('proof',vi.fn())} applicationId="a1"/>);
 fireEvent.click(await screen.findByRole('button',{name:'撤销 Token'}));
 fireEvent.click(await screen.findByRole('button',{name:'确认撤销'}));
 await screen.findByRole('button',{name:'核对 Token 状态'});expect(screen.getByRole('button',{name:'撤销 Token'})).toHaveProperty('disabled',true);
 fireEvent.click(screen.getByRole('button',{name:'关闭错误提示'}));fireEvent.click(screen.getByRole('button',{name:'核对 Token 状态'}));
 await screen.findByText('已核对 Token 当前状态：已撤销。');expect(writes).toBe(1);
});
