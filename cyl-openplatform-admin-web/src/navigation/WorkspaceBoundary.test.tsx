import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import WorkspaceBoundary from './WorkspaceBoundary';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
test('工作区模块失败保留外层导航，切换工作区可恢复', () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  function FailedModule(): never { throw new Error('chunk unavailable'); }
  const view = render(<><nav aria-label="后台主导航">API列表</nav><WorkspaceBoundary key="catalog"><FailedModule /></WorkspaceBoundary></>);
  expect(screen.getByRole('navigation', { name: '后台主导航' })).toBeTruthy();
  expect(screen.getByRole('alert').textContent).toContain('工作区暂时无法显示');
  expect(screen.getByRole('button', { name: /重新加载页面/ })).toBeTruthy();
  view.rerender(<><nav aria-label="后台主导航">API列表</nav><WorkspaceBoundary key="applications"><h2>接入凭据</h2></WorkspaceBoundary></>);
  expect(screen.getByRole('heading', { name: '接入凭据' })).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
});
