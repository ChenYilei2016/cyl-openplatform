import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import App from './App';

afterEach(() => {
  cleanup();
  window.history.replaceState({}, '', '/');
  vi.unstubAllGlobals();
});

test('统一侧栏直接展示有权入口，切换列表和凭据保留导航', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      Response.json({
        code: 200,
        data:
          url === '/platform-info'
            ? { name: 'CYL · 开放平台', adminLoginUrl: null }
            : url === '/admin-api/session'
              ? {
                  tenantId: 't1',
                  userId: 'u1',
                  administratorId: 'admin-1',
                  employeeId: 'employee-1',
                  superAdministrator: false,
                  employeeNo: 'E1',
                  displayName: '管理员',
                  permissions: ['MANAGE_APIS', 'MANAGE_APPLICATIONS', 'VIEW_AUDIT'],
                }
              : { items: [], total: 0, page: 1, pageSize: 20 },
      }),
    ),
  );
  render(<App />);
  const top = await screen.findByRole('navigation', { name: '后台主导航' });
  expect(screen.getByRole('link', { name: /CYL · 开放平台/ })).toBeTruthy();
  for (const title of ['工作台', 'API 列表', '审核中心', '文档预览', '接入凭据', '权限组', '调用日志', '管理审计'])
    expect(within(top).getByRole('link', { name: title })).toBeTruthy();
  fireEvent.click(within(top).getByRole('link', { name: '接入凭据' }));
  expect(window.location.hash).toBe('#/credentials');
  fireEvent.click(within(top).getByRole('link', { name: 'API 列表' }));
  expect(window.location.hash).toBe('#/apis');
  expect(within(top).getByRole('link', { name: '接入凭据' })).toBeTruthy();
});

test('未登录时提供服务端配置的平台登录入口', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url === '/platform-info'
        ? Response.json({
            code: 200,
            data: { name: 'CYL Open Platform', adminLoginUrl: 'https://login.example.com/' },
            resultMsg: '成功',
            requestId: 'req-info',
          })
        : Response.json(
            { code: 401, resultMsg: '请登录', data: null, requestId: 'req-1' },
            { status: 401 },
          ),
    ),
  );
  render(<App />);
  expect((await screen.findByRole('link', { name: '使用平台账号登录' })).getAttribute('href')).toBe(
    'https://login.example.com/',
  );
});

test('已登录时显示服务端租户身份和已有权限，不提供未实现操作', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      Response.json({
        code: 200,
        resultMsg: '成功',
        requestId: 'req-2',
        data:
          url === '/platform-info'
            ? { name: 'CYL Open Platform', adminLoginUrl: null }
            : url === '/admin-api/session'
              ? {
                  tenantId: 'tenant-001',
                  userId: 'user-001',
                  administratorId: 'admin-1',
                  employeeId: 'employee-1',
                  superAdministrator: false,
                  employeeNo: 'E001',
                  displayName: '示例乙',
                  permissions: ['MANAGE_APIS', 'VIEW_AUDIT'],
                }
              : { items: [], total: 0 },
      }),
    ),
  );
  render(<App />);
  expect((await screen.findAllByText(/示例乙/)).length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole('button', { name: '查看账号与权限' }));
  fireEvent.click(await screen.findByText('账号与权限'));
  expect(await screen.findByText('tenant-001')).toBeTruthy();
  expect(screen.getByText('API 管理')).toBeTruthy();
  expect(screen.queryByRole('link', { name: '创建接入凭据' })).toBeNull();
});

test('403 明确显示无操作资格且不泄露身份', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url === '/platform-info'
        ? Response.json({ code: 200, data: { name: 'CYL Open Platform', adminLoginUrl: null } })
        : Response.json({ code: 403, data: null, requestId: 'req-denied' }, { status: 403 }),
    ),
  );
  render(<App />);
  expect(await screen.findByRole('heading', { name: '暂无后台操作资格' })).toBeTruthy();
  expect(screen.queryByText('当前登录人员')).toBeNull();
});

test('网络失败可见，重新连接后恢复服务端会话', async () => {
  const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
  vi.stubGlobal('fetch', fetchMock);
  render(<App />);
  expect(await screen.findByRole('alert')).toBeTruthy();
  fetchMock.mockImplementation(async (url: string) =>
    Response.json({
      code: 200,
      data:
        url === '/platform-info'
          ? { name: 'CYL Open Platform', adminLoginUrl: null }
          : {
              tenantId: 'tenant-002',
              userId: 'user-002',
              administratorId: 'admin-1',
              employeeId: 'employee-1',
              superAdministrator: false,
              employeeNo: 'E002',
              displayName: '测试人员',
              permissions: [],
            },
    }),
  );
  fireEvent.click(screen.getByRole('button', { name: '重新连接' }));
  expect((await screen.findAllByText(/测试人员/)).length).toBeGreaterThan(0);
  expect(screen.queryByRole('alert')).toBeNull();
});

test('未配置平台登录入口时提示联系管理员，不构造登录地址', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url === '/platform-info'
        ? Response.json({ code: 200, data: { name: 'CYL Open Platform', adminLoginUrl: null } })
        : new Response(null, { status: 401 }),
    ),
  );
  render(<App />);
  expect(await screen.findByText('尚未配置登录入口，请联系平台管理员。')).toBeTruthy();
  expect(screen.queryByRole('link', { name: '使用平台账号登录' })).toBeNull();
});

test('会话数据不符合身份契约时不进入已登录界面', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      Response.json({
        code: 200,
        data:
          url === '/platform-info'
            ? { name: 'CYL Open Platform', adminLoginUrl: null }
            : { tenantId: 'tenant-001', displayName: '伪造身份' },
      }),
    ),
  );
  render(<App />);
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.queryByText('伪造身份')).toBeNull();
});

test('应用管理员可进入分页应用列表并按 AppKey 精确查找', async () => {
  const fetchMock = vi.fn(async (url: string) => {
    if (url === '/platform-info')
      return Response.json({ code: 200, data: { name: 'CYL Open Platform', adminLoginUrl: null } });
    if (url === '/admin-api/session')
      return Response.json(
        {
          code: 200,
          data: {
            tenantId: 't1',
            userId: 'u1',
            administratorId: 'admin-1',
            employeeId: 'employee-1',
            superAdministrator: false,
            employeeNo: 'E1',
            displayName: '管理员',
            permissions: ['MANAGE_APPLICATIONS'],
          },
        },
        { headers: { 'X-CSRF-Token': 'memory-proof' } },
      );
    return Response.json({
      code: 200,
      data: {
        items: [
          {
            id: 'a1',
            name: '订单同步',
            appKey: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            ownerTenantId: 't1',
            status: 'ENABLED',
            authorizationVersion: 1,
            scopeCodes: ['orders'],
          },
        ],
        total: 21,
        page: 1,
        pageSize: 20,
      },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<App />);
  fireEvent.click(await screen.findByRole('link', { name: '接入凭据' }));
  expect(await screen.findByRole('button', { name: '查看凭据 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' })).toBeTruthy();
  fireEvent.change(screen.getByLabelText('搜索凭据'), {
    target: { value: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
  });
  await vi.waitFor(() =>
    expect(
      fetchMock.mock.calls.some(([url]) => url.includes('search=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')),
    ).toBe(true),
  );
});

test('管理请求401时清除操作页面并返回平台登录引导', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/platform-info')
        return Response.json({
          code: 200,
          data: { name: 'CYL Open Platform', adminLoginUrl: 'https://login.example.com/' },
        });
      if (url === '/admin-api/session')
        return Response.json(
          {
            code: 200,
            data: {
              tenantId: 't1',
              userId: 'u1',
              administratorId: 'admin-1',
              employeeId: 'employee-1',
              superAdministrator: false,
              employeeNo: 'E1',
              displayName: '管理员',
              permissions: ['MANAGE_APPLICATIONS'],
            },
          },
          { headers: { 'X-CSRF-Token': 'old-proof' } },
        );
      return Response.json({ code: 401, data: null }, { status: 401 });
    }),
  );
  window.history.replaceState({}, '', '/#/credentials');
  render(<App />);
  expect(await screen.findByRole('link', { name: '使用平台账号登录' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: /新建凭据/ })).toBeNull();
  expect(screen.queryByRole('link', { name: '接入凭据' })).toBeNull();
});

test('仅API管理员可进入目录且不会取得应用授权管理入口', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/platform-info')
        return Response.json({ code: 200, data: { name: 'CYL开放平台', adminLoginUrl: null } });
      if (url === '/admin-api/session')
        return Response.json(
          {
            code: 200,
            data: {
              tenantId: 't1',
              userId: 'u1',
              administratorId: 'admin-1',
              employeeId: 'employee-1',
              superAdministrator: false,
              employeeNo: 'E1',
              displayName: 'API管理员',
              permissions: ['MANAGE_APIS'],
            },
          },
          { headers: { 'X-CSRF-Token': 'proof' } },
        );
      return Response.json({ code: 200, data: { items: [], total: 0, page: 1, pageSize: 20 } });
    }),
  );
  render(<App />);
  fireEvent.click(await screen.findByRole('link', { name: 'API 列表' }));
  expect(await screen.findByRole('button', { name: /新建 API/ })).toBeTruthy();
  expect(screen.queryByRole('link', { name: '接入凭据' })).toBeNull();
  expect(screen.queryByRole('link', { name: '权限组 Scope' })).toBeNull();
});

test('仅审核人员可进入发布页，发布请求401仍清除会话', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/platform-info')
        return Response.json({
          code: 200,
          data: { name: 'CYL开放平台', adminLoginUrl: 'https://login.example.com/' },
        });
      if (url === '/admin-api/session')
        return Response.json(
          {
            code: 200,
            data: {
              tenantId: 't1',
              userId: 'u1',
              administratorId: 'admin-1',
              employeeId: 'employee-1',
              superAdministrator: false,
              employeeNo: 'E1',
              displayName: '审核员',
              permissions: ['REVIEW_APIS'],
            },
          },
          { headers: { 'X-CSRF-Token': 'proof' } },
        );
      return Response.json({ code: 401, data: null }, { status: 401 });
    }),
  );
  render(<App />);
  expect(screen.queryByRole('link', { name: 'API 列表' })).toBeNull();
  expect(await screen.findByRole('link', { name: '使用平台账号登录' })).toBeTruthy();
  expect(screen.queryByRole('navigation', { name: '后台主导航' })).toBeNull();
});

test.each([
  // 113：旧 Token 排障地址替换为凭据列表。
  ['VIEW_AUDIT', 'tokens', '/credentials', '/observability/calls', '/applications'],
  ['MANAGE_CONNECTIONS', 'applications', '/credentials', '/dubbo-connections', '/applications'],
  ['PUBLISH_APIS', 'scopes', '/scopes', '/publications', '/scopes'],
  // 112b：旧维护页并入 API 工作区，地址替换为 API 列表。
  ['REVIEW_APIS', 'lifecycle', '/apis', '/publications', '/apis/'],
])(
  '仅有%s权限时直接管理URL解释缺少权限，不跳转或发送无权请求',
  async (permission, requestedPage, normalizedPath, allowedPath, forbiddenPath) => {
    window.history.replaceState({}, '', `/#/${requestedPage}`);
    const fetchMock = vi.fn(async (url: string) =>
      Response.json({
        code: 200,
        data:
          url === '/platform-info'
            ? { name: '开放平台', adminLoginUrl: null }
            : url === '/admin-api/session'
              ? {
                  tenantId: 't1',
                  userId: 'u1',
                  administratorId: 'admin-1',
                  employeeId: 'employee-1',
                  superAdministrator: false,
                  employeeNo: 'e1',
                  displayName: '受限管理员',
                  permissions: [permission],
                }
              : url.endsWith('/configuration')
                ? { environmentId: 'TEST', credentialReferences: [] }
                : { items: [], total: 0, page: 1, pageSize: 20 },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    expect(await screen.findByRole('heading', { name: '暂无此页面的操作权限' })).toBeTruthy();
    // 旧地址被替换为新的路径式地址，但停留在同一页面。
    expect(window.location.hash).toBe(`#${normalizedPath}`);
    expect(fetchMock.mock.calls.some(([url]) => url.includes(allowedPath))).toBe(false);
    expect(fetchMock.mock.calls.some(([url]) => url.startsWith(`/admin-api${forbiddenPath}`))).toBe(
      false,
    );
  },
);


test('撤销凭据管理权限后保留创建输入，再次提交在页面阻断', async () => {
  let sessionReads = 0;
  const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
    if (url === '/platform-info') return Response.json({ code: 200, data: { name: '开放平台', adminLoginUrl: null } });
    if (url === '/admin-api/session') {
      sessionReads++;
      return Response.json({ code: 200, data: {
        tenantId: 't1', userId: 'u1', employeeId: 'e1', employeeNo: 'E1', administratorId: 'a1',
        displayName: '管理员', superAdministrator: false,
        permissions: sessionReads === 1 ? ['MANAGE_APPLICATIONS'] : ['VIEW_AUDIT'],
      } }, { headers: { 'X-CSRF-Token': 'proof' } });
    }
    if (options?.method === 'POST') return Response.json({ code: 40300001, resultMsg: '权限已撤销' }, { status: 403 });
    return Response.json({ code: 200, data: { items: [], total: 0 } });
  });
  vi.stubGlobal('fetch', fetchMock);
  window.history.replaceState({}, '', '/#/credentials');
  render(<App />);
  fireEvent.click((await screen.findAllByRole('button', { name: /新建凭据/ }))[0]);
  fireEvent.change(screen.getByLabelText('归属租户 ID'), { target: { value: 't1' } });
  const submit = screen.getByRole('button', { name: '创建并生成 Secret' });
  await vi.waitFor(() => expect(submit).toHaveProperty('disabled', false));
  fireEvent.click(submit);
  await screen.findByRole('heading', { name: '暂无此页面的操作权限' });
  expect((screen.getByLabelText('归属租户 ID') as HTMLInputElement).value).toBe('t1');
  fireEvent.click(screen.getByRole('button', { name: '创建并生成 Secret' }));
  await screen.findByText(/输入已保留，本次未提交/);
  expect(fetchMock.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1);
  expect(window.location.hash).toBe('#/credentials');
});

test('列表接入候选放弃后真正卸载编辑器并回到目录', { timeout: 15000 }, async()=>{
 window.history.replaceState({},'', '/#/catalog');
 const fetch=vi.fn(async(url:string)=>Response.json({code:200,data:url==='/platform-info'?{name:'平台'}:url==='/admin-api/session'?{tenantId:'t',userId:'u',administratorId:'a',employeeId:'e',employeeNo:'1',superAdministrator:false,displayName:'管理员',permissions:['MANAGE_APIS']}:url.includes('/apis/owners/')?{id:'EMP_00000000000000000000000000000001',displayName:'管理员',employeeNo:'1'}:{items:[],total:0,page:1,pageSize:20}},{headers:{'X-CSRF-Token':'proof'}}));
 vi.stubGlobal('fetch',fetch);
 render(<App/>);
 fireEvent.click(await screen.findByRole('button',{name:/新建 API/}, {timeout:5000}));
 fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button',{name:/OpenAPI 文档/}));
 expect(window.location.hash).toContain('/apis/import?source=openapi');
 fireEvent.click(await screen.findByRole('radio',{name:'HTTP 请求 · cURL / 原始 HTTP'}));
 fireEvent.change(screen.getByLabelText('来源文本'),{target:{value:`curl https://example.test/orders -d '{"orderId":"A"}'`}});
 fireEvent.click(screen.getByRole('button',{name:'解析来源，选择接口'}));
 await screen.findByLabelText('接口名称');
 fireEvent.click(within(screen.getByRole('navigation',{name:'后台主导航'})).getByRole('link',{name:'API 列表'}));
 fireEvent.click(await screen.findByRole('button',{name:'放弃更改并离开'}));
 expect(await screen.findByRole('button',{name:/新建 API/}, {timeout:5000})).toBeTruthy();
 await waitFor(()=>expect(screen.queryByRole('navigation',{name:'配置目录'})).toBeNull());
 expect(screen.getByPlaceholderText('搜索名称、service.method 或内部类')).toBeTruthy();
 expect(window.location.hash).toBe('#/apis');
 expect(fetch.mock.calls.some(([url])=>url.includes('/api-imports/confirm'))).toBe(false);
});
