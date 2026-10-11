import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import { AdminNavigationProvider } from './AdminNavigation';
import { useListQuery } from './useListQuery';

function LogsProbe() {
  const query = useListQuery({ namespace: 'logs', defaults: { result: '', range: '24h', tenantId: '', durationMin: '' }, applyKeys: ['tenantId', 'durationMin'] });
  return (
    <>
      <output aria-label="已生效">{JSON.stringify(query.filters)}|{query.page}|{query.activeCount(['tenantId', 'durationMin'])}</output>
      <button onClick={() => query.setFilter('result', 'FAILURE')}>只看失败</button>
      <button onClick={() => query.setFilter('range', '24h')}>近24小时</button>
      <button onClick={() => query.setDraft('tenantId', 't1')}>草稿租户</button>
      <button onClick={query.apply}>应用</button>
      <button onClick={() => query.setPage(3)}>第3页</button>
      <button onClick={() => query.clear()}>清除全部</button>
    </>
  );
}
const applied = () => screen.getByLabelText('已生效').textContent ?? '';
const mount = (hash = '#/logs') => {
  window.history.replaceState({}, '', `/${hash}`);
  render(<AdminNavigationProvider><LogsProbe /></AdminNavigationProvider>);
};
afterEach(() => { cleanup(); window.history.replaceState({}, '', '/#/workbench'); });

test('只写入与默认值不同的条件；即时条件立即生效并回到第 1 页', () => {
  mount('#/logs?filter.logs.page=2');
  fireEvent.click(screen.getByText('近24小时'));
  expect(window.location.hash).toBe('#/logs');
  fireEvent.click(screen.getByText('只看失败'));
  expect(window.location.hash).toBe('#/logs?filter.logs.result=FAILURE');
  expect(applied()).toContain('"result":"FAILURE"');
  expect(applied()).toMatch(/\|1\|/);
});

test('组合条件改草稿不生效，应用后才写入地址', () => {
  mount();
  fireEvent.click(screen.getByText('草稿租户'));
  expect(window.location.hash).toBe('#/logs');
  expect(applied()).toContain('"tenantId":""');
  fireEvent.click(screen.getByText('应用'));
  expect(window.location.hash).toBe('#/logs?filter.logs.tenantId=t1');
  expect(applied()).toMatch(/\|1$/);
});

test('翻页写入历史，地址还原条件与页码，清除全部回到干净地址', () => {
  mount('#/logs?filter.logs.result=FAILURE');
  const before = window.history.length;
  fireEvent.click(screen.getByText('第3页'));
  expect(window.history.length).toBe(before + 1);
  expect(window.location.hash).toBe('#/logs?filter.logs.result=FAILURE&filter.logs.page=3');
  expect(applied()).toMatch(/\|3\|/);
  fireEvent.click(screen.getByText('清除全部'));
  expect(window.location.hash).toBe('#/logs');
});

test('秘密类字段名不会从地址带入条件', () => {
  mount('#/logs?filter.logs.result=FAILURE&filter.logs.appSecret=x&filter.logs.token=y');
  fireEvent.click(screen.getByText('第3页'));
  expect(window.location.hash).not.toMatch(/appSecret|token=/);
});

function CredentialsProbe() {
  const query = useListQuery({ namespace: 'credentials', defaults: { search: '', status: [] as string[] }, legacyKeys: { query: 'search', appKey: 'search' } });
  return <output aria-label="凭据条件">{JSON.stringify(query.filters)}|{query.page}</output>;
}

test('改名前的旧条件链接（如 113 前的 credentials.query）还原到新字段，并把地址改写为新字段名', () => {
  window.history.replaceState({}, '', '/#/credentials?filter.credentials.query=%E4%BB%93%E5%82%A8&filter.credentials.status=DISABLED&filter.credentials.page=2');
  render(<AdminNavigationProvider><CredentialsProbe /></AdminNavigationProvider>);
  expect(screen.getByLabelText('凭据条件').textContent).toBe('{"search":"仓储","status":["DISABLED"]}|2');
  const query = new URLSearchParams(window.location.hash.split('?')[1]);
  expect([query.get('filter.credentials.search'), query.get('filter.credentials.query'), query.get('filter.credentials.page')]).toEqual(['仓储', null, '2']);
  cleanup();
  window.history.replaceState({}, '', '/#/credentials?filter.credentials.search=new&filter.credentials.appKey=old');
  render(<AdminNavigationProvider><CredentialsProbe /></AdminNavigationProvider>);
  expect(screen.getByLabelText('凭据条件').textContent).toBe('{"search":"new","status":[]}|1');
  expect(window.location.hash).toBe('#/credentials?filter.credentials.search=new');
});
