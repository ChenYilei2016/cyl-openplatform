import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import type { AdminApi } from '../access/api';
import PortalVisibilitySwitch from './PortalVisibilitySwitch';

afterEach(cleanup);

test('列表复用可见性投影，切换仅提交展示设置，不提交草稿或审核', async () => {
  const api = vi.fn(async () => ({ visible: false }));
  render(<PortalVisibilitySwitch api={api as AdminApi} apiId="pre-api" initial />);
  expect(api).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('switch', { name: '门户展示' }));
  await waitFor(() => expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('false'));
  expect(api).toHaveBeenCalledExactlyOnceWith('/apis/pre-api/portal-visibility', { method: 'PUT', body: { visible: false } });
});

test('编辑页读取失败可重试，写入失败保留已知状态', async () => {
  const api = vi.fn().mockRejectedValueOnce(new Error('读取失败')).mockResolvedValueOnce({ visible: false })
    .mockRejectedValueOnce(new Error('保存失败'));
  render(<PortalVisibilitySwitch api={api as AdminApi} apiId="pre-api" />);
  fireEvent.click(await screen.findByRole('button', { name: '重试读取' }));
  await waitFor(() => expect(screen.getByRole('switch').getAttribute('aria-disabled')).not.toBe('true'));
  fireEvent.click(screen.getByRole('switch'));
  await screen.findByText('保存失败');
  expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('false');
});
