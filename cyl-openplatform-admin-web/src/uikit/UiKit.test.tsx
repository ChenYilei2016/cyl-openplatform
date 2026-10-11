import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import UiKit, { uiKitAvailable } from './UiKit';

afterEach(cleanup);

test('组件展示页只在本机回环地址或开发模式显示内容', () => {
  expect(uiKitAvailable('127.0.0.1', false)).toBe(true);
  expect(uiKitAvailable('localhost', false)).toBe(true);
  expect(uiKitAvailable('open.example.com', false)).toBe(false);
  expect(uiKitAvailable('open.example.com', true)).toBe(true);
});

test('展示页可切换门户深色主题，令牌随主题更新', () => {
  render(<UiKit />);
  expect(screen.getByRole('heading', { name: '色彩' })).toBeTruthy();
  fireEvent.click(screen.getByText('门户'));
  fireEvent.click(screen.getByText('深色'));
  expect(document.querySelector('style[data-op-tokens="portal-dark"]')).toBeTruthy();
});
