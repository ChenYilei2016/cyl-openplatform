import { useEffect, useRef } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { AdminNavigationProvider, useAdminNavigation } from './AdminNavigation';

afterEach(() => {
  cleanup();
  window.history.replaceState({}, '', '/');
  vi.restoreAllMocks();
});
function DraftPage({ save }: { save: () => Promise<boolean> }) {
  const navigation = useAdminNavigation();
  const dirty = useRef(true);
  useEffect(
    () =>
      navigation.registerDraft({
        apiId: 'api1',
        dirty: () => dirty.current,
        busy: () => false,
        save: async () => {
          const result = await save();
          if (result) dirty.current = false;
          return result;
        },
      }),
    [navigation.registerDraft, save],
  );
  return (
    <>
      <p data-testid="route">
        {navigation.route.page}:{navigation.route.apiId}:{navigation.route.step}
      </p>
      <button onClick={() => navigation.navigate({ ...navigation.route, apiId: null })}>
        返回列表
      </button>
    </>
  );
}

function DraftActionPage() {
  const navigation = useAdminNavigation();
  useEffect(
    () =>
      navigation.registerDraft({
        apiId: 'api1',
        dirty: () => true,
        busy: () => false,
        save: async () => true,
      }),
    [navigation.registerDraft],
  );
  return (
    <>
      <button onClick={() => navigation.navigate({ ...navigation.route, step: 'test' })}>
        进入测试
      </button>
      <button onClick={() => navigation.navigate({ ...navigation.route, step: 'pub' })}>
        进入发布
      </button>
    </>
  );
}

test('保存失败不离开，成功才切换路由', async () => {
  window.history.replaceState({ adminIndex: 1 }, '', '/#/catalog?api=api1&step=outer');
  const save = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  render(
    <AdminNavigationProvider>
      <DraftPage save={save} />
    </AdminNavigationProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: '返回列表' }));
  fireEvent.click(screen.getByRole('button', { name: '保存后继续' }));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(window.location.hash).toContain('/apis/api1/');
  fireEvent.click(screen.getByRole('button', { name: '保存后继续' }));
  await vi.waitFor(() => expect(window.location.hash).toBe('#/apis'));
  expect(save).toHaveBeenCalledTimes(2);
});

test('浏览器后退遇未保存输入先恢复历史，取消保持URL和页面一致', async () => {
  window.history.replaceState({ adminIndex: 2 }, '', '/#/catalog?api=api1&step=outer');
  const go = vi.spyOn(window.history, 'go').mockImplementation(() => {});
  render(
    <AdminNavigationProvider>
      <DraftPage save={vi.fn().mockResolvedValue(true)} />
    </AdminNavigationProvider>,
  );
  window.history.replaceState({ adminIndex: 1 }, '', '/#/catalog');
  fireEvent(window, new PopStateEvent('popstate', { state: { adminIndex: 1 } }));
  expect(go).toHaveBeenCalledWith(1);
  // 模拟浏览器完成go(+1)恢复，取消不再移动历史。
  window.history.replaceState({ adminIndex: 2 }, '', '/#/catalog?api=api1&step=outer');
  fireEvent(window, new PopStateEvent('popstate', { state: { adminIndex: 2 } }));
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(window.location.hash).toContain('/apis/api1/');
  expect(screen.getByTestId('route').textContent).toBe('catalog:api1:outer');
  expect(go).toHaveBeenCalledTimes(1);
});

test('同凭据内的浏览器回退也不能卸载正在写入的租户关系',()=>{
 function BusyRelation(){const navigation=useAdminNavigation();useEffect(()=>navigation.registerDraft({applicationId:'a1',tenantGrantId:'g1',dirty:()=>true,busy:()=>true,save:async()=>false}),[navigation.registerDraft]);return <p>当前关系：{navigation.route.tenantGrantId}</p>}
 history.replaceState({adminIndex:2},'','/#/applications?application=a1&tenantGrant=g1');const go=vi.spyOn(history,'go').mockImplementation(()=>{});
 render(<AdminNavigationProvider><BusyRelation/></AdminNavigationProvider>);history.replaceState({adminIndex:1},'','/#/applications?application=a1&tenantGrant=g2');fireEvent(window,new PopStateEvent('popstate',{state:{adminIndex:1}}));expect(go).toHaveBeenCalledWith(1);expect(screen.getByText('当前关系：g1')).toBeTruthy();expect(screen.getByRole('button',{name:'放弃更改并离开'})).toHaveProperty('disabled',true);
});

test('URL未知步骤、旧审核状态和过长API不进入工作区，查询长度有界', () => {
  window.history.replaceState(
    {},
    '',
    `/#/catalog?api=${'x'.repeat(37)}&step=secret&pageNo=999999&review=CANCELED&query=${'y'.repeat(130)}`,
  );
  function Location() {
    const { route } = useAdminNavigation();
    return <p>{JSON.stringify(route)}</p>;
  }
  render(
    <AdminNavigationProvider>
      <Location />
    </AdminNavigationProvider>,
  );
  expect(JSON.parse(screen.getByText(/"apiId":null/).textContent!)).toMatchObject({
    page: 'catalog',
    apiId: null,
    step: 'outer',
    query: 'y'.repeat(129),
    pageNo: 1,
  });
});

test('连接编辑复用未保存保护，失败保留连接定位，成功才离开', async () => {
  window.history.replaceState(
    { adminIndex: 1 },
    '',
    '/#/connections?connection=c1&view=edit&query=orders&pageNo=2',
  );
  const save = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  function ConnectionDraft() {
    const navigation = useAdminNavigation();
    const dirty = useRef(true);
    useEffect(
      () =>
        navigation.registerDraft({
          connectionId: 'c1',
          dirty: () => dirty.current,
          busy: () => false,
          save: async () => {
            const result = await save();
            if (result) dirty.current = false;
            return result;
          },
        }),
      [navigation.registerDraft],
    );
    return (
      <>
        <p>
          {navigation.route.page}:{navigation.route.connectionId}
        </p>
        <button
          onClick={() =>
            navigation.navigate({ page: 'home', apiId: null, step: 'outer', query: '', pageNo: 1 })
          }
        >
          离开连接
        </button>
      </>
    );
  }
  render(
    <AdminNavigationProvider>
      <ConnectionDraft />
    </AdminNavigationProvider>,
  );
  expect(screen.getByText('connections:c1')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '离开连接' }));
  fireEvent.click(screen.getByRole('button', { name: '保存后继续' }));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(window.location.hash).toContain('connection=c1');
  fireEvent.click(screen.getByRole('button', { name: '保存后继续' }));
  await vi.waitFor(() => expect(window.location.hash).toBe('#/workbench'));
});

test('测试和发布用业务文案选择配置并保留返回编辑入口', () => {
  window.history.replaceState({ adminIndex: 1 }, '', '/#/catalog?api=api1&step=outer');
  render(
    <AdminNavigationProvider>
      <DraftActionPage />
    </AdminNavigationProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: '进入测试' }));
  expect(screen.getByRole('heading', { name: '进入测试页前，选择使用的配置' })).toBeTruthy();
  expect(screen.getByText(/进入测试页不会调用接口，点击「执行测试」后才会发起业务请求/)).toBeTruthy();
  expect(screen.getByRole('button', { name: '保存修改并进入测试' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '使用已保存配置进入测试' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '返回编辑' }));
  fireEvent.click(screen.getByRole('button', { name: '进入发布' }));
  expect(screen.getByRole('heading', { name: '要发布哪份配置？' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '保存并发布本次修改' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '仅发布上次保存配置' })).toBeTruthy();
});

function RouteName() { return <p>{useAdminNavigation().route.page}</p>; }
test.each([['calls','calls'],['audits','audits'],['transfers','transfers'],['observability','home'],['environment-releases','home']])('只保留当前浏览器入口 %s', (path,expected)=>{
 window.history.replaceState({},'', '/#/'+path);
 render(<AdminNavigationProvider><RouteName/></AdminNavigationProvider>);
 expect(screen.getByText(expected)).toBeTruthy();
});
